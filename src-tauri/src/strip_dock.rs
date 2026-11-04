use std::{path::PathBuf,sync::Mutex,time::{Duration,Instant}};
use serde::{Deserialize,Serialize};
use tauri::{AppHandle,Emitter,Manager,WebviewWindow,LogicalSize,PhysicalPosition};

#[derive(Clone,Default,Serialize,Deserialize)]
#[serde(default,rename_all="camelCase")]
struct Preferences{side:Option<String>,folded:bool,size:Option<(f64,f64)>}
struct Runtime{preferences:Preferences,file:PathBuf,moved:Option<Instant>}
pub struct DockState(Mutex<Runtime>);
#[derive(Clone,Serialize)]
pub struct DockInfo{side:Option<String>,folded:bool}
fn info(value:&Preferences)->DockInfo{DockInfo{side:value.side.clone(),folded:value.folded}}
fn save(state:&Runtime)->Result<(),String>{let temp=state.file.with_extension("tmp");std::fs::write(&temp,serde_json::to_vec(&state.preferences).map_err(|e|e.to_string())?).and_then(|_|std::fs::rename(temp,&state.file)).map_err(|e|e.to_string())}
pub fn initialize(app:&AppHandle,directory:PathBuf){
 let file=directory.join("strip-dock.json");let mut preferences:Preferences=std::fs::read(&file).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
 if !matches!(preferences.side.as_deref(),Some("left"|"right")){preferences.side=None;preferences.folded=false;}
 if preferences.size.is_some_and(|(w,h)|!w.is_finite()||!h.is_finite()||!(280.0..=2000.0).contains(&w)||!(150.0..=2000.0).contains(&h)){preferences.size=None;}
 app.manage(DockState(Mutex::new(Runtime{preferences,file,moved:None})));
}
fn emit(app:&AppHandle,p:&Preferences){let _=app.emit_to("task-strip","task-strip-dock",info(p));}
fn area(window:&WebviewWindow)->Result<(i32,i32,u32,u32,f64),String>{let m=window.current_monitor().map_err(|e|e.to_string())?.or(window.primary_monitor().map_err(|e|e.to_string())?).ok_or("无法确定便签显示区域")?;let r=m.work_area();Ok((r.position.x,r.position.y,r.size.width,r.size.height,m.scale_factor()))}
pub fn edge(x:i32,width:u32,area_x:i32,area_width:u32,threshold:f64)->Option<&'static str>{
 let left=(i64::from(x)-i64::from(area_x)).abs() as f64;let right=(i64::from(x)+i64::from(width)-i64::from(area_x)-i64::from(area_width)).abs() as f64;
 if left.min(right)>threshold{None}else if left<=right{Some("left")}else{Some("right")}
}
fn detached_x(x:i32,current_outer:u32,current_inner:u32,expanded_inner:f64)->i32{
 // Frameless resizable Windows windows still have an invisible sizing border.
 // Preserve the outer right edge, including that border, when expanding inward.
 let frame=current_outer.saturating_sub(current_inner);
 (i64::from(x)+i64::from(current_outer)-expanded_inner.round() as i64-i64::from(frame)).clamp(i64::from(i32::MIN),i64::from(i32::MAX)) as i32
}
fn apply(window:&WebviewWindow,p:&Preferences)->Result<(),String>{
 let (x,y,width,height,scale)=area(window)?;let old=window.outer_position().map_err(|e|e.to_string())?;
 let (w,h)=if p.folded{(28.0,76.0)}else{p.size.unwrap_or((320.0,288.0))};
 let w=w.min(f64::from(width)/scale);let h=h.min(f64::from(height)/scale);
 window.set_min_size(Some(LogicalSize::new(if p.folded{28.0}else{280.0},if p.folded{76.0}else{150.0}))).map_err(|e|e.to_string())?;
 window.set_size(LogicalSize::new(w,h)).map_err(|e|e.to_string())?;
 let size=window.outer_size().map_err(|e|e.to_string())?;
 let target_x=match p.side.as_deref(){Some("left")=>x,Some("right")=>x+width.saturating_sub(size.width) as i32,_=>old.x.clamp(x,x+width.saturating_sub(size.width) as i32)};
 let target_y=old.y.clamp(y,y+height.saturating_sub(size.height) as i32);
 if old.x!=target_x||old.y!=target_y{window.set_position(PhysicalPosition::new(target_x,target_y)).map_err(|e|e.to_string())?;}
 Ok(())
}
pub fn attach(app:&AppHandle,window:&WebviewWindow)->Result<(),String>{
 // Native getters can dispatch resize callbacks. Never hold DockState while
 // calling them, or the UI thread and the creation worker can wait on each other.
 let scale=window.scale_factor().map_err(|e|e.to_string())?;let size=window.inner_size().map_err(|e|e.to_string())?.to_logical::<f64>(scale);
 let state=app.state::<DockState>();let mut state=state.0.lock().map_err(|_|"便签状态暂不可用")?;
 if state.preferences.size.is_none(){state.preferences.size=Some((size.width,size.height));}
 let preferences=state.preferences.clone();drop(state);apply(window,&preferences)?;emit(app,&preferences);Ok(())
}
pub fn moved(app:&AppHandle){if let Some(state)=app.try_state::<DockState>(){if let Ok(mut state)=state.0.lock(){state.moved=Some(Instant::now());}}}
pub fn resized(app:&AppHandle,window:&WebviewWindow){
 let(Ok(size),Ok(scale))=(window.inner_size(),window.scale_factor())else{return;};let size=size.to_logical::<f64>(scale);
 if size.width<280.0||size.height<150.0{return;}
 if let Some(state)=app.try_state::<DockState>(){if let Ok(mut state)=state.0.lock(){if !state.preferences.folded{state.preferences.size=Some((size.width,size.height));state.moved=Some(Instant::now());}}}
}
#[cfg(windows)]
pub fn pointer_down()->bool{unsafe{windows_sys::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState(1) as u16&0x8000!=0}}
#[cfg(not(windows))]
pub fn pointer_down()->bool{false}
pub fn tick(app:&AppHandle){
 let Some(window)=app.get_webview_window("task-strip") else{return;};let state=app.state::<DockState>();
 {let Ok(mut state)=state.0.lock() else{return;};if state.moved.is_none_or(|last|last.elapsed()<Duration::from_millis(250))||pointer_down(){return;}state.moved=None;}
 let(Ok(position),Ok(size),Ok((x,_,width,_,scale)))=(window.outer_position(),window.outer_size(),area(&window))else{return;};
 let inner_width=window.inner_size().map(|size|size.width).unwrap_or(size.width);
 let Ok(mut state)=state.0.lock() else{return;};
 let side=edge(position.x,size.width,x,width,12.0*scale).map(str::to_string);let changed=state.preferences.side!=side;
 let detached_right=state.preferences.folded&&state.preferences.side.as_deref()==Some("right")&&side.is_none();
 state.preferences.side=side;if state.preferences.side.is_none(){state.preferences.folded=false;}
 let preferences=state.preferences.clone();let _=save(&state);drop(state);
 if changed{
  if detached_right{let full=preferences.size.unwrap_or((320.0,288.0)).0*scale;let _=window.set_position(PhysicalPosition::new(detached_x(position.x,size.width,inner_width,full),position.y));}
  if let Err(error)=apply(&window,&preferences){let _=app.emit("task-strip-error",error);}
 }
 emit(app,&preferences);
}
pub fn reset(app:&AppHandle)->Result<(),String>{
 let state=app.state::<DockState>();let mut state=state.0.lock().map_err(|_|"便签状态暂不可用")?;state.preferences.side=None;state.preferences.folded=false;let p=state.preferences.clone();save(&state)?;drop(state);
 if let Some(window)=app.get_webview_window("task-strip"){apply(&window,&p)?;}emit(app,&p);Ok(())
}
#[tauri::command]
pub fn task_strip_dock(app:AppHandle)->Result<DockInfo,String>{Ok(info(&app.state::<DockState>().0.lock().map_err(|_|"便签状态暂不可用")?.preferences))}
#[tauri::command]
pub fn fold_task_strip(app:AppHandle,window:WebviewWindow,folded:bool)->Result<DockInfo,String>{
 if window.label()!="task-strip"{return Err("请从便签操作。".into());}
 let state=app.state::<DockState>();let mut state=state.0.lock().map_err(|_|"便签状态暂不可用")?;let previous=state.preferences.clone();
 state.preferences.folded=folded&&state.preferences.side.is_some();let next=state.preferences.clone();drop(state);
 if let Err(error)=apply(&window,&next){if let Ok(mut state)=app.state::<DockState>().0.lock(){state.preferences=previous;}return Err(error);}
 {let state=app.state::<DockState>();save(&*state.0.lock().map_err(|_|"便签状态暂不可用")?)?;}emit(&app,&next);Ok(info(&next))
}
#[cfg(test)]mod tests{use super::*;#[test]fn recognizes_both_edges_on_negative_monitors_and_ignores_the_center(){assert_eq!(edge(-1915,320,-1920,1920,12.0),Some("left"));assert_eq!(edge(-325,320,-1920,1920,12.0),Some("right"));assert_eq!(edge(1875,28,0,1920,18.0),Some("right"));assert_eq!(edge(300,320,0,1920,12.0),None);}
#[test]fn detaching_preserves_outer_right_edge_at_different_dpi(){for(scale,frame)in[(1.0,12),(1.25,14),(1.5,16),(2.0,20)]{let inner=(28.0*scale) as u32;let outer=inner+frame;let expanded=(320.0*scale) as u32;let x=1920-outer as i32-24;let next=detached_x(x,outer,inner,expanded as f64);assert_eq!(next+expanded as i32+frame as i32,1920-24);}}
}
