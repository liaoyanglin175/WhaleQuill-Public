//! Native Windows tray + silent notification. No scheduled OS jobs or extra process.
#[cfg(windows)]
mod native {
 use std::{sync::{OnceLock,atomic::{AtomicUsize,AtomicBool,Ordering}},ptr::null_mut};
 use tauri::{AppHandle,Emitter};
 use windows_sys::Win32::{Foundation::*,System::LibraryLoader::GetModuleHandleW,UI::{WindowsAndMessaging::*,Shell::*}};
 static APP:OnceLock<AppHandle>=OnceLock::new();
 static WINDOW:AtomicUsize=AtomicUsize::new(0);
 static ICON:AtomicUsize=AtomicUsize::new(0);
 static REGISTERED:AtomicBool=AtomicBool::new(false);
 const CALLBACK:u32=WM_APP+21;
 fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
 fn text<const N:usize>(destination:&mut [u16;N],s:&str){let mut end=0;for character in s.chars(){let mut units=[0;2];let encoded=character.encode_utf16(&mut units);if end+encoded.len()>=N{break;}destination[end..end+encoded.len()].copy_from_slice(encoded);end+=encoded.len();}}
 fn data(hwnd:HWND)->NOTIFYICONDATAW{let mut value:NOTIFYICONDATAW=unsafe{std::mem::zeroed()};value.cbSize=std::mem::size_of::<NOTIFYICONDATAW>() as u32;value.hWnd=hwnd;value.uID=1;value}
 unsafe fn register(hwnd:HWND)->bool{
  let mut value=data(hwnd);value.uFlags=NIF_ICON|NIF_MESSAGE|NIF_TIP;value.uCallbackMessage=CALLBACK;value.hIcon=ICON.load(Ordering::SeqCst) as HICON;text(&mut value.szTip,"鲸笺 · WhaleQuill");
  let result=Shell_NotifyIconW(NIM_ADD,&value)!=0;
  if result{value.Anonymous.uVersion=NOTIFYICON_VERSION_4;Shell_NotifyIconW(NIM_SETVERSION,&value);}
  REGISTERED.store(result,Ordering::SeqCst);result
 }
 fn action(command:u32){if let Some(app)=APP.get(){let handle=app.clone();let _=app.run_on_main_thread(move||match command{
  1=>{let _=crate::task_strip::restore_notebook(handle);},
  2=>{crate::task_strip::show_from_tray(&handle);},
  3=>{let _=crate::task_strip::hide_task_strip(handle);},
  4=>{let _=handle.emit_to("main","whale-quill-exit-requested",());},
  _=>{}
 });}}
 unsafe extern "system" fn procedure(hwnd:HWND,message:u32,wparam:WPARAM,lparam:LPARAM)->LRESULT{
  if message==RegisterWindowMessageW(wide("TaskbarCreated").as_ptr()){register(hwnd);return 0;}
  match message{
   CALLBACK=>{
    match (lparam as u32)&0xffff{
     WM_LBUTTONDBLCLK|NIN_SELECT|1025=>action(1),
     NIN_BALLOONUSERCLICK=>{if let Some(app)=APP.get(){let _=app.emit("native-notification-clicked",());}action(2)},
     NIN_BALLOONSHOW=>{if let Some(app)=APP.get(){let _=app.emit("native-notification-shown",());}},
     WM_RBUTTONUP|WM_CONTEXTMENU=>{
      let menu=CreatePopupMenu();let en=APP.get().is_some_and(|app|crate::task_strip::language(app)=="en");
      for (id,zh,en_text) in [(1,"打开鲸笺","Open WhaleQuill"),(2,"显示便签","Show task note"),(3,"收起便签","Hide task note"),(4,"退出便签后台","Exit background and reminders")]{AppendMenuW(menu,MF_STRING,id,wide(if en{en_text}else{zh}).as_ptr());}
      let mut point=POINT{x:0,y:0};GetCursorPos(&mut point);SetForegroundWindow(hwnd);
      let command=TrackPopupMenu(menu,TPM_RETURNCMD|TPM_RIGHTBUTTON,point.x,point.y,0,hwnd,null_mut());DestroyMenu(menu);PostMessageW(hwnd,WM_NULL,0,0);action(command as u32);
     },_=>{}
    }0
   },
   WM_CLOSE=>{let value=data(hwnd);Shell_NotifyIconW(NIM_DELETE,&value);DestroyWindow(hwnd);0},
   WM_DESTROY=>{REGISTERED.store(false,Ordering::SeqCst);WINDOW.store(0,Ordering::SeqCst);PostQuitMessage(0);0},
   _=>DefWindowProcW(hwnd,message,wparam,lparam)
  }
 }
 pub fn initialize(app:&AppHandle)->Result<(),String>{
  APP.set(app.clone()).map_err(|_|"后台已启动")?;let (ready,receiver)=std::sync::mpsc::sync_channel(1);let class=wide(&format!("WhaleQuillTray-{}",app.config().identifier));
  std::thread::spawn(move||unsafe{
   let instance=GetModuleHandleW(std::ptr::null());let path=std::env::current_exe().ok().map(|p|wide(&p.to_string_lossy()));let mut icon=null_mut();
   if let Some(path)=path{ExtractIconExW(path.as_ptr(),0,&mut icon,null_mut(),1);}if icon.is_null(){icon=LoadIconW(null_mut(),IDI_APPLICATION);}ICON.store(icon as usize,Ordering::SeqCst);
   let mut window_class:WNDCLASSW=std::mem::zeroed();window_class.lpfnWndProc=Some(procedure);window_class.hInstance=instance;window_class.lpszClassName=class.as_ptr();RegisterClassW(&window_class);
   let hwnd=CreateWindowExW(0,class.as_ptr(),wide("WhaleQuill background").as_ptr(),0,0,0,0,0,null_mut(),null_mut(),instance,null_mut());
   if hwnd.is_null(){let _=ready.send(false);return;}WINDOW.store(hwnd as usize,Ordering::SeqCst);let registered=register(hwnd);let _=ready.send(registered);
   let mut message:MSG=std::mem::zeroed();while GetMessageW(&mut message,null_mut(),0,0)>0{TranslateMessage(&message);DispatchMessageW(&message);}if !icon.is_null(){DestroyIcon(icon);}
  });
  if receiver.recv_timeout(std::time::Duration::from_secs(4)).unwrap_or(false){Ok(())}else{Err("系统托盘未能启动，主窗口将保持打开。".into())}
 }
 pub fn available()->bool{WINDOW.load(Ordering::SeqCst)!=0&&REGISTERED.load(Ordering::SeqCst)}
 pub fn notify(title:&str,body:&str)->Result<(),String>{
  let hwnd=WINDOW.load(Ordering::SeqCst) as HWND;if !available(){return Err("系统托盘不可用".into());}
  let mut value=data(hwnd);value.uFlags=NIF_INFO;value.dwInfoFlags=NIIF_INFO|NIIF_NOSOUND|NIIF_RESPECT_QUIET_TIME;text(&mut value.szInfoTitle,title);text(&mut value.szInfo,body);
  if unsafe{Shell_NotifyIconW(NIM_MODIFY,&value)}!=0{Ok(())}else{Err("系统通知未能发送，便签仍保留提醒。".into())}
 }
 pub fn shutdown(){let hwnd=WINDOW.load(Ordering::SeqCst) as HWND;if !hwnd.is_null(){unsafe{SendMessageW(hwnd,WM_CLOSE,0,0);}}}
}
#[cfg(windows)]pub use native::*;
#[cfg(not(windows))]pub fn initialize(_: &tauri::AppHandle)->Result<(),String>{Ok(())}
#[cfg(not(windows))]pub fn available()->bool{false}
#[cfg(not(windows))]pub fn notify(_: &str,_: &str)->Result<(),String>{Err("系统提醒仅在Windows中使用".into())}
#[cfg(not(windows))]pub fn shutdown(){}
