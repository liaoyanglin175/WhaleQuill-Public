mod notebook;
mod ai;
mod planner;
mod task_strip;
mod strip_dock;
mod desktop_tray;
mod reminders;
mod creation;
mod trash;
mod diagnostics;
mod backup;

use std::sync::Mutex;
use tauri::{Manager, Emitter};
use std::hash::{Hash, Hasher};

pub struct Database(Mutex<rusqlite::Connection>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context=tauri::generate_context!();
    // Isolated smoke runs must never signal or open the user's normal workspace.
    if cfg!(debug_assertions) {
        if let Some(directory)=std::env::var_os("DAFEIYU_TEST_DATA_DIR") {
            let mut hash=std::collections::hash_map::DefaultHasher::new();directory.hash(&mut hash);
            context.config_mut().identifier=format!("io.dafeiyu.notebook.test.{:016x}",hash.finish());
        }
    }
    let result=tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app,_,_|{
            let isolated=cfg!(debug_assertions)&&std::env::var_os("DAFEIYU_TEST_DATA_DIR").is_some();
            if !isolated { if let Some(window)=app.get_webview_window("main") {let _=window.unminimize();let _=window.show();let _=window.set_focus();} }
            let _=app.emit("dafeiyu-instance-activated",());
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            let test_directory = if cfg!(debug_assertions) { std::env::var_os("DAFEIYU_TEST_DATA_DIR") } else { None };
            let directory = test_directory.as_ref().map(std::path::PathBuf::from).unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&directory)?;
            diagnostics::initialize(&directory);
            let mut connection = rusqlite::Connection::open(directory.join("notebook.db"))?;
            connection.busy_timeout(std::time::Duration::from_secs(5))?;
            connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
            let version: u32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
            if version > 8 { return Err("数据库版本较新，请使用更新的应用版本打开".into()); }
            if version < 6 {
                let transaction = connection.transaction()?;
                if version == 0 { transaction.execute_batch(include_str!("../migrations/001_initial.sql"))?; }
                if version < 2 { transaction.execute_batch(include_str!("../migrations/002_trash.sql"))?; }
                if version < 3 { transaction.execute_batch(include_str!("../migrations/003_highlights.sql"))?; }
                if version < 4 { transaction.execute_batch(include_str!("../migrations/004_rich_document.sql"))?; }
                if version < 5 { transaction.execute_batch(include_str!("../migrations/005_inline_tags.sql"))?; }
                transaction.execute_batch(include_str!("../migrations/006_planner.sql"))?;
                transaction.commit()?;
            }
            if version<7{connection.execute_batch(include_str!("../migrations/007_reminders.sql"))?;}
            if version<8{let tx=connection.transaction()?;tx.execute_batch(include_str!("../migrations/008_trash_retention.sql"))?;tx.commit()?;}
            app.manage(Database(Mutex::new(connection)));
            backup::initialize(app.handle());
            app.manage(ai::AiState::new(&app.config().identifier,test_directory.is_some())?);
            task_strip::initialize(app.handle(), directory);
            if let Err(error)=desktop_tray::initialize(app.handle()){let _=app.emit("task-strip-error",error);}
            if test_directory.is_some() {
                if let Some(window) = app.get_webview_window("main") { window.hide()?; }
            }
            Ok(())
        })
        .on_window_event(|window,event| {
            if window.label()=="main" && matches!(event,tauri::WindowEvent::Resized(_)|tauri::WindowEvent::Focused(_)) {
                task_strip::window_changed(window.app_handle());
            }
            if window.label() == "main" && matches!(event,tauri::WindowEvent::Destroyed) {
                task_strip::shutdown(window.app_handle());
                desktop_tray::shutdown();
                window.app_handle().exit(0);
            }
        })
        .invoke_handler(tauri::generate_handler![
            backup::export_complete_backup,
            backup::preview_complete_backup,
            backup::commit_complete_backup,
            backup::cancel_complete_backup,
            strip_dock::task_strip_dock,
            strip_dock::fold_task_strip,
            task_strip::task_strip_preferences,
            task_strip::update_task_strip,
            task_strip::hide_task_strip,
            task_strip::move_task_strip,
            task_strip::restore_notebook,
            task_strip::close_to_background,
            task_strip::exit_background,
            task_strip::request_background_exit,
            reminders::reminder_notices,
            trash::trash_retention_info,
            trash::preview_trash_retention,
            trash::set_trash_retention,
            trash::purged_record_ids,
            creation::commit_creation,
            creation::undo_creation,
            notebook::load_strip_tasks,
            notebook::maintain_tasks,
            notebook::set_task_status,
            ai::ai_status,
            ai::ai_save_key,
            ai::ai_delete_key,
            ai::ai_cancel,
            ai::ai_ask,
            notebook::load_workspace,
            notebook::load_trash,
            notebook::restore_item,
            notebook::write_recovery,
            notebook::load_recovery,
            notebook::save_record,
            notebook::delete_record,
            notebook::save_task,
            notebook::delete_task,
            notebook::merge_workspace,
            notebook::export_snapshot,
            notebook::merge_snapshot,
        ])
        .run(context);
    if let Err(error)=result {
        diagnostics::write(&format!("startup failed: {error}"));
        eprintln!("无法启动鲸笺: {error}");
        rfd::MessageDialog::new().set_title("鲸笺 / WhaleQuill")
            .set_description("暂时无法打开记事本。请关闭已有窗口后重试；若仍无法启动，请检查 Microsoft Edge WebView2。已保存的记录不会被清除。\n\nCould not start. Close any existing window and try again. If this persists, check Microsoft Edge WebView2. Saved notes have not been removed.")
            .set_level(rfd::MessageLevel::Error).show();
    }
}
