use crate::Database;
use chrono::{DateTime,Duration,Utc};
use rusqlite::{Connection,params};
use serde::Serialize;
use tauri::{AppHandle,State,WebviewWindow};

type Result<T>=std::result::Result<T,String>;
#[derive(Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct Policy{days:Option<u32>,enabled_at:String}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct Entry{kind:String,id:String,expires_at:Option<String>}
#[derive(Serialize)]
pub struct Info{policy:Policy,entries:Vec<Entry>}
fn valid(days:Option<u32>)->Result<()>{if days.is_none()||matches!(days,Some(7|30|90)){Ok(())}else{Err("保留期限不正确".into())}}
pub fn available(c:&Connection)->bool{c.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='trash_policy')",[],|r|r.get(0)).unwrap_or(false)}
pub fn is_purged(c:&Connection,kind:&str,id:&str)->bool{available(c)&&c.query_row("SELECT EXISTS(SELECT 1 FROM purged_items WHERE kind=?1 AND item_id=?2)",params![kind,id],|r|r.get(0)).unwrap_or(false)}
pub fn imported(c:&Connection,kind:&str,id:&str,deleted:bool)->Result<()>{
 if !available(c){return Ok(());}
 c.execute("DELETE FROM purged_items WHERE kind=?1 AND item_id=?2",params![kind,id]).map_err(|e|e.to_string())?;
 if deleted{c.execute("INSERT INTO trash_retention VALUES(?1,?2,?3) ON CONFLICT(kind,item_id) DO UPDATE SET started_at=excluded.started_at",params![kind,id,Utc::now().to_rfc3339()]).map_err(|e|e.to_string())?;}
 else{c.execute("DELETE FROM trash_retention WHERE kind=?1 AND item_id=?2",params![kind,id]).map_err(|e|e.to_string())?;}
 Ok(())
}
fn policy(c:&Connection)->Result<Policy>{c.query_row("SELECT days,enabled_at FROM trash_policy WHERE id=1",[],|r|Ok(Policy{days:r.get(0)?,enabled_at:r.get(1)?})).map_err(|e|e.to_string())}
fn expiry(deleted:&str,started:&str,p:&Policy)->Option<String>{
 let days=p.days?;let values=[deleted,started,&p.enabled_at].map(|s|DateTime::parse_from_rfc3339(s).ok());
 if values.iter().any(Option::is_none){return None;}
 values.into_iter().flatten().max().map(|start|(start+Duration::days(days.into())).with_timezone(&Utc).to_rfc3339())
}
fn entries(c:&Connection,p:&Policy)->Result<Vec<Entry>>{
 let mut query=c.prepare("SELECT 'record',r.id,r.deleted_at,COALESCE(t.started_at,?1) FROM records r LEFT JOIN trash_retention t ON t.kind='record' AND t.item_id=r.id WHERE r.deleted_at IS NOT NULL UNION ALL SELECT 'task',r.id,r.deleted_at,COALESCE(t.started_at,?1) FROM tasks r LEFT JOIN trash_retention t ON t.kind='task' AND t.item_id=r.id WHERE r.deleted_at IS NOT NULL").map_err(|e|e.to_string())?;
 let values=query.query_map([&p.enabled_at],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(|e|e.to_string())?;
 values.map(|row|{let(kind,id,deleted,started)=row.map_err(|e|e.to_string())?;Ok(Entry{kind,id,expires_at:expiry(&deleted,&started,p)})}).collect()
}
fn due(c:&Connection,p:&Policy,now:DateTime<Utc>)->Result<Vec<Entry>>{Ok(entries(c,p)?.into_iter().filter(|e|e.expires_at.as_deref().and_then(|s|DateTime::parse_from_rfc3339(s).ok()).is_some_and(|date|date<=now)).collect())}
fn purge(c:&Connection,items:&[Entry],now:DateTime<Utc>)->Result<()>{
 for item in items{
  // Invalidate whole creation journals, retaining only their content-free request IDs.
  c.execute("UPDATE creation_batches SET result_json=json_object('requestId',request_id,'records',json('[]'),'tasks',json('[]'),'undone',json('true'),'purged',json('true')),proposal_json='{}',undone=1 WHERE EXISTS(SELECT 1 FROM json_each(result_json,?1) WHERE json_extract(value,'$.id')=?2)",params![if item.kind=="record"{"$.records"}else{"$.tasks"},item.id]).map_err(|e|e.to_string())?;
  if item.kind=="record"{
   c.execute("DELETE FROM recovery_drafts WHERE id=?1",[&item.id]).map_err(|e|e.to_string())?;
   c.execute("UPDATE tasks SET source_record_id=NULL,updated_at=?2 WHERE source_record_id=?1",params![item.id,now.to_rfc3339()]).map_err(|e|e.to_string())?;
  }
  let sql=if item.kind=="record"{"DELETE FROM records WHERE id=?1 AND deleted_at IS NOT NULL"}else{"DELETE FROM tasks WHERE id=?1 AND deleted_at IS NOT NULL"};
  c.execute(sql,[&item.id]).map_err(|e|e.to_string())?;
  c.execute("INSERT OR IGNORE INTO purged_items VALUES(?1,?2)",params![item.kind,item.id]).map_err(|e|e.to_string())?;
  c.execute("DELETE FROM trash_retention WHERE kind=?1 AND item_id=?2",params![item.kind,item.id]).map_err(|e|e.to_string())?;
 }
 Ok(())
}
pub fn maintain(c:&mut Connection,now:DateTime<Utc>)->Result<bool>{
 if !available(c){return Ok(false);}let tx=c.transaction().map_err(|e|e.to_string())?;let items=due(&tx,&policy(&tx)?,now)?;purge(&tx,&items,now)?;tx.commit().map_err(|e|e.to_string())?;Ok(!items.is_empty())
}
fn proposed(c:&Connection,days:Option<u32>,now:DateTime<Utc>)->Result<Policy>{valid(days)?;let mut p=policy(c)?;if p.days.is_none()&&days.is_some(){p.enabled_at=now.to_rfc3339();}p.days=days;Ok(p)}
fn set_into(c:&mut Connection,days:Option<u32>,confirmed_count:usize,now:DateTime<Utc>)->Result<Info>{
 let tx=c.transaction().map_err(|e|e.to_string())?;let p=proposed(&tx,days,now)?;let items=due(&tx,&p,now)?;
 if items.len()!=confirmed_count{return Err("回收站内容有变化，请重新确认清理数量。".into());}
 tx.execute("UPDATE trash_policy SET days=?1,enabled_at=?2 WHERE id=1",params![p.days,p.enabled_at]).map_err(|e|e.to_string())?;purge(&tx,&items,now)?;
 let result=Info{entries:entries(&tx,&p)?,policy:p};tx.commit().map_err(|e|e.to_string())?;Ok(result)
}
#[tauri::command]
pub fn trash_retention_info(database:State<Database>)->Result<Info>{let c=database.0.lock().map_err(|_|"数据库当前不可用")?;let p=policy(&c)?;Ok(Info{entries:entries(&c,&p)?,policy:p})}
#[tauri::command]
pub fn preview_trash_retention(database:State<Database>,days:Option<u32>)->Result<usize>{let c=database.0.lock().map_err(|_|"数据库当前不可用")?;let now=Utc::now();Ok(due(&c,&proposed(&c,days,now)?,now)?.len())}
#[tauri::command]
pub fn set_trash_retention(app:AppHandle,window:WebviewWindow,database:State<Database>,days:Option<u32>,confirmed_count:usize)->Result<Info>{
 if window.label()!="main"{return Err("请从主窗口设置保留期限。".into());}
 let result={let mut c=database.0.lock().map_err(|_|"数据库当前不可用")?;set_into(&mut c,days,confirmed_count,Utc::now())?};crate::task_strip::changed(&app);Ok(result)
}
#[tauri::command]
pub fn purged_record_ids(database:State<Database>)->Result<Vec<String>>{let c=database.0.lock().map_err(|_|"数据库当前不可用")?;let mut q=c.prepare("SELECT item_id FROM purged_items WHERE kind='record'").map_err(|e|e.to_string())?;let rows=q.query_map([],|r|r.get(0)).map_err(|e|e.to_string())?;rows.collect::<std::result::Result<Vec<_>,_>>().map_err(|e|e.to_string())}

#[cfg(test)]
mod tests{
 use super::*;
 fn db()->Connection{
  let c=Connection::open_in_memory().unwrap();c.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
  for sql in [include_str!("../migrations/001_initial.sql"),include_str!("../migrations/002_trash.sql"),include_str!("../migrations/003_highlights.sql"),include_str!("../migrations/004_rich_document.sql"),include_str!("../migrations/005_inline_tags.sql"),include_str!("../migrations/006_planner.sql"),include_str!("../migrations/007_reminders.sql"),include_str!("../migrations/008_trash_retention.sql")]{c.execute_batch(sql).unwrap();}
  c.execute("UPDATE trash_policy SET enabled_at='2030-01-01T00:00:00Z'",[]).unwrap();c
 }
 fn now()->DateTime<Utc>{"2030-02-01T00:00:00Z".parse().unwrap()}
 fn record(c:&Connection,id:&str,deleted:Option<&str>){c.execute("INSERT INTO records(id,title,body,record_type,tags_json,created_at,updated_at,deleted_at) VALUES(?1,'原稿','private body','note','[]','2029-01-01T00:00:00Z','2029-01-01T00:00:00Z',?2)",params![id,deleted]).unwrap();}
 #[test]fn expiry_only_purges_deleted_items_and_detaches_surviving_sources(){
  let mut c=db();record(&c,"old",Some("2030-01-01T00:00:00Z"));record(&c,"new",Some("2030-01-20T00:00:00Z"));record(&c,"live",None);
  c.execute("INSERT INTO tasks(id,title,status,priority,source_record_id,created_at,updated_at) VALUES('t','keep','todo','normal','old','2029-01-01T00:00:00Z','2029-01-01T00:00:00Z')",[]).unwrap();
  c.execute("INSERT INTO recovery_drafts VALUES('old','{}','2030-01-01T00:00:00Z')",[]).unwrap();
  c.execute("INSERT INTO creation_batches VALUES('b',?1,?2,0)",params![r#"{"records":[{"id":"old","body":"private body"}],"tasks":[]}"#,r#"{"body":"private body"}"#]).unwrap();
  assert!(maintain(&mut c,now()).unwrap());assert_eq!(c.query_row("SELECT count(*) FROM records",[],|r|r.get::<_,i64>(0)).unwrap(),2);assert!(is_purged(&c,"record","old"));
  assert!(c.query_row("SELECT source_record_id FROM tasks WHERE id='t'",[],|r|r.get::<_,Option<String>>(0)).unwrap().is_none());assert_eq!(c.query_row("SELECT count(*) FROM recovery_drafts",[],|r|r.get::<_,i64>(0)).unwrap(),0);
  let journal:String=c.query_row("SELECT result_json||proposal_json FROM creation_batches WHERE request_id='b'",[],|r|r.get(0)).unwrap();assert!(!journal.contains("private body"));assert!(journal.contains("purged"));
 }
 #[test]fn shortening_requires_current_confirmation_and_wrong_count_rolls_back(){
  let mut c=db();record(&c,"a",Some("2030-01-01T00:00:00Z"));let time="2030-01-15T00:00:00Z".parse().unwrap();assert!(set_into(&mut c,Some(7),0,time).is_err());assert_eq!(policy(&c).unwrap().days,Some(30));
  assert!(set_into(&mut c,Some(7),1,time).is_ok());assert!(is_purged(&c,"record","a"));
 }
 #[test]fn disabling_and_reenabling_grants_a_new_period(){
  let mut c=db();record(&c,"a",Some("2030-01-01T00:00:00Z"));set_into(&mut c,None,0,now()).unwrap();assert!(!maintain(&mut c,now()+Duration::days(100)).unwrap());
  set_into(&mut c,Some(30),0,now()+Duration::days(100)).unwrap();assert!(!maintain(&mut c,now()+Duration::days(129)).unwrap());assert!(maintain(&mut c,now()+Duration::days(131)).unwrap());
 }
 #[test]fn deletion_failure_rolls_back_all_rows(){
  let mut c=db();record(&c,"a",Some("2030-01-01T00:00:00Z"));record(&c,"b",Some("2030-01-01T00:00:00Z"));c.execute_batch("CREATE TRIGGER refuse_delete BEFORE DELETE ON records WHEN OLD.id='b' BEGIN SELECT RAISE(ABORT,'simulated failure');END;").unwrap();
  assert!(maintain(&mut c,now()).is_err());assert_eq!(c.query_row("SELECT count(*) FROM records",[],|r|r.get::<_,i64>(0)).unwrap(),2);assert!(!is_purged(&c,"record","a"));
 }
 #[test]fn import_preserves_the_deletion_time_and_grants_fresh_grace(){
  let mut c=db();c.execute("UPDATE trash_policy SET enabled_at='2020-01-01T00:00:00Z'",[]).unwrap();record(&c,"a",Some("2020-01-01T00:00:00Z"));imported(&c,"record","a",true).unwrap();
  assert!(!maintain(&mut c,Utc::now()).unwrap());let item=entries(&c,&policy(&c).unwrap()).unwrap().remove(0);assert!(DateTime::parse_from_rfc3339(item.expires_at.as_ref().unwrap()).unwrap()>Utc::now()+Duration::days(29));
 }
 #[test]fn expired_task_cascades_its_reminder_without_touching_live_tasks(){
  let mut c=db();for(id,deleted)in[("old",Some("2030-01-01T00:00:00Z")),("live",None)]{c.execute("INSERT INTO tasks(id,title,status,priority,created_at,updated_at,deleted_at) VALUES(?1,'task','todo','normal','2029-01-01T00:00:00Z','2029-01-01T00:00:00Z',?2)",params![id,deleted]).unwrap();c.execute("INSERT INTO reminder_plans(task_id,due_key,due_at,first_at,second_at) VALUES(?1,'due',1,0,1)",[id]).unwrap();}
  assert!(maintain(&mut c,now()).unwrap());assert!(is_purged(&c,"task","old"));assert_eq!(c.query_row("SELECT task_id FROM reminder_plans",[],|r|r.get::<_,String>(0)).unwrap(),"live");assert_eq!(c.query_row("SELECT id FROM tasks",[],|r|r.get::<_,String>(0)).unwrap(),"live");
 }
}
