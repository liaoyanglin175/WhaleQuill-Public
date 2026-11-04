//! A small native window backed by the notebook's tasks, never a second task store.
use crate::Database;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

const LABEL: &str = "task-strip";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub enabled: bool,
    pub pinned: bool,
    pub language: String,
    pub position: Option<(i32, i32)>,
    pub cleanup_enabled:bool,
    pub reminders_enabled:bool,
}
impl Default for Preferences {
    fn default() -> Self { Self { enabled: true, pinned: false, language: "zh".into(), position: None,cleanup_enabled:true,reminders_enabled:true } }
}
struct Runtime {
    preferences: Preferences,
    file: PathBuf,
    minimized: bool,
    background:bool,
    requested:bool,
    dismissed: bool,
    shown_this_session: bool,
    creating:bool,
    moved_at: Option<Instant>,
}
impl Runtime {
    fn visible(&self, has_content:bool)->bool {
        self.preferences.enabled && !self.dismissed && (self.requested ||
            ((self.minimized||self.background) && (self.shown_this_session||has_content)))
    }
}
pub struct StripState(Mutex<Runtime>);

fn save(runtime: &Runtime) -> Result<(), String> {
    let bytes = serde_json::to_vec(&runtime.preferences).map_err(|e| e.to_string())?;
    let temporary = runtime.file.with_extension("tmp");
    std::fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, &runtime.file).map_err(|e| e.to_string())
}

pub fn initialize(app: &AppHandle, directory: PathBuf) {
    crate::strip_dock::initialize(app,directory.clone());
    let file = directory.join("task-strip.json");
    let mut preferences: Preferences = std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    if !["en", "zh"].contains(&preferences.language.as_str()) { preferences.language = "zh".into(); }
    app.manage(StripState(Mutex::new(Runtime { preferences, file, minimized: false, background:false,requested:false,dismissed: false, shown_this_session: false, creating:false, moved_at: None })));
    let _=crate::notebook::maintain_for_app(app);
    // Native polling survives WebView background throttling. It only changes visibility
    // on actual minimize transitions and never brings the main window to the foreground.
    let app = app.clone();
    std::thread::spawn(move || {
        let mut previous = false;
        let mut ticks = 0;
        let mut day=crate::planner::today();
        loop {
            std::thread::sleep(Duration::from_millis(350));
            let Some(main) = app.get_webview_window("main") else { break; };
            let minimized = main.is_minimized().unwrap_or(previous);
            if minimized != previous {
                previous = minimized;
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    transition(&handle,minimized);
                });
            }
            let dock_handle=app.clone();let _=app.run_on_main_thread(move||{if !creating(&dock_handle){crate::strip_dock::tick(&dock_handle);}});
            ticks += 1;
            if ticks % 6 == 0 {
                let current_day=crate::planner::today();
                if current_day!=day&&crate::notebook::maintain_for_app(&app).is_ok(){
                    day=current_day;
                    if let Ok(mut state)=app.state::<StripState>().0.lock(){state.shown_this_session=false;}
                    changed(&app);
                }
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    if creating(&handle){return;}
                    if let Some(strip) = handle.get_webview_window(LABEL) {
                        if strip.is_visible().unwrap_or(false)&&!crate::strip_dock::pointer_down() { let _ = place(&handle, &strip, false); }
                    }
                    if let Ok(mut state) = handle.state::<StripState>().0.lock() {
                        if state.moved_at.is_some_and(|time| time.elapsed() >= Duration::from_millis(600)) {
                            if save(&state).is_ok() { state.moved_at = None; }
                        }
                    }
                });
            }
            if ticks%30==0{crate::reminders::poll(&app);}
        }
    });
}

fn transition(app: &AppHandle, minimized: bool) {
    let Some(state)=app.try_state::<StripState>() else { return; };
    let changed=if let Ok(mut state)=state.0.lock() {
        if state.minimized==minimized||(!minimized&&state.creating) { false } else {
            state.minimized=minimized;state.dismissed=false;state.shown_this_session=false;true
        }
    } else { false };
    if changed { reconcile(app); }
}
fn creating(app:&AppHandle)->bool{app.try_state::<StripState>().and_then(|state|state.0.lock().ok().map(|s|s.creating)).unwrap_or(false)}
pub fn window_changed(app: &AppHandle) {
    if creating(app){return;}
    if let Some(main)=app.get_webview_window("main") {
        if let Ok(minimized)=main.is_minimized() { transition(app,minimized); }
    }
}

fn content_count(app: &AppHandle) -> usize {
    let database = app.state::<Database>();
    let Ok(connection) = database.0.lock() else { return 0; };
    count_contents(&connection,&crate::planner::today())
}
fn count_contents(connection:&rusqlite::Connection,day:&str)->usize {
    connection.query_row("SELECT COUNT(*) FROM tasks WHERE deleted_at IS NULL AND ((COALESCE(json_extract(planner_json,'$.kind'),'task')='task' AND (status='todo' OR (status='done' AND date(json_extract(planner_json,'$.completedAt'),'localtime')=?1))) OR (json_extract(planner_json,'$.kind')='event' AND json_extract(planner_json,'$.eventDate')<=?1 AND COALESCE(json_extract(planner_json,'$.endDate'),json_extract(planner_json,'$.eventDate'))>=?1))", [day], |r| r.get(0)).unwrap_or(0)
}

pub fn reconcile(app: &AppHandle) {
    let handle=app.clone();
    tauri::async_runtime::spawn_blocking(move||reconcile_inner(&handle));
}
fn reconcile_inner(app:&AppHandle){
    // WebView2 construction cannot run inside a synchronous IPC command or
    // window event. Serialize worker requests so they cannot create duplicates.
    static GATE:Mutex<()>=Mutex::new(());
    let Ok(_guard)=GATE.lock() else{return;};
    let (visible, pinned) = {
        let state = app.state::<StripState>();
        let Ok(state) = state.0.lock() else { return; };
        (state.visible(content_count(app)>0), state.preferences.pinned)
    };
    if !visible {
        if let Some(strip) = app.get_webview_window(LABEL) { let _ = strip.destroy(); }
        return;
    }
    let strip = if let Some(_strip) = app.get_webview_window(LABEL) { return; } else {
        let preferences=match app.state::<StripState>().0.lock(){Ok(state)=>state.preferences.clone(),Err(_)=>return};
        let height=(104.+44.*content_count(app).min(6) as f64).clamp(174.,390.);
        let mut builder=WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("index.html?view=task-strip".into()))
            .title(if preferences.language=="en" {"WhaleQuill · Tasks"} else {"鲸笺 · 待办"})
            .inner_size(320., height).min_inner_size(280.,150.).resizable(true).decorations(false)
            .visible(true).focused(false).skip_taskbar(true).always_on_top(pinned);
        if let Some(main)=app.get_webview_window("main") {
            if let Ok(Some(monitor))=main.current_monitor() {
                let area=monitor.work_area();let scale=monitor.scale_factor();
                let size=((320.*scale) as u32,(height*scale) as u32);
                let desired=preferences.position.unwrap_or((area.position.x+area.size.width.saturating_sub(size.0+24) as i32,area.position.y+area.size.height.saturating_sub(size.1+24) as i32));
                let next=clamped(desired,size,(area.position.x,area.position.y,area.size.width,area.size.height));
                builder=builder.position(f64::from(next.0)/scale,f64::from(next.1)/scale);
            }
        }
        if let Ok(mut state)=app.state::<StripState>().0.lock(){state.creating=true;}
        crate::diagnostics::write("note: creating native window");
        match builder.build() {
            Ok(strip) => {
                crate::diagnostics::write("note: native window created");
                let handle = app.clone();
                strip.on_window_event(move |event| match event {
                    tauri::WindowEvent::CloseRequested { api, .. } => { api.prevent_close(); let _ = dismiss(&handle); }
                    tauri::WindowEvent::Resized(_) => {if let Some(window)=handle.get_webview_window(LABEL){crate::strip_dock::resized(&handle,&window);}},
                    tauri::WindowEvent::Moved(position) => {
                        crate::strip_dock::moved(&handle);
                        if let Ok(mut state) = handle.state::<StripState>().0.lock() {
                            state.preferences.position = Some((position.x, position.y));
                            state.moved_at = Some(Instant::now());
                        }
                    }
                    _ => {}
                });
                strip
            }
            Err(error) => { if let Ok(mut state)=app.state::<StripState>().0.lock(){state.creating=false;}let _ = app.emit("task-strip-error", error.to_string()); return; }
        }
    };
    crate::diagnostics::write("note: placing native window");
    if let Err(error) = place(app, &strip, true) {
        if let Ok(mut state)=app.state::<StripState>().0.lock(){state.creating=false;}
        let _ = app.emit("task-strip-error", error);
        return;
    }
    crate::diagnostics::write("note: restoring edge placement");
    if let Err(error)=crate::strip_dock::attach(app,&strip){let _=app.emit("task-strip-error",error);}
    crate::diagnostics::write("note: ready");
    let minimized=if let Ok(mut state) = app.state::<StripState>().0.lock() { state.shown_this_session = true;state.creating=false;state.minimized&&!state.background }else{false};
    if minimized {if let Some(main)=app.get_webview_window("main"){let _=main.minimize();}}
    let _ = app.emit_to(LABEL, "task-strip-opened", ());
}

fn clamped(position: (i32, i32), size: (u32, u32), area: (i32, i32, u32, u32)) -> (i32, i32) {
    let (x, y, width, height) = area;
    (position.0.clamp(x, x.saturating_add(width.saturating_sub(size.0) as i32)),
     position.1.clamp(y, y.saturating_add(height.saturating_sub(size.1) as i32)))
}

fn place(app: &AppHandle, strip: &WebviewWindow, use_saved: bool) -> Result<(), String> {
    let monitors = strip.available_monitors().map_err(|e| e.to_string())?;
    let size = strip.outer_size().map_err(|e| e.to_string())?;
    let saved = app.state::<StripState>().0.lock().map_err(|_| "便签设置暂不可用")?.preferences.position;
    let position = if use_saved { saved } else { strip.outer_position().ok().map(|p| (p.x, p.y)) };
    let default_monitor = app.get_webview_window("main").and_then(|w| w.current_monitor().ok().flatten()).or_else(|| monitors.first().cloned());
    let monitor = position.and_then(|(x,y)| monitors.iter().find(|m| {
        let a = m.work_area(); x >= a.position.x && y >= a.position.y && i64::from(x) < i64::from(a.position.x)+i64::from(a.size.width) && i64::from(y) < i64::from(a.position.y)+i64::from(a.size.height)
    }).cloned()).or(default_monitor).ok_or("无法确定便签显示区域")?;
    let area = monitor.work_area();
    let desired = position.unwrap_or((area.position.x + area.size.width.saturating_sub(size.width + 24) as i32, area.position.y + area.size.height.saturating_sub(size.height + 24) as i32));
    let next = clamped(desired, (size.width,size.height), (area.position.x,area.position.y,area.size.width,area.size.height));
    if strip.outer_position().ok().map(|p| (p.x,p.y)) != Some(next) { strip.set_position(PhysicalPosition::new(next.0,next.1)).map_err(|e| e.to_string())?; }
    Ok(())
}

pub fn changed(app: &AppHandle) {
    let _ = app.emit("tasks-changed", ());
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || reconcile(&handle));
}
fn dismiss(app: &AppHandle) -> Result<(), String> {
    app.state::<StripState>().0.lock().map_err(|_| "便签设置暂不可用")?.dismissed = true;
    if let Some(strip) = app.get_webview_window(LABEL) { strip.destroy().map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn task_strip_preferences(app: AppHandle) -> Result<Preferences, String> {
    Ok(app.state::<StripState>().0.lock().map_err(|_| "便签设置暂不可用")?.preferences.clone())
}
#[tauri::command]
pub fn update_task_strip(app: AppHandle, enabled: Option<bool>, pinned: Option<bool>, language: Option<String>, reset: Option<bool>,cleanup_enabled:Option<bool>,reminders_enabled:Option<bool>) -> Result<Preferences, String> {
    let state = app.state::<StripState>();
    let mut state = state.0.lock().map_err(|_| "便签设置暂不可用")?;
    let old = state.preferences.clone();
    if let Some(value) = language { if !["zh","en"].contains(&value.as_str()) { return Err("语言不正确".into()); } state.preferences.language = value; }
    if let Some(value) = enabled { state.preferences.enabled = value; }
    if let Some(value) = pinned { state.preferences.pinned = value; }
    if let Some(value) = cleanup_enabled { state.preferences.cleanup_enabled=value; }
    if let Some(value)=reminders_enabled{state.preferences.reminders_enabled=value;}
    if reset == Some(true) { state.preferences.position = None; }
    if let Err(error) = save(&state) { state.preferences = old; return Err(error); }
    let next = state.preferences.clone();
    drop(state);
    if cleanup_enabled==Some(true){crate::notebook::maintain_for_app(&app)?;}
    if let Some(strip) = app.get_webview_window(LABEL) {
        strip.set_always_on_top(next.pinned).map_err(|e| e.to_string())?;
        if reset == Some(true) { crate::strip_dock::reset(&app)?;if let Ok(mut state)=app.state::<StripState>().0.lock(){state.preferences.position=None;}place(&app,&strip,true)?; }
        let _ = strip.set_title(if next.language == "en" { "WhaleQuill · Tasks" } else { "鲸笺 · 待办" });
    }
    let _ = app.emit("task-strip-settings", &next);
    let handle = app.clone(); let _ = app.run_on_main_thread(move || reconcile(&handle));
    Ok(next)
}
pub fn cleanup_enabled(app:&AppHandle)->bool{
    app.try_state::<StripState>().and_then(|state|state.0.lock().ok().map(|value|value.preferences.cleanup_enabled)).unwrap_or(true)
}
#[tauri::command]
pub fn hide_task_strip(app: AppHandle) -> Result<(), String> { dismiss(&app) }
#[tauri::command]
pub fn move_task_strip(app: AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    if dx.unsigned_abs() > 24 || dy.unsigned_abs() > 24 { return Err("移动距离不正确".into()); }
    let strip = app.get_webview_window(LABEL).ok_or("便签尚未打开")?;
    let position = strip.outer_position().map_err(|e| e.to_string())?;
    strip.set_position(PhysicalPosition::new(position.x.saturating_add(dx), position.y.saturating_add(dy))).map_err(|e| e.to_string())?;
    place(&app,&strip,false)
}
#[tauri::command]
pub fn restore_notebook(app: AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("主窗口已关闭")?;
    main.unminimize().and_then(|_| main.show()).and_then(|_| main.set_focus()).map_err(|e| e.to_string())?;
    if let Ok(mut state)=app.state::<StripState>().0.lock(){state.background=false;state.requested=false;state.dismissed=false;state.minimized=false;state.creating=false;}
    if let Some(strip) = app.get_webview_window(LABEL) { strip.destroy().map_err(|e| e.to_string())?; }
    Ok(())
}
pub fn language(app:&AppHandle)->String{app.try_state::<StripState>().and_then(|state|state.0.lock().ok().map(|s|s.preferences.language.clone())).unwrap_or_else(||"zh".into())}
pub fn reminders_enabled(app:&AppHandle)->bool{app.try_state::<StripState>().and_then(|state|state.0.lock().ok().map(|s|s.preferences.enabled&&s.preferences.reminders_enabled)).unwrap_or(false)}
pub fn show_from_tray(app:&AppHandle){if let Ok(mut state)=app.state::<StripState>().0.lock(){state.requested=true;state.dismissed=false;}reconcile(app);}
#[tauri::command]
pub async fn close_to_background(app:AppHandle)->Result<(),String>{
 if !crate::desktop_tray::available(){return Err("系统托盘未能启动，主窗口将保持打开。".into());}
 let main=app.get_webview_window("main").ok_or("主窗口不可用")?;
 if let Ok(mut state)=app.state::<StripState>().0.lock(){state.background=true;state.dismissed=false;state.shown_this_session=false;}
 // Create the secondary WebView before hiding its primary window: WebView2's
 // initialization can activate the primary host even with focused(false).
 let handle=app.clone();tauri::async_runtime::spawn_blocking(move||reconcile_inner(&handle)).await.map_err(|e|e.to_string())?;
 main.hide().map_err(|e|e.to_string())?;Ok(())
}
#[tauri::command]
pub fn exit_background(app:AppHandle,window:WebviewWindow)->Result<(),String>{
 if window.label()!="main"{return Err("请从主窗口处理未保存内容后退出。".into());}
 shutdown(&app);crate::desktop_tray::shutdown();app.exit(0);Ok(())
}
#[tauri::command]
pub fn request_background_exit(app:AppHandle)->Result<(),String>{app.emit_to("main","whale-quill-exit-requested",()).map_err(|e|e.to_string())}
pub fn shutdown(app: &AppHandle) {
    if let Some(state) = app.try_state::<StripState>() { if let Ok(state) = state.0.lock() { let _ = save(&state); } }
    if let Some(strip) = app.get_webview_window(LABEL) { let _ = strip.destroy(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completed_today_and_current_events_keep_the_note_available() {
        use chrono::TimeZone;
        let connection=rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE tasks(status TEXT, deleted_at TEXT, planner_json TEXT);").unwrap();
        let completed=chrono::Local.with_ymd_and_hms(2026,11,1,12,0,0).unwrap().to_rfc3339();
        for (status,json,deleted) in [
            ("todo",serde_json::json!({"kind":"task"}),None),
            ("done",serde_json::json!({"kind":"task","completedAt":completed}),None),
            ("done",serde_json::json!({"kind":"task","completedAt":completed}),Some("deleted")),
            ("todo",serde_json::json!({"kind":"event","eventDate":"2026-10-31","endDate":"2026-11-01"}),None),
            ("done",serde_json::json!({"kind":"task"}),None),
        ] {connection.execute("INSERT INTO tasks VALUES(?1,?2,?3)",rusqlite::params![status,deleted,json.to_string()]).unwrap();}
        assert_eq!(count_contents(&connection,"2026-11-01"),3);
        assert_eq!(count_contents(&connection,"2026-11-02"),1);
    }
    #[test]
    fn explicit_open_accepts_empty_content_and_automatic_open_respects_state() {
        let mut state=Runtime{preferences:Preferences::default(),file:PathBuf::new(),minimized:false,background:false,requested:false,dismissed:false,shown_this_session:false,creating:false,moved_at:None};
        assert!(!state.visible(true));
        state.minimized=true;assert!(state.visible(true));assert!(!state.visible(false));
        state.shown_this_session=true;assert!(state.visible(false));
        state.shown_this_session=false;state.minimized=false;state.background=true;assert!(state.visible(true));
        state.background=false;state.requested=true;assert!(state.visible(false));
        state.dismissed=true;assert!(!state.visible(true));
        state.dismissed=false;state.preferences.enabled=false;assert!(!state.visible(true));
    }
    #[test]
    fn reposition_disconnected_monitor_and_negative_coordinates() {
        assert_eq!(clamped((3000,1400),(304,288),(0,0,1920,1040)),(1616,752));
        assert_eq!(clamped((-1800,-100),(304,288),(-1920,0,1920,1040)),(-1800,0));
        assert_eq!(clamped((0,0),(800,600),(0,0,300,200)),(0,0));
    }
    #[test]
    fn new_preferences_are_unpinned_and_old_partial_preferences_remain_valid() {
        assert!(!Preferences::default().pinned);
        let value: Preferences = serde_json::from_str("{\"enabled\":false}").unwrap();
        assert!(!value.enabled); assert!(!value.pinned); assert_eq!(value.language,"zh");
    }
}
