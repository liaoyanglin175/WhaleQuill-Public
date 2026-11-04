import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {useI18n} from '../i18n';
import {cleanupEnabled,setCleanupEnabled} from '../domain/planner';
import {stripPreferences,updateStrip} from './client';
export default function PlannerSettings(){
 const {t}=useI18n(),[enabled,setEnabled]=useState(cleanupEnabled),[ready,setReady]=useState(!isTauri()),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;if(isTauri())void stripPreferences().then(value=>{if(active){setEnabled(value.cleanupEnabled);setReady(true);}}).catch(()=>{if(active)setError('未能读取便签设置，请重试。');});return()=>{active=false;};},[]);
 return <fieldset><legend>{t('待办清理')}</legend><label className="setting-row"><input type="checkbox" checked={enabled} disabled={!ready||busy} onChange={async event=>{const value=event.target.checked;setBusy(true);setError('');try{if(isTauri())await updateStrip({cleanupEnabled:value});else setCleanupEnabled(value);setEnabled(value);window.dispatchEvent(new Event('jingjian-cleanup-setting'));}catch{setError('未能保存便签设置，请重试。');}finally{setBusy(false);}}}/>{t('次日清理已完成待办')}</label><p className="settings-help">{t('按本地日期移入回收站，可恢复。程序关闭时，下次打开处理。')}</p>{error&&<p role="alert">{t(error)}</p>}</fieldset>;
}
