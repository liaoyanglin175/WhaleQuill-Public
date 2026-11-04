import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {useI18n} from '../i18n';
import {stripPreferences,updateStrip} from './client';
import type {StripPreferences} from './client';
export default function TaskStripSettings(){
  const {t}=useI18n();const [preferences,setPreferences]=useState<StripPreferences>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{if(isTauri())void stripPreferences().then(setPreferences).catch(()=>setError('未能读取便签设置，请重试。'));},[]);
  if(!isTauri())return null;
  async function update(patch:Parameters<typeof updateStrip>[0]){setBusy(true);setError('');try{setPreferences(await updateStrip(patch));}catch{setError('未能保存便签设置，请重试。');}finally{setBusy(false);}}
  return <fieldset><legend>{t('便签后台')}</legend><label className="setting-row"><input type="checkbox" checked={preferences?.enabled??false} disabled={!preferences||busy} onChange={event=>void update({enabled:event.target.checked})}/>{t('启用便签后台')}</label><p className="settings-help">{t('关闭主窗口后继续显示。收起便签不停止提醒；从托盘退出后台后停止。')}</p><label className="setting-row"><input type="checkbox" checked={preferences?.remindersEnabled??true} disabled={!preferences?.enabled||busy} onChange={event=>void update({remindersEnabled:event.target.checked})}/>{t('截止前提醒两次')}</label><p className="settings-help">{t('默认提前6小时和1小时，短任务自动缩短间隔。系统横幅受Windows通知设置影响。')}</p><button className="text-button" disabled={!preferences||busy} onClick={()=>void update({reset:true})}>{t('复位便签位置')}</button>{error&&<p role="alert">{t(error)}</p>}</fieldset>;
}
