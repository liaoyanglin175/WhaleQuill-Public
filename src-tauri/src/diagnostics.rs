use std::{path::{Path,PathBuf},sync::OnceLock,io::Write};
static LOG:OnceLock<PathBuf>=OnceLock::new();
pub fn initialize(directory:&Path){
 let _=LOG.set(directory.join("whale-quill.log"));write(&format!("started {}",env!("CARGO_PKG_VERSION")));
 let previous=std::panic::take_hook();std::panic::set_hook(Box::new(move|info|{if let Some(location)=info.location(){write(&format!("unexpected failure at {}:{}",location.file(),location.line()));}else{write("unexpected failure");}previous(info);}));
}
pub fn write(message:&str){
 if let Some(path)=LOG.get(){
  if std::fs::metadata(path).is_ok_and(|m|m.len()>256*1024){let _=std::fs::write(path,[]);}
  if let Ok(mut file)=std::fs::OpenOptions::new().create(true).append(true).open(path){let _=writeln!(file,"{} {}",chrono::Utc::now().to_rfc3339(),message);}
 }
}
