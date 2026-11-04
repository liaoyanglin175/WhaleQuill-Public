use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{HashMap, HashSet}, sync::Mutex, time::Duration};
use tokio::sync::oneshot;

#[derive(Default)]
struct Requests { active: HashMap<String, oneshot::Sender<()>>, cancelled: HashSet<String> }
pub struct AiState { target: String, client: reqwest::Client, endpoint: String, requests: Mutex<Requests> }
impl AiState {
    pub fn new(identifier: &str, isolated: bool) -> Result<Self, reqwest::Error> {
        let endpoint = if cfg!(debug_assertions) && isolated {
            std::env::var("DAFEIYU_TEST_AI_ENDPOINT").ok().filter(|s| {
                reqwest::Url::parse(s).is_ok_and(|u| u.scheme()=="http" && u.host_str()==Some("127.0.0.1") && u.port().is_some() && u.path()=="/chat/completions")
            }).unwrap_or_else(||"https://api.deepseek.com/chat/completions".into())
        } else {"https://api.deepseek.com/chat/completions".into()};
        Ok(Self {target:format!("{identifier}/deepseek"), client:reqwest::Client::builder().redirect(reqwest::redirect::Policy::none()).timeout(Duration::from_secs(60)).connect_timeout(Duration::from_secs(15)).build()?, endpoint, requests:Mutex::default()})
    }
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Source { reference: usize, title: String, date: String, body: String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
pub struct Inquiry { id: String, question: String, context: String, sources: Vec<Source>, #[serde(default)] conversation: Vec<ConversationTurn>, language: String, #[serde(default)] allow_creation:bool }
#[derive(Deserialize,Serialize)]
#[serde(deny_unknown_fields)]
pub struct ConversationTurn { question:String, answer:String }
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all="camelCase")]
pub struct Answer { answer: String, citations: Vec<usize>, #[serde(default)] next_steps: Vec<String>, #[serde(default,skip_serializing_if="Option::is_none")] creation:Option<crate::creation::Proposal> }
#[derive(Serialize)]
pub struct Status { configured: bool, supported: bool }

#[cfg(windows)]
mod credential {
    use windows_sys::Win32::{Foundation::{GetLastError, ERROR_NOT_FOUND}, Security::Credentials::*};
    fn wide(value:&str)->Vec<u16>{value.encode_utf16().chain(Some(0)).collect()}
    pub fn read(target:&str)->Result<Option<String>,String>{
        let name=wide(target);let mut ptr=std::ptr::null_mut();
        unsafe {
            if CredReadW(name.as_ptr(),CRED_TYPE_GENERIC,0,&mut ptr)==0 {
                return if GetLastError()==ERROR_NOT_FOUND {Ok(None)} else {Err("无法读取 Windows 凭据，请重新设置密钥。".into())};
            }
            let credential=&*ptr;
            let result=if credential.CredentialBlobSize>0 && credential.CredentialBlobSize<=512 && !credential.CredentialBlob.is_null(){
                String::from_utf8(std::slice::from_raw_parts(credential.CredentialBlob,credential.CredentialBlobSize as usize).to_vec()).ok()
            }else{None};
            CredFree(ptr.cast());Ok(result)
        }
    }
    pub fn write(target:&str,key:&str)->Result<(),String>{
        let mut name=wide(target);let mut user=wide("DeepSeek");let mut secret=key.as_bytes().to_vec();
        let mut value:CREDENTIALW=unsafe{std::mem::zeroed()};
        value.Type=CRED_TYPE_GENERIC;value.TargetName=name.as_mut_ptr();value.UserName=user.as_mut_ptr();value.CredentialBlobSize=secret.len() as u32;value.CredentialBlob=secret.as_mut_ptr();value.Persist=CRED_PERSIST_LOCAL_MACHINE;
        let ok=unsafe{CredWriteW(&value,0)}!=0;secret.fill(0);
        if ok {Ok(())} else {Err("无法保存到 Windows 凭据管理器，密钥未保存。".into())}
    }
    pub fn delete(target:&str)->Result<(),String>{
        let name=wide(target);let ok=unsafe{CredDeleteW(name.as_ptr(),CRED_TYPE_GENERIC,0)}!=0;
        if ok||unsafe{GetLastError()}==ERROR_NOT_FOUND {Ok(())}else{Err("无法移除 Windows 凭据，请重试。".into())}
    }
}
#[cfg(not(windows))]
mod credential {
    pub fn read(_: &str)->Result<Option<String>,String>{Ok(None)}
    pub fn write(_: &str,_: &str)->Result<(),String>{Err("本版 AI 密钥设置仅支持 Windows 桌面版。".into())}
    pub fn delete(_: &str)->Result<(),String>{Ok(())}
}

#[tauri::command]
pub fn ai_status(state:tauri::State<AiState>)->Result<Status,String>{Ok(Status{configured:credential::read(&state.target)?.is_some(),supported:cfg!(windows)})}
#[tauri::command]
pub fn ai_save_key(state:tauri::State<AiState>,key:String)->Result<(),String>{
    let key=key.trim();
    if key.len()<16||key.len()>256||!key.is_ascii()||key.chars().any(char::is_whitespace){return Err("请填写完整的 API Key。".into());}
    credential::write(&state.target,key)
}
#[tauri::command]
pub fn ai_delete_key(state:tauri::State<AiState>)->Result<(),String>{credential::delete(&state.target)}
#[tauri::command]
pub fn ai_cancel(state:tauri::State<AiState>,id:String)->Result<(),String>{
    if uuid::Uuid::parse_str(&id).is_err(){return Err("无效的请求编号。".into());}
    let mut requests=state.requests.lock().map_err(|_|"请求状态不可用。")?;
    if let Some(sender)=requests.active.remove(&id){let _=sender.send(());}else{
        if requests.cancelled.len()>=64 {requests.cancelled.clear();}
        requests.cancelled.insert(id);
    }Ok(())
}
fn validate(inquiry:&Inquiry)->Result<(),String>{
    if uuid::Uuid::parse_str(&inquiry.id).is_err()||inquiry.question.trim().is_empty()||inquiry.question.chars().count()>2000||inquiry.context.chars().count()>2000||inquiry.sources.len()>5||!matches!(inquiry.language.as_str(),"zh"|"en") {return Err("请缩短问题或片段后重试。".into());}
    for (index,source) in inquiry.sources.iter().enumerate(){
        if source.reference!=index+1||source.body.chars().count()>1500||source.title.chars().count()>200||source.date.len()>40 {return Err("参考原文不符合发送范围，请重新预览。".into());}
    }
    if inquiry.conversation.len()>3||inquiry.conversation.iter().any(|turn|turn.question.trim().is_empty()||turn.question.chars().count()>2000||turn.answer.trim().is_empty()||turn.answer.chars().count()>6000){return Err("本次聊天过长，请清空聊天后重试。".into());}
    Ok(())
}
fn payload(inquiry:&Inquiry)->Value{
    json!({"model":"deepseek-flash","stream":false,"max_tokens":if inquiry.allow_creation{3600}else{1800},"thinking":{"type":"disabled"},"response_format":{"type":"json_object"},"messages":[
        {"role":"system","content":if inquiry.allow_creation{format!("{}\n{}",include_str!("ai_prompt.txt"),include_str!("creation_prompt.txt"))}else{include_str!("ai_prompt.txt").to_string()}},
        {"role":"user","content":serde_json::to_string(&json!({"nowLocal":chrono::Local::now().format("%Y-%m-%d %H:%M %:z").to_string(),"language":inquiry.language,"question":inquiry.question,"context":inquiry.context,"sources":inquiry.sources,"conversation":inquiry.conversation})).unwrap()}
    ]})
}
fn parse_answer(value:Value,count:usize)->Result<Answer,String>{
    let text=value.pointer("/choices/0/message/content").and_then(Value::as_str).ok_or("模型没有返回完整回答，请重试。")?;
    let answer:Answer=serde_json::from_str(text).map_err(|_|"模型返回的格式不完整，请重试。")?;
    if answer.answer.trim().is_empty()||answer.answer.chars().count()>6000||answer.citations.iter().any(|id|*id==0||*id>count)||answer.next_steps.len()>3||answer.next_steps.iter().any(|step|step.chars().count()>200) {return Err("模型回答或来源编号不完整，请重新询问。".into());}
    if let Some(proposal)=&answer.creation{crate::creation::validate(proposal)?;}
    // Every explicit citation in the text must also point to supplied evidence.
    for rest in answer.answer.split('[').skip(1) {if let Some((number,_))=rest.split_once(']'){if let Ok(id)=number.parse::<usize>(){if id==0||id>count||!answer.citations.contains(&id){return Err("模型引用了未提供的来源，请重新询问。".into());}}}}
    Ok(answer)
}
async fn fetch(state:&AiState,inquiry:&Inquiry,key:String)->Result<Answer,String>{
    let mut response=state.client.post(&state.endpoint).bearer_auth(key).json(&payload(inquiry)).send().await.map_err(|e|if e.is_timeout(){"连接超时，请重试。"}else{"无法连接 DeepSeek，请检查网络后重试。"})?;
    if !response.status().is_success(){return Err(match response.status().as_u16(){401|403=>"API Key 无效，请重新设置。",402=>"模型额度不足，请到服务商查看。",429=>"请求较多，请稍后重试。",_=>"模型服务暂时不可用，请稍后重试。"}.into());}
    let mut bytes=Vec::new();while let Some(chunk)=response.chunk().await.map_err(|_|"接收回答失败，请重试。")?{if bytes.len()+chunk.len()>128*1024{return Err("回答过长，请缩短问题后重试。".into());}bytes.extend_from_slice(&chunk);}
    let value=serde_json::from_slice(&bytes).map_err(|_|"模型响应无法读取，请重试。")?;let answer=parse_answer(value,inquiry.sources.len())?;if answer.creation.is_some()&&!inquiry.allow_creation{return Err("回答包含未请求的创建草案，请重新询问。".into());}Ok(answer)
}
#[tauri::command]
pub async fn ai_ask(state:tauri::State<'_,AiState>,inquiry:Inquiry)->Result<Answer,String>{
    validate(&inquiry)?;
    let key=credential::read(&state.target)?.ok_or("请先设置 DeepSeek API Key。")?;
    let (sender,receiver)=oneshot::channel();
    {let mut requests=state.requests.lock().map_err(|_|"请求状态不可用。")?;
        if requests.cancelled.remove(&inquiry.id){return Err("已停止思考。".into());}
        if requests.active.len()>=2||requests.active.contains_key(&inquiry.id){return Err("请等待当前思考完成。".into());}
        requests.active.insert(inquiry.id.clone(),sender);
    }
    let result=tokio::select!{answer=fetch(&state,&inquiry,key)=>answer,_=receiver=>Err("已停止思考。".into())};
    if let Ok(mut requests)=state.requests.lock(){requests.active.remove(&inquiry.id);}result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn inquiry()->Inquiry{Inquiry{id:"c6609df3-4bc6-4d68-94c0-ce2ba0c96019".to_string(),question:"为什么？".into(),context:String::new(),sources:vec![Source{reference:1,title:"原文".into(),date:"2026-10-28".into(),body:"暂缓上云，因为预算有限。".into()}],conversation:vec![],language:"zh".into(),allow_creation:false}}
    #[test] fn payload_limits_and_untrusted_evidence(){let mut q=inquiry();assert!(validate(&q).is_ok());let p=payload(&q);assert_eq!(p["model"],"deepseek-flash");assert_eq!(p["messages"].as_array().unwrap().len(),2);assert!(p["messages"][1]["content"].as_str().unwrap().contains("暂缓上云"));q.sources[0].reference=7;assert!(validate(&q).is_err());}
    #[test] fn reject_fabricated_citations(){assert!(parse_answer(json!({"choices":[{"message":{"content":"{\"answer\":\"见[2]\",\"citations\":[2],\"nextSteps\":[]}"}}]}),1).is_err());assert!(parse_answer(json!({"choices":[{"message":{"content":"{\"answer\":\"见[2]\",\"citations\":[1],\"nextSteps\":[]}"}}]}),1).is_err());}
    #[test] fn accept_grounded_answer_and_reject_empty(){assert!(parse_answer(json!({"choices":[{"message":{"content":"{\"answer\":\"原文说预算有限[1]\",\"citations\":[1],\"nextSteps\":[]}"}}]}),1).is_ok());assert!(parse_answer(json!({"choices":[{"message":{"content":"{\"answer\":\"\",\"citations\":[],\"nextSteps\":[]}"}}]}),1).is_err());}
    #[test] fn optional_steps_and_bounded_followups(){
        assert!(parse_answer(json!({"choices":[{"message":{"content":"{\"answer\":\"那就先歇一会儿吧。\",\"citations\":[]}"}}]}),0).unwrap().next_steps.is_empty());
        let mut q=inquiry();q.conversation.push(ConversationTurn{question:"我担心费用。".into(),answer:"先保留本地版本也可以。".into()});
        assert!(validate(&q).is_ok());assert!(payload(&q)["messages"][1]["content"].as_str().unwrap().contains("我担心费用"));
        for _ in 0..3{q.conversation.push(ConversationTurn{question:"后来呢？".into(),answer:"接着聊。".into()});}assert!(validate(&q).is_err());
    }
}
