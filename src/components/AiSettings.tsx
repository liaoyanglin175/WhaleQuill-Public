import {useEffect,useRef,useState} from 'react';
import {aiStatus,saveAiKey,deleteAiKey,askAi} from '../ai/client';
import {useI18n} from '../i18n';
export default function AiSettings(){
  const {t,language}=useI18n(),[status,setStatus]=useState({configured:false,supported:false}),[key,setKey]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),controller=useRef<AbortController|null>(null);
  useEffect(()=>{let mounted=true;void aiStatus().then(value=>{if(mounted)setStatus(value);}).catch(()=>{});return()=>{mounted=false;controller.current?.abort();};},[]);
  async function perform(action:()=>Promise<void>,success:string){setBusy(true);setMessage('');try{await action();setKey('');setStatus(await aiStatus());setMessage(success);window.dispatchEvent(new Event('dafeiyu-ai-setting'));}catch(error){setMessage(String(error));}finally{setBusy(false);}}
  return <fieldset className="ai-settings"><legend>{t('AI（可选）')}</legend><details><summary>{t('DeepSeek 连接')}{status.configured?` · ${t('已设置')}`:''}</summary>
    {!status.supported?<p className="settings-help">{t('AI 在 Windows 桌面版中使用。')}</p>:<>
      <p className="settings-help">{t('密钥保存在 Windows 凭据管理器。每次发送前可预览原文，不自动上传笔记。')}</p>
      <label>{t('DeepSeek API Key')}<input type="password" aria-label="DeepSeek API Key" value={key} autoComplete="off" maxLength={256} placeholder={status.configured?t('已保存；填写可替换'):'sk-…'} onChange={event=>setKey(event.target.value)}/></label>
      <div className="setting-options"><button disabled={busy||!key.trim()} onClick={()=>void perform(()=>saveAiKey(key),'密钥已保存。')}>{t('保存密钥')}</button><button disabled={busy||!status.configured} onClick={()=>void perform(async()=>{const control=new AbortController();controller.current=control;await askAi({id:crypto.randomUUID(),question:'请回复连接成功。',context:'',sources:[],language,signal:control.signal});},'连接成功。')}>{t('测试连接')}</button><button disabled={busy||!status.configured} onClick={()=>void perform(deleteAiKey,'密钥已移除。')}>{t('移除密钥')}</button></div>
    </>}
    {message&&<p className="settings-help" role="status">{t(message)}</p>}
  </details></fieldset>;
}
