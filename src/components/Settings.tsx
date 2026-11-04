import { useEffect,useRef } from 'react';
import { useI18n } from '../i18n';
import { useCompanion } from '../companion/preferences';
import { recoveryEnabled,setRecoveryEnabled } from '../storage/recovery';
import { useState } from 'react';
import {readMemoryPreferences,updateMemoryPreferences} from '../storage/memory-preferences';
import type {MemoryPreferences} from '../domain/resurfacing';
import AiSettings from './AiSettings';
import TaskStripSettings from '../tasks/TaskStripSettings';
import PlannerSettings from '../tasks/PlannerSettings';
import TrashRetentionSettings from './TrashRetention';
export default function Settings({onClose,initialTab='general'}:{onClose:()=>void;initialTab?:'general'|'companion'|'model'|'data'}) {
  const dialog=useRef<HTMLDialogElement>(null);const {t,language,setLanguage}=useI18n();const {preferences,update}=useCompanion();
  const [protect,setProtect]=useState(recoveryEnabled);
  const [tab,setTab]=useState(initialTab);
  const [frequency,setFrequency]=useState(()=>readMemoryPreferences().frequency);
  useEffect(()=>{const changed=()=>setFrequency(readMemoryPreferences().frequency);window.addEventListener('dafeiyu-memory-setting',changed);return()=>window.removeEventListener('dafeiyu-memory-setting',changed);},[]);
  useEffect(()=>{dialog.current?.showModal();},[]);
  return <dialog ref={dialog} className="settings-dialog" aria-labelledby="settings-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2 id="settings-title">{t('设置')}</h2><button className="text-button" onClick={onClose}>{t('关闭')}</button></header>
    <nav className="settings-tabs" role="tablist" aria-label={t('设置分组')}>{(['general','companion','model','data'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} onClick={()=>setTab(value)}>{t({general:'通用',companion:'伙伴',model:'模型',data:'数据'}[value])}</button>)}</nav>
    <fieldset hidden={tab!=='general'}><legend>{t('语言')}</legend><div className="setting-options"><button aria-pressed={language==='en'} onClick={()=>setLanguage('en')}>English</button><button aria-pressed={language==='zh'} onClick={()=>setLanguage('zh')}>简体中文</button></div></fieldset>
    <fieldset hidden={tab!=='data'}><legend>{t('记录保护')}</legend><label className="setting-row"><input type="checkbox" checked={protect} onChange={event=>{setProtect(event.target.checked);setRecoveryEnabled(event.target.checked);}}/>{t('本地崩溃恢复')}</label><p className="settings-help">{t('每12秒保留未保存副本；恢复后仍需手动保存。')}</p></fieldset>
    <fieldset hidden={tab!=='general'}><legend>{t('回顾')}</legend><label className="recall-frequency">{t('首页回顾频率')}<select aria-label={t('首页回顾频率')} value={frequency} onChange={event=>{const value=event.target.value as MemoryPreferences['frequency'];setFrequency(value);updateMemoryPreferences({frequency:value});}}><option value="daily">{t('每天一条')}</option><option value="quiet">{t('每三天一条')}</option><option value="off">{t('关闭')}</option></select></label></fieldset>
    <div hidden={tab!=='general'}><TaskStripSettings/><PlannerSettings/></div>
    <div hidden={tab!=='data'}><TrashRetentionSettings/></div>
    <div hidden={tab!=='model'}><AiSettings/></div>
    <fieldset hidden={tab!=='companion'}><legend>{t('角色')}</legend><div className="setting-row"><label><input type="checkbox" checked={preferences.visible} onChange={event=>update({visible:event.target.checked})} />{t('显示角色')}</label><label><input type="checkbox" checked={preferences.reduced} onChange={event=>update({reduced:event.target.checked})} />{t('减少动态')}</label></div><div className="setting-options"><button aria-pressed={preferences.wandering} onClick={()=>update({wandering:true})}>{t('自由活动')}</button><button aria-pressed={!preferences.wandering} onClick={()=>update({wandering:false})}>{t('待在这里')}</button></div><label className="size-setting">{t('大小')}<input type="range" aria-label={t('大小')} min={40} max={72} step={8} value={preferences.size} onChange={event=>update({size:Number(event.target.value)})} /><span>{preferences.size}px</span></label><button className="text-button" onClick={()=>update({position:null,wandering:true})}>{t('回到角落')}</button></fieldset>
    <fieldset hidden={tab!=='companion'}><legend>{t('互动回应')}</legend><label className="setting-row"><input type="checkbox" checked={preferences.recordReplies} onChange={event=>update({recordReplies:event.target.checked,...(!event.target.checked?{onlineReplies:false}:{})})}/>{t('结合当前已保存记录回应')}</label><label className="setting-row"><input type="checkbox" checked={preferences.onlineReplies} disabled={!preferences.recordReplies} onChange={event=>update({onlineReplies:event.target.checked})}/>{t('允许联网生成互动回应')}</label><p className="settings-help">{t('开启后，触碰时可将当前已保存记录的一小段发送给 DeepSeek；不发送未保存内容，最多每30秒一次。')}</p></fieldset>
    <details hidden={tab!=='data'} className="settings-credits"><summary>{t('关于与素材署名')}</summary><p>{t('大肥鱼为社区二创形象。原型：上善无形；女仆鲸鱼娘设计：ZipZipPipe。')}</p><p>{t('动画：PC2005-cloud/dsh-pet。实现参考：MerZlin/dsh-pet-indesktop。')}</p><p>CC BY-NC-SA 4.0 · {t('署名、非商业、相同方式共享。')} <a href="/mascot/dafeiyu/NOTICE.md" target="_blank" rel="noreferrer">{t('查看完整来源')}</a></p><p><a href="/fonts/NOTICE.md" target="_blank" rel="noreferrer">{t('字体来源与许可')}</a></p></details>
  </dialog>;
}
