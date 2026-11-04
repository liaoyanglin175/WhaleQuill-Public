use crate::Database;
use crate::planner::PlannerData;
use chrono::{DateTime, NaiveDate};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use tauri::{AppHandle, State};

type CommandResult<T> = Result<T, String>;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub(crate) id: String,
    title: String,
    body: String,
    #[serde(default)]
    document: Option<serde_json::Value>,
    record_type: String,
    tags: Vec<String>,
    #[serde(default)]
    highlights: Vec<Highlight>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    id: String,
    start: usize,
    end: usize,
    text: String,
    created_at: String,
    #[serde(default)]
    stale: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    #[serde(flatten)] planner: PlannerData,
    pub(crate) id: String,
    title: String,
    status: String,
    priority: String,
    due_date: Option<String>,
    source_record_id: Option<String>,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Workspace { records: Vec<Record>, tasks: Vec<Task> }

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRecord { #[serde(flatten)] pub(crate) record: Record, pub(crate) deleted_at: Option<String> }
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredTask { #[serde(flatten)] pub(crate) task: Task, pub(crate) deleted_at: Option<String> }
#[derive(Debug, Serialize, Deserialize)]
pub struct FullSnapshot { pub(crate) records: Vec<StoredRecord>, pub(crate) tasks: Vec<StoredTask> }

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum TrashEntry {
    Record { #[serde(rename = "deletedAt")] deleted_at: String, record: Record },
    Task { #[serde(rename = "deletedAt")] deleted_at: String, task: Task },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryEntry { record: Record, saved_at: String }

#[tauri::command]
pub fn write_recovery(database: State<Database>, id: String, record: Option<Record>) -> CommandResult<()> {
    uuid::Uuid::parse_str(&id).map_err(|_| "恢复副本 ID 不正确")?;
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    if let Some(record) = record {
        if record.id != id { return Err("恢复副本 ID 不一致".into()); }
        if crate::trash::is_purged(&connection,"record",&id){return Err("原记录已永久清理，请新建记录后保存。".into());}
        let json = serde_json::to_string(&record).map_err(|error| error.to_string())?;
        if json.len() > 20 * 1024 * 1024 { return Err("恢复副本过大，请导出正文".into()); }
        connection.execute("INSERT INTO recovery_drafts(id,record_json,saved_at) VALUES (?1,?2,?3) ON CONFLICT(id) DO UPDATE SET record_json=excluded.record_json,saved_at=excluded.saved_at", params![id, json, chrono::Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
    } else {
        connection.execute("DELETE FROM recovery_drafts WHERE id=?1", [id]).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_recovery(database: State<Database>) -> CommandResult<Vec<RecoveryEntry>> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    let mut query = connection.prepare("SELECT record_json,saved_at FROM recovery_drafts ORDER BY saved_at DESC").map_err(|error| error.to_string())?;
    let result = query.query_map([], |row| {
        let json: String = row.get(0)?;
        let record = serde_json::from_str(&json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(error)))?;
        Ok(RecoveryEntry { record, saved_at: row.get(1)? })
    }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string());
    result
}

fn validate_common(id: &str, title: &str, created: &str, updated: &str) -> CommandResult<()> {
    uuid::Uuid::parse_str(id).map_err(|_| "ID 格式不正确")?;
    if title.trim().is_empty() || title.chars().count() > 200 { return Err("标题需要 1–200 个字符".into()); }
    DateTime::parse_from_rfc3339(created).map_err(|_| "创建时间格式不正确")?;
    DateTime::parse_from_rfc3339(updated).map_err(|_| "更新时间格式不正确")?;
    Ok(())
}

pub(crate) fn validate_record(record: &Record) -> CommandResult<()> {
    validate_common(&record.id, &record.title, &record.created_at, &record.updated_at)?;
    if !["note", "work", "diary"].contains(&record.record_type.as_str()) { return Err("记录类型不正确".into()); }
    if record.body.chars().count() > 1_000_000 || record.tags.len() > 20 || record.tags.iter().any(|tag| tag.trim().is_empty() || tag.chars().count() > 40) { return Err("正文或标签超出限制".into()); }
    if let Some(document)=&record.document {
        if document.to_string().len()>8_000_000 {return Err("排版文档过大".into());}
        let mut blocks=Vec::new();let mut count=0;validate_document(document,0,&mut count,&mut blocks)?;
        if document.get("type").and_then(|v|v.as_str())!=Some("doc")||blocks.join("\n")!=record.body {return Err("排版文档与正文不一致".into());}
    }
    if record.highlights.len() > 200 { return Err("重点数量超出限制".into()); }
    let body: Vec<u16> = record.body.encode_utf16().collect();
    let mut ids = HashSet::new();
    for highlight in &record.highlights {
        uuid::Uuid::parse_str(&highlight.id).map_err(|_| "重点 ID 不正确")?;
        DateTime::parse_from_rfc3339(&highlight.created_at).map_err(|_| "重点时间不正确")?;
        let text: Vec<u16> = highlight.text.encode_utf16().collect();
        if !ids.insert(&highlight.id) || text.is_empty() || text.len() > 4000 || highlight.end > 1_000_000 || highlight.end <= highlight.start || highlight.end - highlight.start != text.len() || (!highlight.stale && body.get(highlight.start..highlight.end) != Some(text.as_slice())) { return Err("重点与原文不一致".into()); }
    }
    Ok(())
}

fn validate_document(node:&serde_json::Value,depth:usize,count:&mut usize,blocks:&mut Vec<String>)->CommandResult<()> {
    *count+=1;if depth>24||*count>30_000{return Err("排版文档层级过多".into());}
    let kind=node.get("type").and_then(|v|v.as_str()).ok_or("排版节点不正确")?;
    if !["doc","paragraph","heading","text","hardBreak","bulletList","orderedList","listItem","blockquote","codeBlock","horizontalRule"].contains(&kind){return Err("不支持的排版节点".into());}
    if kind=="text"&&node.get("text").and_then(|v|v.as_str()).is_none(){return Err("排版文字不正确".into());}
    if let Some(marks)=node.get("marks"){for mark in marks.as_array().ok_or("排版样式不正确")?{let name=mark.get("type").and_then(|v|v.as_str()).ok_or("样式不正确")?;if !["bold","italic","underline","strike","code","textStyle","highlight","memory","tag","link"].contains(&name){return Err("不支持的样式".into());}if name=="tag"{uuid::Uuid::parse_str(mark.get("attrs").and_then(|v|v.get("id")).and_then(|v|v.as_str()).ok_or("关联标签缺少ID")?).map_err(|_|"关联标签ID不正确")?;}}}
    if ["paragraph","heading","codeBlock"].contains(&kind){blocks.push(document_inline(node));}
    if kind=="horizontalRule"{blocks.push("---".into());}
    if let Some(content)=node.get("content"){for child in content.as_array().ok_or("排版内容不正确")?{validate_document(child,depth+1,count,blocks)?;}}
    Ok(())
}
fn document_inline(node:&serde_json::Value)->String {
    match node.get("type").and_then(|v|v.as_str()) {Some("text")=>node.get("text").and_then(|v|v.as_str()).unwrap_or("").to_string(),Some("hardBreak")=>"\n".into(),_=>node.get("content").and_then(|v|v.as_array()).map(|items|items.iter().map(document_inline).collect::<Vec<_>>().join("")).unwrap_or_default()}
}

pub(crate) fn validate_task(task: &Task) -> CommandResult<()> {
    task.planner.validate(&task.status,task.due_date.as_deref())?;
    validate_common(&task.id, &task.title, &task.created_at, &task.updated_at)?;
    if !["todo", "done"].contains(&task.status.as_str()) || !["normal", "high"].contains(&task.priority.as_str()) { return Err("任务状态或优先级不正确".into()); }
    if let Some(date) = &task.due_date { NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| "截止日期格式不正确")?; }
    if let Some(id) = &task.source_record_id { uuid::Uuid::parse_str(id).map_err(|_| "来源 ID 不正确")?; }
    Ok(())
}

pub(crate) fn put_record(connection: &Connection, record: &Record) -> CommandResult<()> {
    let tags = serde_json::to_string(&record.tags).map_err(|error| error.to_string())?;
    let highlights = serde_json::to_string(&record.highlights).map_err(|error| error.to_string())?;
    let document = serde_json::to_string(&record.document).map_err(|error| error.to_string())?;
    connection.execute(
        "INSERT INTO records (id,title,body,record_type,tags_json,created_at,updated_at,highlights_json,document_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,record_type=excluded.record_type,tags_json=excluded.tags_json,created_at=excluded.created_at,updated_at=excluded.updated_at,highlights_json=excluded.highlights_json,document_json=excluded.document_json,deleted_at=NULL",
        params![record.id, record.title.trim(), record.body, record.record_type, tags, record.created_at, record.updated_at, highlights, document],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

fn planner_row(row:&rusqlite::Row,index:usize)->rusqlite::Result<PlannerData>{
    let json:String=row.get(index)?;
    serde_json::from_str(&json).map_err(|error|rusqlite::Error::FromSqlConversionFailure(index,rusqlite::types::Type::Text,Box::new(error)))
}
fn task_row(row:&rusqlite::Row)->rusqlite::Result<Task>{Ok(Task{id:row.get(0)?,title:row.get(1)?,status:row.get(2)?,priority:row.get(3)?,due_date:row.get(4)?,source_record_id:row.get(5)?,created_at:row.get(6)?,updated_at:row.get(7)?,planner:planner_row(row,8)?})}
fn existing_task(connection:&Connection,id:&str)->CommandResult<Option<Task>>{
    connection.query_row("SELECT id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json FROM tasks WHERE id=?1 AND deleted_at IS NULL",[id],task_row).optional().map_err(|e|e.to_string())
}
fn active_tasks(connection:&Connection)->CommandResult<Vec<Task>>{
    let mut query=connection.prepare("SELECT id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json FROM tasks WHERE deleted_at IS NULL").map_err(|e|e.to_string())?;
    let tasks=query.query_map([],task_row).map_err(|e|e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?;Ok(tasks)
}

pub(crate) fn put_task(connection: &Connection, task: &Task) -> CommandResult<()> {
    let planner_json=serde_json::to_string(&task.planner).map_err(|e|e.to_string())?;
    connection.execute(
        "INSERT INTO tasks (id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(id) DO UPDATE SET title=excluded.title,status=excluded.status,priority=excluded.priority,due_date=excluded.due_date,source_record_id=excluded.source_record_id,created_at=excluded.created_at,updated_at=excluded.updated_at,planner_json=excluded.planner_json,deleted_at=NULL",
        params![task.id, task.title.trim(), task.status, task.priority, task.due_date, task.source_record_id, task.created_at, task.updated_at,planner_json],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn load_workspace(database: State<Database>) -> CommandResult<Workspace> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    read_workspace(&connection)
}

fn read_workspace(connection: &Connection) -> CommandResult<Workspace> {
    let snapshot = connection.unchecked_transaction().map_err(|error| error.to_string())?;
    let result = read_snapshot(&snapshot);
    snapshot.commit().map_err(|error| error.to_string())?;
    result
}

fn read_snapshot(connection: &Connection) -> CommandResult<Workspace> {
    read_items(connection, false)
}

pub(crate) fn read_items(connection: &Connection, deleted: bool) -> CommandResult<Workspace> {
    let record_sql = if deleted { "SELECT id,title,body,record_type,tags_json,created_at,updated_at,highlights_json,document_json FROM records WHERE deleted_at IS NOT NULL" } else { "SELECT id,title,body,record_type,tags_json,created_at,updated_at,highlights_json,document_json FROM records WHERE deleted_at IS NULL ORDER BY updated_at DESC" };
    let mut record_query = connection.prepare(record_sql).map_err(|error| error.to_string())?;
    let records = record_query.query_map([], |row| {
        let tags_json: String = row.get(4)?;
        let tags = serde_json::from_str(&tags_json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error)))?;
        Ok(Record { id: row.get(0)?, title: row.get(1)?, body: row.get(2)?, document: {let json:String=row.get(8)?;serde_json::from_str(&json).map_err(|error|rusqlite::Error::FromSqlConversionFailure(8,rusqlite::types::Type::Text,Box::new(error)))?}, record_type: row.get(3)?, tags, highlights: { let json: String = row.get(7)?; serde_json::from_str(&json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error)))? }, created_at: row.get(5)?, updated_at: row.get(6)? })
    }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    let task_sql = if deleted { "SELECT id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json FROM tasks WHERE deleted_at IS NOT NULL" } else { "SELECT id,title,status,priority,due_date,CASE WHEN EXISTS(SELECT 1 FROM records r WHERE r.id=tasks.source_record_id AND r.deleted_at IS NULL) THEN source_record_id ELSE NULL END,created_at,updated_at,planner_json FROM tasks WHERE deleted_at IS NULL" };
    let mut task_query = connection.prepare(task_sql).map_err(|error| error.to_string())?;
    let tasks = task_query.query_map([], |row| Ok(Task { id: row.get(0)?, title: row.get(1)?, status: row.get(2)?, priority: row.get(3)?, due_date: row.get(4)?, source_record_id: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,planner: planner_row(row,8)? })).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    Ok(Workspace { records, tasks })
}

#[tauri::command]
pub fn save_record(database: State<Database>, record: Record) -> CommandResult<()> {
    validate_record(&record)?;
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    ensure_not_deleted(&connection, "records", &record.id)?;
    put_record(&connection, &record)
}

#[tauri::command]
pub fn delete_record(database: State<Database>, id: String) -> CommandResult<()> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    connection.execute("UPDATE records SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL", params![id, chrono::Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn save_task(app: AppHandle, database: State<Database>, mut task: Task, expected_updated_at: Option<String>) -> CommandResult<()> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    let previous=existing_task(&connection,&task.id)?;
    task.planner.complete(task.status=="done",previous.as_ref().map(|t|&t.planner),previous.as_ref().map(|t|t.status.as_str()),&crate::planner::today())?;
    validate_task(&task)?;
    ensure_not_deleted(&connection, "tasks", &task.id)?;
    if let Some(expected) = expected_updated_at {
        let actual: String = connection.query_row("SELECT updated_at FROM tasks WHERE id=?1 AND deleted_at IS NULL", [&task.id], |row| row.get(0)).map_err(|_| "任务已变化，请重新打开后编辑")?;
        if actual != expected { return Err("任务已变化，请重新打开后编辑".into()); }
    }
    if let Some(id) = &task.source_record_id {
        let active: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE id=?1 AND deleted_at IS NULL)", [id], |row| row.get(0)).map_err(|error| error.to_string())?;
        if !active { return Err("任务的来源记录已不存在".into()); }
    }
    put_task(&connection, &task)?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

#[tauri::command]
pub fn load_strip_tasks(database: State<Database>) -> CommandResult<Vec<Task>> {
    let connection = database.0.lock().map_err(|_| "数据库当前不可用")?;
    let mut query = connection.prepare("SELECT id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json FROM tasks WHERE deleted_at IS NULL").map_err(|e| e.to_string())?;
    let tasks = query.query_map([], |row| Ok(Task { id: row.get(0)?, title: row.get(1)?, status: row.get(2)?, priority: row.get(3)?, due_date: row.get(4)?, source_record_id: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,planner: planner_row(row,8)? })).map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
    Ok(tasks)
}

fn patch_task_status(connection: &Connection, id: &str, status: &str, expected_status: &str) -> CommandResult<()> {
    uuid::Uuid::parse_str(id).map_err(|_| "任务 ID 不正确")?;
    if !["todo","done"].contains(&status) || !["todo","done"].contains(&expected_status) { return Err("任务状态不正确".into()); }
    let previous=existing_task(connection,id)?.ok_or("任务已变化，请刷新后重试")?;
    if previous.planner.kind!="task"{return Err("行程不能标记为待办完成".into());}
    let mut planner=previous.planner.clone();planner.complete(status=="done",Some(&previous.planner),Some(&previous.status),&crate::planner::today())?;
    let json=serde_json::to_string(&planner).map_err(|e|e.to_string())?;
    let count = connection.execute("UPDATE tasks SET status=?2,updated_at=?3,planner_json=?5 WHERE id=?1 AND deleted_at IS NULL AND status=?4", params![id,status,chrono::Utc::now().to_rfc3339(),expected_status,json]).map_err(|e| e.to_string())?;
    if count == 0 { return Err("任务已变化，请刷新后重试".into()); }
    Ok(())
}
#[tauri::command]
pub fn set_task_status(app: AppHandle, database: State<Database>, id: String, status: String, expected_status: String) -> CommandResult<()> {
    let connection = database.0.lock().map_err(|_| "数据库当前不可用")?;
    patch_task_status(&connection,&id,&status,&expected_status)?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

#[tauri::command]
pub fn delete_task(app: AppHandle, database: State<Database>, id: String) -> CommandResult<()> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    connection.execute("UPDATE tasks SET deleted_at=?2 WHERE id=?1 AND deleted_at IS NULL", params![id, chrono::Utc::now().to_rfc3339()]).map_err(|error| error.to_string())?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

fn ensure_not_deleted(connection: &Connection, table: &str, id: &str) -> CommandResult<()> {
    if crate::trash::is_purged(connection,if table=="records"{"record"}else{"task"},id){return Err("原内容已永久清理，请新建后保存。".into());}
    let sql = match table { "records" => "SELECT EXISTS(SELECT 1 FROM records WHERE id=?1 AND deleted_at IS NOT NULL)", _ => "SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1 AND deleted_at IS NOT NULL)" };
    let deleted: bool = connection.query_row(sql, [id], |row| row.get(0)).map_err(|error| error.to_string())?;
    if deleted { return Err("条目已在回收站中，请先恢复".into()); }
    Ok(())
}

#[tauri::command]
pub fn load_trash(database: State<Database>) -> CommandResult<Vec<TrashEntry>> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    read_trash(&connection)
}

fn read_trash(connection: &Connection) -> CommandResult<Vec<TrashEntry>> {
    let snapshot = connection.unchecked_transaction().map_err(|error| error.to_string())?;
    let deleted = read_items(&snapshot, true)?;
    let mut entries = Vec::new();
    for record in deleted.records {
        let deleted_at = snapshot.query_row("SELECT deleted_at FROM records WHERE id=?1", [&record.id], |row| row.get(0)).map_err(|error| error.to_string())?;
        entries.push(TrashEntry::Record { deleted_at, record });
    }
    for task in deleted.tasks {
        let deleted_at = snapshot.query_row("SELECT deleted_at FROM tasks WHERE id=?1", [&task.id], |row| row.get(0)).map_err(|error| error.to_string())?;
        entries.push(TrashEntry::Task { deleted_at, task });
    }
    snapshot.commit().map_err(|error| error.to_string())?;
    Ok(entries)
}

#[tauri::command]
pub fn restore_item(app: AppHandle, database: State<Database>, kind: String, id: String) -> CommandResult<()> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    restore_into(&connection, &kind, &id)?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

fn restore_into(connection: &Connection, kind: &str, id: &str) -> CommandResult<()> {
    let sql = match kind {
        "record" => "UPDATE records SET deleted_at=NULL WHERE id=?1 AND deleted_at IS NOT NULL",
        "task" => "UPDATE tasks SET deleted_at=NULL,status='todo',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),planner_json=json_set(planner_json,'$.completedAt',NULL,'$.cleanupOn',NULL) WHERE id=?1 AND deleted_at IS NOT NULL",
        _ => return Err("恢复类型不正确".into()),
    };
    if connection.execute(sql, [id]).map_err(|error| error.to_string())? == 0 { return Err("条目已恢复或不存在，未覆盖现有内容".into()); }
    Ok(())
}

pub(crate) fn maintain_into(connection:&mut Connection,day:&str,enabled:bool)->CommandResult<bool>{
    let transaction=connection.transaction().map_err(|e|e.to_string())?;let tasks=active_tasks(&transaction)?;let mut changed=false;
    for mut task in tasks{
        let previous=task.planner.cleanup_on.clone();task.planner.import_grace(&task.status,day)?;
        if enabled&&task.planner.due(&task.status,day){
            transaction.execute("UPDATE tasks SET deleted_at=?2 WHERE id=?1 AND status='done' AND deleted_at IS NULL",params![task.id,chrono::Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;changed=true;
        }else if previous!=task.planner.cleanup_on{
            let json=serde_json::to_string(&task.planner).map_err(|e|e.to_string())?;
            transaction.execute("UPDATE tasks SET planner_json=?2 WHERE id=?1 AND deleted_at IS NULL",params![task.id,json]).map_err(|e|e.to_string())?;changed=true;
        }
    }
    transaction.commit().map_err(|e|e.to_string())?;Ok(changed)
}
pub(crate) fn maintain_for_app(app:&AppHandle)->CommandResult<bool>{
    use tauri::Manager;
    let enabled=crate::task_strip::cleanup_enabled(app);
    let database=app.state::<Database>();let mut connection=database.0.lock().map_err(|_|"数据库当前不可用")?;
    let tasks_changed=maintain_into(&mut connection,&crate::planner::today(),enabled)?;let trash_changed=crate::trash::maintain(&mut connection,chrono::Utc::now())?;let changed=tasks_changed||trash_changed;drop(connection);
    if changed{crate::task_strip::changed(app);}Ok(changed)
}
#[tauri::command]
pub fn maintain_tasks(app:AppHandle)->CommandResult<bool>{maintain_for_app(&app)}

#[tauri::command]
pub fn merge_workspace(app: AppHandle, database: State<Database>, workspace: Workspace) -> CommandResult<()> {
    let mut connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    merge_into(&mut connection, workspace)?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

fn merge_into(connection: &mut Connection, mut workspace: Workspace) -> CommandResult<()> {
    if workspace.records.len() > 50_000 || workspace.tasks.len() > 50_000 { return Err("备份条目过多".into()); }
    let mut record_ids = HashSet::new();
    for record in &workspace.records {
        validate_record(record)?;
        if !record_ids.insert(record.id.clone()) { return Err("备份包含重复记录 ID".into()); }
    }
    let mut task_ids = HashSet::new();
    for task in &mut workspace.tasks {
        task.planner.import_grace(&task.status,&crate::planner::today())?;
        validate_task(task)?;
        if !task_ids.insert(task.id.clone()) { return Err("备份包含重复任务 ID".into()); }
        if task.source_record_id.as_ref().is_some_and(|id| !record_ids.contains(id)) { return Err("任务的来源记录不在备份中".into()); }
    }
    let transaction = connection.transaction().map_err(|error| error.to_string())?;
    for record in &workspace.records { put_record(&transaction, record)?;crate::trash::imported(&transaction,"record",&record.id,false)?; }
    for task in &workspace.tasks { put_task(&transaction, task)?;crate::trash::imported(&transaction,"task",&task.id,false)?; }
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn export_snapshot(database: State<Database>) -> CommandResult<FullSnapshot> {
    let connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    read_full_snapshot(&connection)
}

pub(crate) fn read_full_snapshot(connection: &Connection) -> CommandResult<FullSnapshot> {
    let tx = connection.unchecked_transaction().map_err(|error| error.to_string())?;
    let mut records_query = tx.prepare("SELECT id,title,body,record_type,tags_json,created_at,updated_at,highlights_json,document_json,deleted_at FROM records").map_err(|error| error.to_string())?;
    let records = records_query.query_map([], |row| {
        let json: String = row.get(4)?;
        let tags = serde_json::from_str(&json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(4, rusqlite::types::Type::Text, Box::new(error)))?;
        Ok(StoredRecord { record: Record { id: row.get(0)?, title: row.get(1)?, body: row.get(2)?, document: {let json:String=row.get(8)?;serde_json::from_str(&json).map_err(|error|rusqlite::Error::FromSqlConversionFailure(8,rusqlite::types::Type::Text,Box::new(error)))?}, record_type: row.get(3)?, tags, highlights: { let json: String = row.get(7)?; serde_json::from_str(&json).map_err(|error| rusqlite::Error::FromSqlConversionFailure(7, rusqlite::types::Type::Text, Box::new(error)))? }, created_at: row.get(5)?, updated_at: row.get(6)? }, deleted_at: row.get(9)? })
    }).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(records_query);
    let mut tasks_query = tx.prepare("SELECT id,title,status,priority,due_date,source_record_id,created_at,updated_at,planner_json,deleted_at FROM tasks").map_err(|error| error.to_string())?;
    let tasks = tasks_query.query_map([], |row| Ok(StoredTask { task: Task { id: row.get(0)?, title: row.get(1)?, status: row.get(2)?, priority: row.get(3)?, due_date: row.get(4)?, source_record_id: row.get(5)?, created_at: row.get(6)?, updated_at: row.get(7)?,planner: planner_row(row,8)? }, deleted_at: row.get(9)? })).map_err(|error| error.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
    drop(tasks_query);
    tx.commit().map_err(|error| error.to_string())?;
    Ok(FullSnapshot { records, tasks })
}

#[tauri::command]
pub fn merge_snapshot(app: AppHandle, database: State<Database>, snapshot: FullSnapshot) -> CommandResult<()> {
    let mut connection = database.inner().0.lock().map_err(|_| "数据库当前不可用")?;
    merge_full_snapshot(&mut connection, snapshot)?;
    drop(connection);
    crate::task_strip::changed(&app);
    Ok(())
}

fn merge_full_snapshot(connection: &mut Connection, mut snapshot: FullSnapshot) -> CommandResult<()> {
    merge_snapshot_ref(connection,&mut snapshot)
}
pub(crate) fn validate_snapshot(snapshot:&mut FullSnapshot)->CommandResult<()> {
    if snapshot.records.len() > 50_000 || snapshot.tasks.len() > 50_000 { return Err("备份条目过多".into()); }
    let mut record_ids = HashSet::new();
    for entry in &snapshot.records {
        validate_record(&entry.record)?;
        if !record_ids.insert(entry.record.id.clone()) { return Err("备份包含重复记录 ID".into()); }
        if let Some(date) = &entry.deleted_at { DateTime::parse_from_rfc3339(date).map_err(|_| "删除时间格式不正确")?; }
    }
    let mut task_ids = HashSet::new();
    for entry in &mut snapshot.tasks {
        if entry.deleted_at.is_none(){entry.task.planner.import_grace(&entry.task.status,&crate::planner::today())?;}
        validate_task(&entry.task)?;
        if !task_ids.insert(entry.task.id.clone()) { return Err("备份包含重复任务 ID".into()); }
        if entry.task.source_record_id.as_ref().is_some_and(|id| !record_ids.contains(id)) { return Err("任务的来源记录不在完整备份中".into()); }
        if let Some(date) = &entry.deleted_at { DateTime::parse_from_rfc3339(date).map_err(|_| "删除时间格式不正确")?; }
    }
    Ok(())
}
pub(crate) fn merge_snapshot_ref(connection:&mut Connection,snapshot:&mut FullSnapshot)->CommandResult<()> {
    validate_snapshot(snapshot)?;
    let tx = connection.transaction().map_err(|error| error.to_string())?;
    for entry in &snapshot.records {
        put_record(&tx, &entry.record)?;crate::trash::imported(&tx,"record",&entry.record.id,entry.deleted_at.is_some())?;
        tx.execute("UPDATE records SET deleted_at=?2 WHERE id=?1", params![entry.record.id, entry.deleted_at]).map_err(|error| error.to_string())?;
    }
    for entry in &snapshot.tasks {
        put_task(&tx, &entry.task)?;crate::trash::imported(&tx,"task",&entry.task.id,entry.deleted_at.is_some())?;
        tx.execute("UPDATE tasks SET deleted_at=?2 WHERE id=?1", params![entry.task.id, entry.deleted_at]).map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
        connection.execute_batch(include_str!("../migrations/001_initial.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/002_trash.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/003_highlights.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/004_rich_document.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/005_inline_tags.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/006_planner.sql")).unwrap();
        connection
    }

    fn record(title: &str) -> Record {
        Record {
            id: "f6ccff47-28c0-45e3-b615-68c709b892bc".into(), title: title.into(), body: "中文正文".into(),
            document: None, record_type: "work".into(), tags: vec!["研究".into()], highlights: vec![],
            created_at: "2026-10-25T10:00:00.000Z".into(), updated_at: "2026-10-25T10:00:00.000Z".into(),
        }
    }

    fn task() -> Task {
        Task {
            planner: PlannerData::default(),
            id: "6f13ad86-8e17-4c10-bb19-0f0a9e250363".into(), title: "继续实验".into(), status: "todo".into(),
            priority: "normal".into(), due_date: Some("2026-10-26".into()),
            source_record_id: Some(record("").id), created_at: "2026-10-25T10:00:00.000Z".into(), updated_at: "2026-10-25T10:00:00.000Z".into(),
        }
    }

    #[test]
    fn task_strip_status_patch_preserves_concurrently_edited_task_fields() {
        let connection=database();let mut value=task();value.source_record_id=None;
        put_task(&connection,&value).unwrap();
        value.title="另一个窗口修改的名称".into();value.due_date=Some("2026-11-02".into());
        put_task(&connection,&value).unwrap();
        patch_task_status(&connection,&value.id,"done","todo").unwrap();
        let loaded=read_workspace(&connection).unwrap();
        assert_eq!(loaded.tasks[0].title,value.title);assert_eq!(loaded.tasks[0].due_date,value.due_date);assert_eq!(loaded.tasks[0].status,"done");
        assert!(patch_task_status(&connection,&value.id,"done","todo").is_err());
        patch_task_status(&connection,&value.id,"todo","done").unwrap();
        assert_eq!(read_workspace(&connection).unwrap().tasks[0].status,"todo");
    }

    #[test]
    fn planner_maintenance_graces_legacy_done_then_trashes_it_without_touching_source_or_events(){
        let mut connection=database();let source=record("保留原稿");put_record(&connection,&source).unwrap();
        let mut done=task();done.status="done".into();put_task(&connection,&done).unwrap();
        let mut event=task();event.id="6f13ad86-8e17-4c10-bb19-0f0a9e250366".into();event.title="过去的行程".into();event.due_date=None;event.source_record_id=None;event.planner.kind="event".into();event.planner.event_date=Some("2026-10-01".into());put_task(&connection,&event).unwrap();
        assert!(maintain_into(&mut connection,"2026-10-30",true).unwrap());let old=existing_task(&connection,&done.id).unwrap().unwrap();
        assert!(old.planner.completed_at.is_none());assert_eq!(old.planner.cleanup_on.as_deref(),Some("2026-10-31"));
        assert!(!maintain_into(&mut connection,"2026-11-01",false).unwrap());assert!(existing_task(&connection,&done.id).unwrap().is_some());
        assert!(maintain_into(&mut connection,"2026-11-01",true).unwrap());assert!(existing_task(&connection,&done.id).unwrap().is_none());
        let data=read_workspace(&connection).unwrap();assert_eq!(data.records[0].body,source.body);assert_eq!(data.tasks[0].planner.kind,"event");
        restore_into(&connection,"task",&done.id).unwrap();let restored=existing_task(&connection,&done.id).unwrap().unwrap();assert_eq!(restored.status,"todo");assert!(restored.planner.cleanup_on.is_none());
        assert!(!maintain_into(&mut connection,"2026-11-02",true).unwrap());
    }

    #[test]
    fn event_fields_survive_backup_and_invalid_event_prevents_partial_import(){
        let mut connection=database();let mut event=task();event.due_date=None;event.source_record_id=None;event.planner.kind="event".into();event.planner.event_date=Some("2026-11-01".into());event.planner.location="图书馆".into();put_task(&connection,&event).unwrap();
        let snapshot=read_full_snapshot(&connection).unwrap();let mut other=database();merge_full_snapshot(&mut other,snapshot).unwrap();assert_eq!(read_workspace(&other).unwrap().tasks[0].planner.location,"图书馆");
        event.planner.end_date=Some("2026-10-01".into());assert!(merge_into(&mut connection,Workspace{records:vec![record("不应写入")],tasks:vec![event]}).is_err());assert!(read_workspace(&connection).unwrap().records.is_empty());
    }

    #[test]
    fn task_strip_never_restores_deleted_or_missing_tasks_or_accepts_invalid_status() {
        let connection=database();let mut value=task();value.source_record_id=None;put_task(&connection,&value).unwrap();
        assert!(patch_task_status(&connection,&value.id,"broken","todo").is_err());
        connection.execute("UPDATE tasks SET deleted_at='2026-10-29T00:00:00Z'",[]).unwrap();
        assert!(patch_task_status(&connection,&value.id,"done","todo").is_err());
        assert!(read_workspace(&connection).unwrap().tasks.is_empty());
        assert!(patch_task_status(&connection,"6f13ad86-8e17-4c10-bb19-0f0a9e250364","done","todo").is_err());
    }

    #[test]
    fn rich_document_and_memory_survive_full_backup_into_a_new_database() {
        let original=database();let mut value=record("排版原文");
        value.document=Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph","attrs":{"id":"stable-block"},"content":[{"type":"text","text":"中文正文","marks":[{"type":"bold"},{"type":"textStyle","attrs":{"color":"#aa3344"}}]}]}]}));
        value.highlights.push(Highlight{id:"418f8584-9370-471c-9eb8-04493cc50ac1".into(),start:0,end:4,text:value.body.clone(),created_at:value.created_at.clone(),stale:false});
        validate_record(&value).unwrap();put_record(&original,&value).unwrap();
        let json=serde_json::to_string(&read_full_snapshot(&original).unwrap()).unwrap();let mut restored=database();
        merge_full_snapshot(&mut restored,serde_json::from_str(&json).unwrap()).unwrap();
        let loaded=read_workspace(&restored).unwrap();assert_eq!(loaded.records[0].document,value.document);assert_eq!(loaded.records[0].highlights[0].text,value.body);
    }

    #[test]
    fn mismatched_rich_body_is_rejected_before_replacing_saved_content() {
        let mut connection=database();put_record(&connection,&record("原始内容")).unwrap();
        let mut value=record("不应覆盖");value.document=Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"与正文不同"}]}]}));
        assert!(merge_into(&mut connection,Workspace{records:vec![value],tasks:vec![]}).is_err());assert_eq!(read_workspace(&connection).unwrap().records[0].title,"原始内容");
    }

    #[test]
    fn native_roundtrip_preserves_fields_and_delete_unlinks_tasks() {
        let mut connection = database();
        merge_into(&mut connection, Workspace { records: vec![record("实验记录")], tasks: vec![task()] }).unwrap();
        let loaded = read_workspace(&connection).unwrap();
        assert_eq!(loaded.records[0].tags, vec!["研究"]);
        assert_eq!(loaded.tasks[0].source_record_id, Some(loaded.records[0].id.clone()));
        let json = serde_json::to_value(&loaded).unwrap();
        assert_eq!(json["records"][0]["recordType"], "work");
        assert_eq!(json["tasks"][0]["dueDate"], "2026-10-26");
        connection.execute("DELETE FROM records", []).unwrap();
        assert!(read_workspace(&connection).unwrap().tasks[0].source_record_id.is_none());
    }

    #[test]
    fn failed_native_import_rolls_back_earlier_record_changes() {
        let mut connection = database();
        put_record(&connection, &record("原始标题")).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'simulated failure'); END;").unwrap();
        assert!(merge_into(&mut connection, Workspace { records: vec![record("不应保留")], tasks: vec![task()] }).is_err());
        let loaded = read_workspace(&connection).unwrap();
        assert_eq!(loaded.records[0].title, "原始标题");
        assert!(loaded.tasks.is_empty());
    }

    #[test]
    fn trash_restore_preserves_content_and_source_in_either_order() {
        let mut connection = database();
        merge_into(&mut connection, Workspace { records: vec![record("可恢复")], tasks: vec![task()] }).unwrap();
        connection.execute("UPDATE records SET deleted_at='2026-10-26T01:00:00Z'", []).unwrap();
        assert!(read_workspace(&connection).unwrap().tasks[0].source_record_id.is_none());
        connection.execute("UPDATE tasks SET deleted_at='2026-10-26T01:01:00Z'", []).unwrap();
        assert_eq!(read_trash(&connection).unwrap().len(), 2);
        restore_into(&connection, "task", &task().id).unwrap();
        assert!(read_workspace(&connection).unwrap().tasks[0].source_record_id.is_none());
        restore_into(&connection, "record", &record("").id).unwrap();
        let workspace = read_workspace(&connection).unwrap();
        assert_eq!(workspace.records[0].body, "中文正文");
        assert_eq!(workspace.tasks[0].source_record_id, Some(record("").id));
        assert!(restore_into(&connection, "record", &record("").id).is_err());
    }

    #[test]
    fn restore_does_not_relink_a_task_edited_after_source_deletion() {
        let mut connection = database();
        merge_into(&mut connection, Workspace { records: vec![record("来源")], tasks: vec![task()] }).unwrap();
        connection.execute("UPDATE records SET deleted_at='2026-10-26T01:00:00Z'", []).unwrap();
        assert!(ensure_not_deleted(&connection, "records", &record("").id).is_err());
        let mut changed = task(); changed.title = "重新安排".into(); changed.source_record_id = None;
        put_task(&connection, &changed).unwrap();
        restore_into(&connection, "record", &record("").id).unwrap();
        let restored = read_workspace(&connection).unwrap();
        assert_eq!(restored.tasks[0].title, "重新安排");
        assert!(restored.tasks[0].source_record_id.is_none());
    }

    #[test]
    fn rejects_invalid_or_duplicate_backup_before_writing() {
        let mut connection = database();
        assert!(merge_into(&mut connection, Workspace { records: vec![record("重复"), record("重复")], tasks: vec![] }).is_err());
        let mut invalid = task();
        invalid.due_date = Some("2026-02-30".into());
        assert!(validate_task(&invalid).is_err());
        assert!(read_workspace(&connection).unwrap().records.is_empty());
    }

    #[test]
    fn complete_backup_restores_trash_and_original_task_sources_in_new_database() {
        let mut original = database();
        merge_into(&mut original, Workspace { records: vec![record("完整来源")], tasks: vec![task()] }).unwrap();
        original.execute("UPDATE records SET deleted_at='2026-10-26T01:00:00Z'", []).unwrap();
        original.execute("UPDATE tasks SET deleted_at='2026-10-26T01:01:00Z'", []).unwrap();
        let snapshot = read_full_snapshot(&original).unwrap();
        assert_eq!(snapshot.tasks[0].task.source_record_id, Some(record("").id));
        let encoded = serde_json::to_value(&snapshot).unwrap();
        assert_eq!(encoded["records"][0]["deletedAt"], "2026-10-26T01:00:00Z");
        let mut restored = database();
        merge_full_snapshot(&mut restored, snapshot).unwrap();
        assert_eq!(read_trash(&restored).unwrap().len(), 2);
        assert!(read_workspace(&restored).unwrap().records.is_empty());
        restore_into(&restored, "task", &task().id).unwrap();
        assert!(read_workspace(&restored).unwrap().tasks[0].source_record_id.is_none());
        restore_into(&restored, "record", &record("").id).unwrap();
        assert_eq!(read_workspace(&restored).unwrap().tasks[0].source_record_id, Some(record("").id));
    }

    #[test]
    fn complete_import_failure_rolls_back_content_and_trash_state() {
        let mut connection = database();
        put_record(&connection, &record("原始记录")).unwrap();
        connection.execute("UPDATE records SET deleted_at='2026-10-26T01:00:00Z'", []).unwrap();
        let before = serde_json::to_value(read_full_snapshot(&connection).unwrap()).unwrap();
        connection.execute_batch("CREATE TRIGGER reject_complete_task BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT,'complete import failure'); END;").unwrap();
        let snapshot = FullSnapshot { records: vec![StoredRecord { record: record("不应保留"), deleted_at: None }], tasks: vec![StoredTask { task: task(), deleted_at: None }] };
        assert!(merge_full_snapshot(&mut connection, snapshot).is_err());
        assert_eq!(serde_json::to_value(read_full_snapshot(&connection).unwrap()).unwrap(), before);
    }

    #[test]
    fn highlights_validate_utf16_and_survive_trash_backup_and_restore() {
        let connection = database();
        let mut value = record("重点来源");
        value.body = "😀重点原文".into();
        value.highlights.push(Highlight { id: "418f8584-9370-471c-9eb8-04493cc50ac1".into(), start: 2, end: 6, text: "重点原文".into(), created_at: value.created_at.clone(), stale: false });
        validate_record(&value).unwrap();
        put_record(&connection, &value).unwrap();
        assert_eq!(read_workspace(&connection).unwrap().records[0].highlights[0].start, 2);
        connection.execute("UPDATE records SET deleted_at='2026-10-26T01:00:00Z'", []).unwrap();
        let encoded = serde_json::to_string(&read_full_snapshot(&connection).unwrap()).unwrap();
        let snapshot: FullSnapshot = serde_json::from_str(&encoded).unwrap();
        let mut restored = database();
        merge_full_snapshot(&mut restored, snapshot).unwrap();
        restore_into(&restored, "record", &value.id).unwrap();
        assert_eq!(read_workspace(&restored).unwrap().records[0].highlights[0].text, "重点原文");
        value.highlights[0].text = "伪造原文".into();
        assert!(validate_record(&value).is_err());
    }

    #[test]
    fn inline_tag_document_round_trips_and_rejects_invalid_identity() {
        let connection = database();
        let mut value = record("关联标签");
        value.body = "#英语".into();value.tags = vec!["英语".into()];
        value.document = Some(serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"#英语","marks":[{"type":"tag","attrs":{"id":"418f8584-9370-471c-9eb8-04493cc50ac1"}},{"type":"italic"}]}]}]}));
        validate_record(&value).unwrap();put_record(&connection, &value).unwrap();
        assert_eq!(read_workspace(&connection).unwrap().records[0].document, value.document);
        value.document.as_mut().unwrap()["content"][0]["content"][0]["marks"][0]["attrs"]["id"] = serde_json::json!("bad-id");
        assert!(validate_record(&value).is_err());
    }

    #[test]
    fn v2_upgrade_and_legacy_json_default_to_empty_highlights_without_losing_content() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(include_str!("../migrations/001_initial.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/002_trash.sql")).unwrap();
        connection.execute("INSERT INTO records(id,title,body,record_type,tags_json,created_at,updated_at) VALUES (?1,'旧记录','原有正文','work','[]',?2,?2)", params![record("").id, "2026-10-25T10:00:00Z"]).unwrap();
        connection.execute_batch(include_str!("../migrations/003_highlights.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/004_rich_document.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/005_inline_tags.sql")).unwrap();
        connection.execute_batch(include_str!("../migrations/006_planner.sql")).unwrap();
        let loaded = read_workspace(&connection).unwrap();
        assert_eq!(loaded.records[0].body, "原有正文");
        assert!(loaded.records[0].highlights.is_empty());
        let mut json = serde_json::to_value(&loaded.records[0]).unwrap();
        json.as_object_mut().unwrap().remove("highlights");
        let legacy: Record = serde_json::from_value(json).unwrap();
        assert!(legacy.highlights.is_empty());
    }
}
