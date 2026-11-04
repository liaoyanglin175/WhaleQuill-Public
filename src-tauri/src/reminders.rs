use chrono::{Local,NaiveDate,TimeZone};
use rusqlite::{params,Connection};
use serde::Serialize;
use tauri::{AppHandle,Manager,Emitter};
use crate::Database;

#[derive(Clone,Serialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Notice{pub task_id:String,pub title:String,pub due_at:i64,pub sent_at:i64}
/// Persist once when the deadline changes; refreshing never pushes a plan away.
pub fn times(now:i64,due:i64)->(i64,i64){let remaining=(due-now).max(0);(due-21_600_000_i64.min(remaining/2),due-3_600_000_i64.min(remaining/5))}
fn deadline(date:&str,time:Option<&str>)->Option<i64>{let date=NaiveDate::parse_from_str(date,"%Y-%m-%d").ok()?;let time=chrono::NaiveTime::parse_from_str(time.unwrap_or("23:59"),"%H:%M").ok()?;Local.from_local_datetime(&date.and_time(time)).earliest().map(|d|d.timestamp_millis())}
fn pending_mask(now:i64,due:i64,first:i64,second:i64,sent:i64)->i64{if now>=due{return 0;}let first_bit=if now>=first{1}else{0};let second_bit=if now>=second{2}else{0};(first_bit|second_bit)&!sent}
pub fn collect(connection:&mut Connection,now:i64)->Result<Vec<Notice>,String>{
 let transaction=connection.transaction().map_err(|e|e.to_string())?;
 // Status/date are the source of truth, including changes made during a reminder.
 transaction.execute("DELETE FROM reminder_plans WHERE NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.deleted_at IS NULL AND t.status='todo' AND t.due_date IS NOT NULL AND COALESCE(json_extract(t.planner_json,'$.kind'),'task')='task')",[]).map_err(|e|e.to_string())?;
 let tasks={let mut q=transaction.prepare("SELECT id,title,due_date,planner_json FROM tasks WHERE deleted_at IS NULL AND status='todo' AND due_date IS NOT NULL AND COALESCE(json_extract(planner_json,'$.kind'),'task')='task'").map_err(|e|e.to_string())?;let rows=q.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())?};
 let mut notices=Vec::new();
 for (id,title,date,json) in tasks{
  let planner:crate::planner::PlannerData=serde_json::from_str(&json).map_err(|e|e.to_string())?;let Some(due)=deadline(&date,planner.due_time.as_deref()) else{continue;};let key=format!("{}T{}",date,planner.due_time.as_deref().unwrap_or("23:59"));let (first,second)=times(now,due);
  transaction.execute("INSERT INTO reminder_plans(task_id,due_key,due_at,first_at,second_at) VALUES(?1,?2,?3,?4,?5) ON CONFLICT(task_id) DO UPDATE SET due_key=excluded.due_key,due_at=excluded.due_at,first_at=excluded.first_at,second_at=excluded.second_at,sent_mask=0,last_sent_at=NULL WHERE reminder_plans.due_key<>excluded.due_key OR reminder_plans.due_at<>excluded.due_at",params![id,key,due,first,second]).map_err(|e|e.to_string())?;
  let (first,second,sent):(i64,i64,i64)=transaction.query_row("SELECT first_at,second_at,sent_mask FROM reminder_plans WHERE task_id=?1",[&id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).map_err(|e|e.to_string())?;
  let mask=pending_mask(now,due,first,second,sent);
  if mask!=0{
   // Sub-minute schedules collapse into the first meaningful prompt.
   let mask=if second-first<60_000{3}else{mask};
   transaction.execute("UPDATE reminder_plans SET sent_mask=sent_mask|?2,last_sent_at=?3 WHERE task_id=?1",params![id,mask,now]).map_err(|e|e.to_string())?;
   notices.push(Notice{task_id:id,title,due_at:due,sent_at:now});
  }
 }
 transaction.commit().map_err(|e|e.to_string())?;Ok(notices)
}
fn remaining(due:i64,now:i64,en:bool)->String{let minutes=((due-now).max(0)+59_999)/60_000;let hours=minutes/60;let minutes=minutes%60;if en{format!("{}h {}m remaining",hours,minutes)}else{format!("距截止还有{}小时{}分",hours,minutes)}}
pub fn poll(app:&AppHandle){
 if !crate::task_strip::reminders_enabled(app){return;}
 let now=chrono::Utc::now().timestamp_millis();let result=app.state::<Database>().0.lock().map_err(|_|"数据库不可用".to_string()).and_then(|mut c|collect(&mut c,now));
 match result{Ok(notices) if !notices.is_empty()=>{
  let en=crate::task_strip::language(app)=="en";let title=if notices.len()==1{notices[0].title.clone()}else if en{format!("{} tasks need attention",notices.len())}else{format!("{}项待办需要留意",notices.len())};
  let nearest=notices.iter().map(|n|n.due_at).min().unwrap();let body=format!("{}\n{}",remaining(nearest,now,en),if en{"Click to view your task note"}else{"点击查看便签"});
  if let Err(error)=crate::desktop_tray::notify(&title,&body){let _=app.emit("task-strip-error",error);}
  let _=app.emit("task-reminder",&notices);
 },Err(error)=>{let _=app.emit("task-strip-error",error);},_=>{}}
}
#[tauri::command]
pub fn reminder_notices(database:tauri::State<Database>)->Result<Vec<Notice>,String>{
 let c=database.0.lock().map_err(|_|"数据库不可用")?;let mut q=c.prepare("SELECT t.id,t.title,p.due_at,p.last_sent_at FROM reminder_plans p JOIN tasks t ON t.id=p.task_id WHERE t.deleted_at IS NULL AND t.status='todo' AND p.last_sent_at IS NOT NULL ORDER BY p.last_sent_at DESC LIMIT 20").map_err(|e|e.to_string())?;
 let rows=q.query_map([],|r|Ok(Notice{task_id:r.get(0)?,title:r.get(1)?,due_at:r.get(2)?,sent_at:r.get(3)?})).map_err(|e|e.to_string())?;rows.collect::<Result<Vec<_>,_>>().map_err(|e|e.to_string())
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn future_slots_shrink_and_do_not_fire_on_creation(){for remaining in [60_000,3_600_000,6*3_600_000,24*3_600_000,30*24*3_600_000]{let (a,b)=times(0,remaining);assert!(a>0&&a<b&&b<remaining);assert_eq!(pending_mask(0,remaining,a,b,0),0);}assert_eq!(times(0,24*3_600_000),(18*3_600_000,23*3_600_000));}
 #[test]fn wake_merges_and_sent_stages_never_repeat(){assert_eq!(pending_mask(80,100,40,70,0),3);assert_eq!(pending_mask(80,100,40,70,1),2);assert_eq!(pending_mask(80,100,40,70,3),0);assert_eq!(pending_mask(101,100,40,70,0),0);}
 #[test]fn sqlite_plan_survives_refresh_merges_wake_and_cancels_completed_or_retimed_tasks(){
  let mut c=Connection::open_in_memory().unwrap();
  for sql in [include_str!("../migrations/001_initial.sql"),include_str!("../migrations/002_trash.sql"),include_str!("../migrations/006_planner.sql"),include_str!("../migrations/007_reminders.sql")]{c.execute_batch(sql).unwrap();}
  c.execute("INSERT INTO tasks(id,title,status,priority,due_date,created_at,updated_at,planner_json) VALUES('task','短时任务','todo','normal','2030-12-30','now','now','{}')",[]).unwrap();
  let due=deadline("2030-12-30",None).unwrap();let now=due-24*3_600_000;
  assert!(collect(&mut c,now).unwrap().is_empty());let initial:(i64,i64)=c.query_row("SELECT first_at,second_at FROM reminder_plans",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
  assert!(collect(&mut c,now+1000).unwrap().is_empty());assert_eq!(initial,c.query_row("SELECT first_at,second_at FROM reminder_plans",[],|r|Ok((r.get(0)?,r.get(1)?))).unwrap());
  assert_eq!(collect(&mut c,due-30*60_000).unwrap().len(),1);assert!(collect(&mut c,due-20*60_000).unwrap().is_empty());
  c.execute("UPDATE tasks SET due_date='2030-12-31'",[]).unwrap();assert!(collect(&mut c,due).unwrap().is_empty());assert_eq!(c.query_row("SELECT sent_mask FROM reminder_plans",[],|r|r.get::<_,i64>(0)).unwrap(),0);
  c.execute("UPDATE tasks SET status='done'",[]).unwrap();collect(&mut c,due).unwrap();assert_eq!(c.query_row("SELECT count(*) FROM reminder_plans",[],|r|r.get::<_,i64>(0)).unwrap(),0);
 }
}
