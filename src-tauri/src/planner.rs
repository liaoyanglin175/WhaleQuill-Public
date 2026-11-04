use chrono::{DateTime,Duration,Local,NaiveDate,NaiveTime};
use serde::{Deserialize,Serialize};

#[derive(Clone,Debug,Serialize,Deserialize)]
#[serde(rename_all="camelCase",default)]
pub struct PlannerData {
    pub kind:String,
    pub event_date:Option<String>,
    pub start_time:Option<String>,
    pub end_date:Option<String>,
    pub end_time:Option<String>,
    pub location:String,
    pub notes:String,
    pub completed_at:Option<String>,
    pub cleanup_on:Option<String>,
    pub due_time:Option<String>,
}

#[cfg(test)]
mod tests{
    use super::*;
    #[test]
    fn completed_task_keeps_its_cleanup_date_across_title_edits_and_undo_clears_it(){
        let mut value=PlannerData::default();value.complete(true,None,Some("todo"),"2026-10-30").unwrap();
        assert_eq!(value.cleanup_on.as_deref(),Some("2026-10-31"));let previous=value.clone();
        value.complete(true,Some(&previous),Some("done"),"2026-11-01").unwrap();assert_eq!(value.cleanup_on,previous.cleanup_on);assert_eq!(value.completed_at,previous.completed_at);
        value.complete(false,Some(&previous),Some("done"),"2026-11-01").unwrap();assert!(value.completed_at.is_none());assert!(value.cleanup_on.is_none());
        assert_eq!(tomorrow("2026-12-31").unwrap(),"2027-01-01");
    }
    #[test]
    fn event_ranges_support_overnight_but_reject_backwards_end_and_completion(){
        let mut event=PlannerData::default();event.kind="event".into();event.event_date=Some("2026-10-30".into());event.start_time=Some("23:30".into());event.end_date=Some("2026-10-31".into());event.end_time=Some("01:00".into());
        assert!(event.validate("todo",None).is_ok());assert!(event.validate("done",None).is_err());assert!(!event.due("done","2026-11-02"));
        event.end_date=None;assert!(event.validate("todo",None).is_err());
    }
}
impl Default for PlannerData {
    fn default()->Self{Self{kind:"task".into(),event_date:None,start_time:None,end_date:None,end_time:None,location:String::new(),notes:String::new(),completed_at:None,cleanup_on:None,due_time:None}}
}
pub fn today()->String{Local::now().date_naive().to_string()}
pub fn tomorrow(day:&str)->Result<String,String>{Ok((NaiveDate::parse_from_str(day,"%Y-%m-%d").map_err(|_|"日期不正确")?+Duration::days(1)).to_string())}
impl PlannerData {
    pub fn validate(&self,status:&str,due:Option<&str>)->Result<(),String>{
        if !["task","event"].contains(&self.kind.as_str())||self.location.chars().count()>200||self.notes.chars().count()>4000{return Err("日程信息不正确".into());}
        for date in [&self.event_date,&self.end_date,&self.cleanup_on].into_iter().flatten(){NaiveDate::parse_from_str(date,"%Y-%m-%d").map_err(|_|"日期不正确")?;}
        for time in [&self.start_time,&self.end_time,&self.due_time].into_iter().flatten(){if time.len()!=5{return Err("时间不正确".into());}NaiveTime::parse_from_str(time,"%H:%M").map_err(|_|"时间不正确")?;}
        if let Some(time)=&self.completed_at{DateTime::parse_from_rfc3339(time).map_err(|_|"完成时间不正确")?;}
        if self.kind=="event"{
            let start=self.event_date.as_deref().ok_or("请选择行程日期")?;
            if status!="todo"||self.completed_at.is_some()||self.cleanup_on.is_some()||due.is_some()||self.due_time.is_some(){return Err("行程不能标记为待办完成".into());}
            if self.end_time.is_some()&&self.start_time.is_none(){return Err("请先设置开始时间".into());}
            let start=format!("{}T{}",start,self.start_time.as_deref().unwrap_or("00:00"));
            let end=format!("{}T{}",self.end_date.as_deref().or(self.event_date.as_deref()).unwrap(),self.end_time.as_deref().or(self.start_time.as_deref()).unwrap_or("23:59"));
            if end<start{return Err("结束时间不能早于开始时间".into());}
        }else{
            if self.due_time.is_some()&&due.is_none(){return Err("请先选择截止日期".into());}
            if self.event_date.is_some()||self.start_time.is_some()||self.end_date.is_some()||self.end_time.is_some(){return Err("待办与行程时间不一致".into());}
            if status=="todo"&&(self.completed_at.is_some()||self.cleanup_on.is_some()){return Err("未完成待办不能带有清理计划".into());}
        }
        Ok(())
    }
    pub fn complete(&mut self,done:bool,previous:Option<&PlannerData>,previous_status:Option<&str>,day:&str)->Result<(),String>{
        if !done||self.kind=="event"{self.completed_at=None;self.cleanup_on=None;}
        else if previous_status==Some("done"){
            if let Some(previous)=previous{self.completed_at=previous.completed_at.clone();self.cleanup_on=previous.cleanup_on.clone().or(Some(tomorrow(day)?));}
        }else{self.completed_at=Some(chrono::Utc::now().to_rfc3339());self.cleanup_on=Some(tomorrow(day)?);}
        Ok(())
    }
    pub fn import_grace(&mut self,status:&str,day:&str)->Result<(),String>{
        if self.kind=="task"&&status=="done"&&self.cleanup_on.is_none(){self.cleanup_on=Some(tomorrow(day)?);}
        Ok(())
    }
    pub fn due(&self,status:&str,day:&str)->bool{self.kind=="task"&&status=="done"&&self.cleanup_on.as_deref().is_some_and(|date|date<=day)}
}
