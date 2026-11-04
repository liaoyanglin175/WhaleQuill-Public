use serde::{Deserialize,Serialize};
use serde_json::{Value,json};
use rusqlite::{Connection,OptionalExtension,params};
use tauri::{AppHandle,State};
use crate::Database;

#[derive(Clone,Debug,Default,Deserialize,Serialize)]
#[serde(rename_all="camelCase",default,deny_unknown_fields)]
pub struct Item{pub kind:String,pub title:String,pub body:String,pub date:Option<String>,pub time:Option<String>,pub end_date:Option<String>,pub end_time:Option<String>,pub location:String,pub notes:String}
#[derive(Clone,Debug,Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct Proposal{pub items:Vec<Item>}
pub fn validate(proposal:&Proposal)->Result<(),String>{
 if proposal.items.is_empty()||proposal.items.len()>20{return Err("一次可创建1–20项，请缩小范围。".into());}
 for item in &proposal.items{
  if !matches!(item.kind.as_str(),"note"|"task"|"event")||item.title.trim().is_empty()||item.title.encode_utf16().count()>200||item.body.encode_utf16().count()>20000||item.location.chars().count()>200||item.notes.chars().count()>4000{return Err("请检查创建内容与名称长度。".into());}
  if let Some(date)=&item.date{chrono::NaiveDate::parse_from_str(date,"%Y-%m-%d").map_err(|_|"日期不正确")?;}
  if item.kind=="event"&&item.date.is_none(){return Err("请确认行程日期".into());}
  if item.kind!="event"&&(item.end_date.is_some()||item.end_time.is_some()){return Err("只有行程可设置结束时间".into());}
  let planner=crate::planner::PlannerData{kind:if item.kind=="event"{"event"}else{"task"}.into(),event_date:if item.kind=="event"{item.date.clone()}else{None},start_time:if item.kind=="event"{item.time.clone()}else{None},end_date:item.end_date.clone(),end_time:item.end_time.clone(),due_time:if item.kind=="task"{item.time.clone()}else{None},location:item.location.clone(),notes:item.notes.clone(),..Default::default()};
  planner.validate("todo",if item.kind=="task"{item.date.as_deref()}else{None})?;
 }Ok(())
}
fn commit_into(connection:&mut Connection,request_id:&str,mut proposal:Proposal)->Result<Value,String>{
 uuid::Uuid::parse_str(request_id).map_err(|_|"创建请求编号不正确")?;for item in &mut proposal.items{item.title=item.title.trim().to_string();}validate(&proposal)?;
 let proposal_json=serde_json::to_string(&proposal).map_err(|e|e.to_string())?;let transaction=connection.transaction().map_err(|e|e.to_string())?;
 let previous:Option<(String,bool,String)>=transaction.query_row("SELECT result_json,undone,proposal_json FROM creation_batches WHERE request_id=?1",[request_id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).optional().map_err(|e|e.to_string())?;
 if let Some((text,undone,previous_proposal))=previous{if serde_json::from_str::<Value>(&text).ok().is_some_and(|v|v["purged"]==true){return Err("这次创建包含已永久清理的内容，请重新生成。".into());}if undone{return Err("这次创建已撤销，请重新生成。".into());}if previous_proposal!=proposal_json{return Err("这次创建已确认，内容与上次不同；请先查看日程或随记。".into());}return serde_json::from_str(&text).map_err(|e|e.to_string());}
 let now=chrono::Utc::now().to_rfc3339();let mut records=Vec::new();let mut tasks=Vec::new();
 for item in proposal.items{
  let id=uuid::Uuid::new_v4().to_string();
  if item.kind=="note"{
   let value=json!({"id":id,"title":item.title,"body":item.body,"document":null,"recordType":"note","tags":[],"highlights":[],"createdAt":now,"updatedAt":now});
   let record:crate::notebook::Record=serde_json::from_value(value).map_err(|e|e.to_string())?;crate::notebook::validate_record(&record)?;crate::notebook::put_record(&transaction,&record)?;records.push(serde_json::to_value(record).map_err(|e|e.to_string())?);
  }else{
   let event=item.kind=="event";let value=json!({"id":id,"title":item.title,"status":"todo","priority":"normal","dueDate":if event{None}else{item.date.clone()},"dueTime":if !event&&item.date.is_some(){Some(item.time.clone().unwrap_or_else(||"23:59".into()))}else{None},"sourceRecordId":null,"createdAt":now,"updatedAt":now,"kind":if event{"event"}else{"task"},"eventDate":if event{item.date}else{None},"startTime":if event{item.time}else{None},"endDate":item.end_date,"endTime":item.end_time,"location":item.location,"notes":item.notes});
   let task:crate::notebook::Task=serde_json::from_value(value).map_err(|e|e.to_string())?;crate::notebook::validate_task(&task)?;crate::notebook::put_task(&transaction,&task)?;tasks.push(serde_json::to_value(task).map_err(|e|e.to_string())?);
  }
 }
 let result=json!({"requestId":request_id,"createdAt":now,"records":records,"tasks":tasks,"undone":false});
 transaction.execute("INSERT INTO creation_batches(request_id,result_json,proposal_json,undone) VALUES(?1,?2,?3,0)",params![request_id,result.to_string(),proposal_json]).map_err(|e|e.to_string())?;transaction.commit().map_err(|e|e.to_string())?;Ok(result)
}
fn undo_into(connection:&mut Connection,request_id:&str)->Result<(),String>{
 uuid::Uuid::parse_str(request_id).map_err(|_|"创建请求编号不正确")?;let transaction=connection.transaction().map_err(|e|e.to_string())?;
 let (text,undone):(String,bool)=transaction.query_row("SELECT result_json,undone FROM creation_batches WHERE request_id=?1",[request_id],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|_|"找不到这次创建")?;if serde_json::from_str::<Value>(&text).ok().is_some_and(|v|v["purged"]==true){return Err("这次创建包含已永久清理的内容，无法整批撤销。".into());}if undone{return Ok(());}
 let saved:Value=serde_json::from_str(&text).map_err(|e|e.to_string())?;let current=serde_json::to_value(crate::notebook::read_items(&transaction,false)?).map_err(|e|e.to_string())?;
 for group in ["records","tasks"]{for item in saved[group].as_array().ok_or("创建记录不完整")?{if !current[group].as_array().unwrap().iter().any(|value|value==item){return Err("其中内容已修改或删除，未撤销；请到对应页面处理。".into());}}}
 let now=chrono::Utc::now().to_rfc3339();for group in ["records","tasks"]{let sql=if group=="records"{"UPDATE records SET deleted_at=?2 WHERE id=?1"}else{"UPDATE tasks SET deleted_at=?2 WHERE id=?1"};for item in saved[group].as_array().unwrap(){transaction.execute(sql,params![item["id"].as_str(),now]).map_err(|e|e.to_string())?;}}
 transaction.execute("UPDATE creation_batches SET undone=1 WHERE request_id=?1",[request_id]).map_err(|e|e.to_string())?;transaction.commit().map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]
pub fn commit_creation(app:AppHandle,database:State<Database>,request_id:String,proposal:Proposal)->Result<Value,String>{let result={let mut connection=database.0.lock().map_err(|_|"数据库不可用")?;commit_into(&mut connection,&request_id,proposal)?};crate::task_strip::changed(&app);Ok(result)}
#[tauri::command]
pub fn undo_creation(app:AppHandle,database:State<Database>,request_id:String)->Result<(),String>{{let mut connection=database.0.lock().map_err(|_|"数据库不可用")?;undo_into(&mut connection,&request_id)?;}crate::task_strip::changed(&app);Ok(())}
#[cfg(test)]mod tests{
 use super::*;
 fn db()->Connection{let c=Connection::open_in_memory().unwrap();for sql in [include_str!("../migrations/001_initial.sql"),include_str!("../migrations/002_trash.sql"),include_str!("../migrations/003_highlights.sql"),include_str!("../migrations/004_rich_document.sql"),include_str!("../migrations/005_inline_tags.sql"),include_str!("../migrations/006_planner.sql"),include_str!("../migrations/007_reminders.sql")]{c.execute_batch(sql).unwrap();}c}
 #[test]fn explicit_commit_is_atomic_idempotent_and_undo_refuses_changed_content(){let mut c=db();let id=uuid::Uuid::new_v4().to_string();let proposal=Proposal{items:vec![Item{kind:"note".into(),title:"旅行想法".into(),body:"先保留草案".into(),..Default::default()},Item{kind:"event".into(),title:"去看展".into(),date:Some("2030-12-30".into()),time:Some("14:00".into()),..Default::default()}]};let result=commit_into(&mut c,&id,proposal.clone()).unwrap();assert_eq!(commit_into(&mut c,&id,proposal.clone()).unwrap(),result);assert_eq!(c.query_row("SELECT count(*) FROM records",[],|r|r.get::<_,i64>(0)).unwrap(),1);c.execute("UPDATE records SET body='用户后来修改'",[]).unwrap();assert!(undo_into(&mut c,&id).is_err());assert_eq!(c.query_row("SELECT count(*) FROM tasks WHERE deleted_at IS NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);}
 #[test]fn invalid_batch_writes_nothing_and_safe_undo_is_recoverable(){let mut c=db();let id=uuid::Uuid::new_v4().to_string();let invalid=Proposal{items:vec![Item{kind:"note".into(),title:"不能部分写入".into(),..Default::default()},Item{kind:"event".into(),title:"缺日期".into(),..Default::default()}]};assert!(commit_into(&mut c,&id,invalid).is_err());assert_eq!(c.query_row("SELECT count(*) FROM records",[],|r|r.get::<_,i64>(0)).unwrap(),0);commit_into(&mut c,&id,Proposal{items:vec![Item{kind:"task".into(),title:"准备资料".into(),..Default::default()}]}).unwrap();undo_into(&mut c,&id).unwrap();assert_eq!(c.query_row("SELECT count(*) FROM tasks WHERE deleted_at IS NOT NULL",[],|r|r.get::<_,i64>(0)).unwrap(),1);}
}
