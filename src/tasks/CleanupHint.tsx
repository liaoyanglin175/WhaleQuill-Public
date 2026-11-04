import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {useI18n} from '../i18n';
import {cleanupEnabled} from '../domain/planner';
import {stripPreferences} from './client';
export default function CleanupHint(){
 const {t}=useI18n(),[enabled,setEnabled]=useState<boolean|null>(isTauri()?null:cleanupEnabled());
 useEffect(()=>{let alive=true,stop:(()=>void)|undefined;const refresh=()=>{if(isTauri())void stripPreferences().then(value=>{if(alive)setEnabled(value.cleanupEnabled);}).catch(()=>{});else setEnabled(cleanupEnabled());};refresh();if(isTauri())void listen('task-strip-settings',refresh).then(unlisten=>{if(alive)stop=unlisten;else unlisten();});window.addEventListener('jingjian-cleanup-setting',refresh);return()=>{alive=false;stop?.();window.removeEventListener('jingjian-cleanup-setting',refresh);};},[]);
 return <span className="planner-cleanup-hint">{t(enabled?'完成的待办次日移入回收站，可恢复。':'清理方式可在设置中调整。')}</span>;
}
