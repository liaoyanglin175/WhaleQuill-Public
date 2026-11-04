import {useEffect,useState} from 'react';
import {getRepository} from '../storage/repository';
import type {RetentionDays,TrashRetentionInfo} from '../domain/trash-retention';
import {useI18n} from '../i18n';

export function useTrashRetention(refreshKey?:unknown){
 const [info,setInfo]=useState<TrashRetentionInfo|null>(null),[error,setError]=useState('');
 useEffect(()=>{let alive=true;const read=()=>void getRepository().then(repo=>repo.trashRetentionInfo()).then(value=>{if(alive){setInfo(value);setError('');}}).catch(()=>{if(alive)setError('保留规则未能读取，请重试。');});read();window.addEventListener('jingjian-trash-policy',read);window.addEventListener('focus',read);return()=>{alive=false;window.removeEventListener('jingjian-trash-policy',read);window.removeEventListener('focus',read);};},[refreshKey]);
 return {info,error,setInfo};
}
export default function TrashRetentionSettings(){
 const {t}=useI18n(),{info,error:loadError,setInfo}=useTrashRetention(),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState<{days:RetentionDays;count:number}|null>(null);
 async function apply(days:RetentionDays,count:number){setBusy(true);setError('');try{const repo=await getRepository();setInfo(await repo.setTrashRetention(days,count));setPending(null);window.dispatchEvent(new Event('jingjian-trash-policy'));window.dispatchEvent(new Event('jingjian-cleanup-setting'));}catch(e){setError(e instanceof Error?e.message:String(e));setPending(null);}finally{setBusy(false);}}
 async function choose(value:string){const days=value==='off'?null:Number(value) as RetentionDays;setError('');setPending(null);setBusy(true);try{const count=await(await getRepository()).previewTrashRetention(days);if(count)setPending({days,count});else await apply(days,0);}catch{setError('保留规则未能修改，请重试。');}finally{setBusy(false);}}
 return <fieldset className="trash-retention-settings"><legend>{t('回收站')}</legend><label>{t('已删除内容保留')}<select aria-label={t('回收站保留期限')} disabled={busy||!info} value={pending?.days??info?.policy.days??'off'} onChange={event=>void choose(event.target.value)}><option value={7}>{t('7天')}</option><option value={30}>{t('30天')}</option><option value={90}>{t('90天')}</option><option value="off">{t('关闭自动清理')}</option></select></label>
  <p className="settings-help">{t('到期永久清除，无法恢复；已有导出备份不受影响。')}</p><p className="settings-help">{t('首次启用及重新启用时，旧内容获得完整保留期。')}</p>
  {pending&&<div className="trash-retention-confirm" role="alert"><p>{t('将永久清除{0}条已删除内容，无法恢复。',pending.count)}</p><button className="button secondary" disabled={busy} onClick={()=>setPending(null)}>{t('取消')}</button><button className="button primary" disabled={busy} onClick={()=>void apply(pending.days,pending.count)}>{t('确认清理并修改')}</button></div>}
  {(error||loadError)&&<p className="save-error" role="alert">{t(error||loadError)}</p>}
 </fieldset>;
}
