//! Complete backups: bounded line buffers, integrity checked before preview, atomic file replacement.
use crate::{Database,notebook::{self,FullSnapshot,StoredRecord,StoredTask}};
use serde::Serialize;
use serde_json::{Value,json};
use sha2::{Digest,Sha256};
use std::{fs::{self,File,OpenOptions},io::{Read,Write,BufRead,BufReader,BufWriter},path::{Path,PathBuf},sync::{Mutex,Arc,atomic::{AtomicBool,Ordering}}};
use tauri::{AppHandle,Emitter,Manager,WebviewWindow};
type Result<T>=std::result::Result<T,String>;
const LINE_LIMIT:u64=64*1024*1024;
const LEGACY_LIMIT:u64=20*1024*1024;
struct Job{token:String,cancel:Arc<AtomicBool>,snapshot:Option<FullSnapshot>}
pub struct BackupState(Mutex<Option<Job>>);
pub fn initialize(app:&AppHandle){app.manage(BackupState(Mutex::new(None)));}
fn checked(cancel:&AtomicBool)->Result<()>{if cancel.load(Ordering::Relaxed){Err("备份操作已取消。".into())}else{Ok(())}}
fn chain(previous:&[u8;32],line:&[u8])->[u8;32]{let mut hash=Sha256::new();hash.update(previous);hash.update(line);hash.finalize().into()}
fn hex(value:&[u8;32])->String{value.iter().map(|b|format!("{b:02x}")).collect()}
fn encoded(value:&Value)->Result<Vec<u8>>{let mut bytes=serde_json::to_vec(value).map_err(|e|e.to_string())?;bytes.push(b'\n');if bytes.len() as u64>LINE_LIMIT{return Err("单条备份内容超过64MB，请检查排版内容。".into());}Ok(bytes)}
pub(crate) fn write_archive(writer:&mut impl Write,snapshot:&FullSnapshot,cancel:&AtomicBool,mut progress:impl FnMut(usize,usize,u64))->Result<u64>{
 let header=encoded(&json!({"application":"whale-quill-stream","version":8,"exportedAt":chrono::Utc::now().to_rfc3339(),"records":snapshot.records.len(),"tasks":snapshot.tasks.len()}))?;
 writer.write_all(&header).map_err(|e|e.to_string())?;let mut checksum=chain(&[0;32],&header);let mut bytes=header.len() as u64;let total=snapshot.records.len()+snapshot.tasks.len();let mut done=0;
 let mut item=|kind:&str,value:Value|->Result<()>{checked(cancel)?;let line=encoded(&json!({"kind":kind,"value":value}))?;checksum=chain(&checksum,&line);writer.write_all(&line).map_err(|e|e.to_string())?;bytes+=line.len() as u64;done+=1;progress(done,total,bytes);Ok(())};
 for value in &snapshot.records{item("record",serde_json::to_value(value).map_err(|e|e.to_string())?)?;}
 for value in &snapshot.tasks{item("task",serde_json::to_value(value).map_err(|e|e.to_string())?)?;}
 checked(cancel)?;let end=encoded(&json!({"kind":"end","records":snapshot.records.len(),"tasks":snapshot.tasks.len(),"sha256":hex(&checksum)}))?;writer.write_all(&end).map_err(|e|e.to_string())?;Ok(bytes+end.len() as u64)
}
pub(crate) fn read_archive(reader:impl Read,cancel:&AtomicBool,mut progress:impl FnMut(usize,usize,u64))->Result<FullSnapshot>{
 let mut reader=BufReader::new(reader);let mut first=Vec::new();reader.by_ref().take(LINE_LIMIT+1).read_until(b'\n',&mut first).map_err(|e|e.to_string())?;if first.len() as u64>LINE_LIMIT{return Err("备份行过大。".into());}
 let header=serde_json::from_slice::<Value>(&first).ok();
 if header.as_ref().and_then(|v|v.get("application")).and_then(Value::as_str)!=Some("whale-quill-stream"){
  if first.len() as u64>LEGACY_LIMIT{return Err("旧JSON备份不能超过20MB，请使用逐条备份格式。".into());}
  let mut rest=Vec::new();reader.take(LEGACY_LIMIT+1-first.len() as u64).read_to_end(&mut rest).map_err(|e|e.to_string())?;first.extend(rest);checked(cancel)?;if first.len() as u64>LEGACY_LIMIT{return Err("旧JSON备份不能超过20MB，请使用逐条备份格式。".into());}
  let value:Value=serde_json::from_slice(&first).map_err(|_|"无法读取JSON备份文件。")?;if value["application"]!="dafeiyu-notebook"{return Err("不是鲸笺备份文件。".into());}
  let version=value["version"].as_u64().ok_or("备份版本不正确。")?;
  let mut snapshot:FullSnapshot=if version==1{serde_json::from_value(value["workspace"].clone())}else if (2..=7).contains(&version){serde_json::from_value(value["snapshot"].clone())}else{return Err("备份版本不支持。".into());}.map_err(|e|e.to_string())?;notebook::validate_snapshot(&mut snapshot)?;return Ok(snapshot);
 }
 let header=header.unwrap();let record_count=header["records"].as_u64().filter(|n|*n<=50000).ok_or("备份记录数量不正确。")? as usize;let task_count=header["tasks"].as_u64().filter(|n|*n<=50000).ok_or("备份任务数量不正确。")? as usize;
 if header["version"]!=8||chrono::DateTime::parse_from_rfc3339(header["exportedAt"].as_str().unwrap_or("")).is_err(){return Err("备份头信息不正确。".into());}
 let mut checksum=chain(&[0;32],&first);let mut bytes=first.len() as u64;let mut records:Vec<StoredRecord>=Vec::new();let mut tasks:Vec<StoredTask>=Vec::new();let mut ended=false;
 loop{checked(cancel)?;let mut line=Vec::new();reader.by_ref().take(LINE_LIMIT+1).read_until(b'\n',&mut line).map_err(|e|e.to_string())?;if line.is_empty(){break;}if ended{return Err("备份结束标记后仍有内容。".into());}if line.len() as u64>LINE_LIMIT||line.last()!=Some(&b'\n'){return Err("备份行过大或缺少完整结束标记。".into());}bytes+=line.len() as u64;
  let value:Value=serde_json::from_slice(&line).map_err(|_|"备份行格式不正确。")?;
  match value["kind"].as_str(){Some("record")=>{if !tasks.is_empty()||records.len()>=record_count{return Err("备份记录顺序或数量不正确。".into());}records.push(serde_json::from_value(value["value"].clone()).map_err(|e|e.to_string())?);},Some("task")=>{if records.len()!=record_count||tasks.len()>=task_count{return Err("备份任务顺序或数量不正确。".into());}tasks.push(serde_json::from_value(value["value"].clone()).map_err(|e|e.to_string())?);},Some("end")=>{if value["records"]!=records.len()||value["tasks"]!=tasks.len()||records.len()!=record_count||tasks.len()!=task_count||value["sha256"]!=hex(&checksum){return Err("备份不完整或校验失败，未导入任何内容。".into());}ended=true;continue;},_=>return Err("备份条目类型不正确。".into())}
  checksum=chain(&checksum,&line);progress(records.len()+tasks.len(),record_count+task_count,bytes);
 }
 if !ended{return Err("备份不完整，未导入任何内容。".into());}let mut snapshot=FullSnapshot{records,tasks};notebook::validate_snapshot(&mut snapshot)?;Ok(snapshot)
}
struct PartialFile(PathBuf);impl Drop for PartialFile{fn drop(&mut self){let _=fs::remove_file(&self.0);}}
fn atomic_export(path:&Path,snapshot:&FullSnapshot,cancel:&AtomicBool,progress:impl FnMut(usize,usize,u64))->Result<u64>{
 let temporary=path.with_file_name(format!(".whale-quill-{}.partial",uuid::Uuid::new_v4()));let guard=PartialFile(temporary.clone());let file=OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e|e.to_string())?;let mut writer=BufWriter::new(file);
 let bytes=write_archive(&mut writer,snapshot,cancel,progress)?;writer.flush().and_then(|_|writer.get_ref().sync_all()).map_err(|e|e.to_string())?;drop(writer);checked(cancel)?;fs::rename(&temporary,path).map_err(|e|e.to_string())?;drop(guard);Ok(bytes)
}
fn begin(app:&AppHandle,token:&str)->Result<Arc<AtomicBool>>{uuid::Uuid::parse_str(token).map_err(|_|"备份操作标识不正确。")?;let state=app.state::<BackupState>();let mut current=state.0.lock().map_err(|_|"备份状态不可用。")?;if current.is_some(){return Err("另一个备份操作尚未结束。".into());}let cancel=Arc::new(AtomicBool::new(false));*current=Some(Job{token:token.into(),cancel:cancel.clone(),snapshot:None});Ok(cancel)}
fn finish(app:&AppHandle,token:&str){if let Ok(mut job)=app.state::<BackupState>().0.lock(){if job.as_ref().is_some_and(|j|j.token==token){*job=None;}}}
fn main_only(window:&WebviewWindow)->Result<()>{if window.label()=="main"{Ok(())}else{Err("请从主窗口管理备份。".into())}}
fn selected(export:bool,language:&str)->Result<Option<PathBuf>>{
 // Only isolated debug tests may bypass the system picker, and only inside their own data directory.
 if cfg!(debug_assertions){if let (Some(root),Some(path))=(std::env::var_os("DAFEIYU_TEST_DATA_DIR"),std::env::var_os(if export{"DAFEIYU_TEST_BACKUP_EXPORT"}else{"DAFEIYU_TEST_BACKUP_IMPORT"})){
  let root=fs::canonicalize(root).map_err(|e|e.to_string())?;let path=PathBuf::from(path);let parent=fs::canonicalize(path.parent().ok_or("测试路径不正确")?).map_err(|e|e.to_string())?;if !parent.starts_with(&root){return Err("测试备份路径越界。".into());}return Ok(Some(parent.join(path.file_name().ok_or("测试路径不正确")?)));
 }}
 let dialog=rfd::FileDialog::new().set_title(if language=="en"{if export{"Export complete backup"}else{"Import backup"}}else{if export{"完整备份"}else{"导入备份"}});
 Ok(if export{dialog.add_filter("WhaleQuill backup",&["wqbackup"]).set_file_name(format!("Whale-Quill-{}.wqbackup",chrono::Local::now().format("%Y-%m-%d"))).save_file()}else{dialog.add_filter("WhaleQuill backup",&["wqbackup","json"]).pick_file()})
}
fn progress(app:&AppHandle,token:&str,done:usize,total:usize,bytes:u64){if done%64==0||done==total{let _=app.emit_to("main","backup-progress",json!({"token":token,"done":done,"total":total,"bytes":bytes}));}}
#[derive(Serialize)]pub struct ExportResult{bytes:u64,records:usize,tasks:usize}
#[derive(Serialize)]pub struct Preview{token:String,records:usize,tasks:usize,deleted:usize,collisions:usize,bytes:u64}
#[tauri::command]
pub async fn export_complete_backup(app:AppHandle,window:WebviewWindow,token:String,language:String)->Result<Option<ExportResult>>{
 main_only(&window)?;let cancel=begin(&app,&token)?;let handle=app.clone();let key=token.clone();let result=tauri::async_runtime::spawn_blocking(move||{
  let Some(path)=selected(true,&language)?else{return Ok(None);};checked(&cancel)?;
  let snapshot={let database=handle.state::<Database>();let c=database.0.lock().map_err(|_|"数据库当前不可用")?;notebook::read_full_snapshot(&c)?};
  let bytes=atomic_export(&path,&snapshot,&cancel,|done,total,bytes|progress(&handle,&key,done,total,bytes))?;Ok(Some(ExportResult{bytes,records:snapshot.records.len(),tasks:snapshot.tasks.len()}))
 }).await.map_err(|e|e.to_string()).and_then(|r|r);finish(&app,&token);result
}
#[tauri::command]
pub async fn preview_complete_backup(app:AppHandle,window:WebviewWindow,token:String,language:String)->Result<Option<Preview>>{
 main_only(&window)?;let cancel=begin(&app,&token)?;let handle=app.clone();let key=token.clone();let result=tauri::async_runtime::spawn_blocking(move||{
  let Some(path)=selected(false,&language)?else{return Ok(None);};let file=File::open(&path).map_err(|e|e.to_string())?;let bytes=file.metadata().map_err(|e|e.to_string())?.len();let snapshot=read_archive(file,&cancel,|done,total,bytes|progress(&handle,&key,done,total,bytes))?;
  let collisions={let database=handle.state::<Database>();let c=database.0.lock().map_err(|_|"数据库当前不可用")?;let mut count=0;for record in &snapshot.records{count+=c.query_row("SELECT EXISTS(SELECT 1 FROM records WHERE id=?1)",[&record.record.id],|r|r.get::<_,usize>(0)).map_err(|e|e.to_string())?;}for task in &snapshot.tasks{count+=c.query_row("SELECT EXISTS(SELECT 1 FROM tasks WHERE id=?1)",[&task.task.id],|r|r.get::<_,usize>(0)).map_err(|e|e.to_string())?;}count};
  let preview=Preview{token:key.clone(),records:snapshot.records.len(),tasks:snapshot.tasks.len(),deleted:snapshot.records.iter().filter(|r|r.deleted_at.is_some()).count()+snapshot.tasks.iter().filter(|t|t.deleted_at.is_some()).count(),collisions,bytes};checked(&cancel)?;let state=handle.state::<BackupState>();let mut state=state.0.lock().map_err(|_|"备份状态不可用")?;let job=state.as_mut().filter(|j|j.token==key).ok_or("备份操作已取消。")?;checked(&job.cancel)?;job.snapshot=Some(snapshot);Ok(Some(preview))
 }).await.map_err(|e|e.to_string()).and_then(|r|r);if !matches!(result,Ok(Some(_))){finish(&app,&token);}result
}
#[tauri::command]
pub async fn commit_complete_backup(app:AppHandle,window:WebviewWindow,token:String)->Result<()>{
 main_only(&window)?;let handle=app.clone();tauri::async_runtime::spawn_blocking(move||{
  let state=handle.state::<BackupState>();let mut state=state.0.lock().map_err(|_|"备份状态不可用")?;let job=state.as_mut().filter(|j|j.token==token).ok_or("请重新选择备份文件。")?;checked(&job.cancel)?;let snapshot=job.snapshot.as_mut().ok_or("备份尚未校验完成。")?;
  {let database=handle.state::<Database>();let mut c=database.0.lock().map_err(|_|"数据库当前不可用")?;notebook::merge_snapshot_ref(&mut c,snapshot)?;}*state=None;drop(state);crate::task_strip::changed(&handle);Ok(())
 }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn cancel_complete_backup(app:AppHandle,window:WebviewWindow,token:String)->Result<()>{main_only(&window)?;let state=app.state::<BackupState>();let mut state=state.0.lock().map_err(|_|"备份状态不可用")?;if let Some(job)=state.as_mut().filter(|j|j.token==token){job.cancel.store(true,Ordering::Relaxed);if job.snapshot.is_some(){*state=None;}}Ok(())}

#[cfg(test)]mod tests{
 use super::*;
 fn snapshot()->FullSnapshot{let record_id=uuid::Uuid::new_v4().to_string();serde_json::from_value(json!({"records":[{"id":record_id,"title":"原稿","body":"中文🌊\n原样保留","document":null,"recordType":"note","tags":["旅行"],"highlights":[],"createdAt":"2026-10-20T00:00:00Z","updatedAt":"2026-10-20T00:00:00Z","deletedAt":null}],"tasks":[{"id":uuid::Uuid::new_v4().to_string(),"title":"出发准备","status":"todo","priority":"normal","dueDate":"2030-12-30","dueTime":"20:00","sourceRecordId":record_id,"createdAt":"2026-10-20T00:00:00Z","updatedAt":"2026-10-20T00:00:00Z","deletedAt":null}]})).unwrap()}
 #[test]fn roundtrip_retains_unicode_and_task_sources(){let original=snapshot();let mut bytes=Vec::new();write_archive(&mut bytes,&original,&AtomicBool::new(false),|_,_,_|{}).unwrap();let result=read_archive(bytes.as_slice(),&AtomicBool::new(false),|_,_,_|{}).unwrap();assert_eq!(serde_json::to_value(result).unwrap(),serde_json::to_value(original).unwrap());}
 #[test]fn damaged_or_truncated_backup_never_returns_a_snapshot(){let mut bytes=Vec::new();write_archive(&mut bytes,&snapshot(),&AtomicBool::new(false),|_,_,_|{}).unwrap();let text=String::from_utf8(bytes).unwrap();for damaged in [text.replace("原稿","改稿"),text.lines().take(2).collect::<Vec<_>>().join("\n"),format!("{text}{{}}\n")]{assert!(read_archive(damaged.as_bytes(),&AtomicBool::new(false),|_,_,_|{}).is_err());}}
 #[test]fn legacy_versions_remain_importable(){for version in 1..=7{let original=snapshot();let value=if version==1{json!({"application":"dafeiyu-notebook","version":version,"workspace":original})}else{json!({"application":"dafeiyu-notebook","version":version,"snapshot":original})};assert!(read_archive(serde_json::to_vec_pretty(&value).unwrap().as_slice(),&AtomicBool::new(false),|_,_,_|{}).is_ok());}}
 #[test]fn cancellation_does_not_replace_existing_backup_or_leave_partial_file(){let directory=std::env::temp_dir().join(format!("whale-quill-backup-test-{}",uuid::Uuid::new_v4()));fs::create_dir(&directory).unwrap();let path=directory.join("existing.wqbackup");fs::write(&path,b"previous backup").unwrap();assert!(atomic_export(&path,&snapshot(),&AtomicBool::new(true),|_,_,_|{}).is_err());assert_eq!(fs::read(&path).unwrap(),b"previous backup");assert_eq!(fs::read_dir(&directory).unwrap().count(),1);atomic_export(&path,&snapshot(),&AtomicBool::new(false),|_,_,_|{}).unwrap();assert!(read_archive(File::open(&path).unwrap(),&AtomicBool::new(false),|_,_,_|{}).is_ok());fs::remove_file(path).unwrap();fs::remove_dir(directory).unwrap();}
 #[test]fn destination_write_failure_is_reported(){struct Broken;impl Write for Broken{fn write(&mut self,_:&[u8])->std::io::Result<usize>{Err(std::io::Error::other("simulated disk failure"))}fn flush(&mut self)->std::io::Result<()>{Ok(())}}assert!(write_archive(&mut Broken,&snapshot(),&AtomicBool::new(false),|_,_,_|{}).is_err());}
 #[test]fn dangling_source_is_rejected_after_integrity_checks(){let mut value=serde_json::to_value(snapshot()).unwrap();value["tasks"][0]["sourceRecordId"]=json!(uuid::Uuid::new_v4().to_string());let invalid:FullSnapshot=serde_json::from_value(value).unwrap();let mut bytes=Vec::new();write_archive(&mut bytes,&invalid,&AtomicBool::new(false),|_,_,_|{}).unwrap();assert!(read_archive(bytes.as_slice(),&AtomicBool::new(false),|_,_,_|{}).is_err());}
}
