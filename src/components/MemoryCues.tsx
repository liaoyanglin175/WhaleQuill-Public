import {useEffect,useState} from 'react';
import {ArrowUpRight,Highlighter,MoreHorizontal,X} from 'lucide-react';
import {useI18n} from '../i18n';
import type {NoteRecord} from '../domain/models';
import {recordTitle} from '../domain/models';
import {dailyResurfacing,localDay,resurfacingCandidates} from '../domain/resurfacing';
import type {ResurfaceCue,MemoryPreferences} from '../domain/resurfacing';
import {readMemoryPreferences,updateMemoryPreferences} from '../storage/memory-preferences';

export default function MemoryCues({records,onOpen,all=false,query='',onFeaturedChange}:{records:NoteRecord[];all?:boolean;query?:string;onOpen:(record:NoteRecord,selection?:{start:number;end:number})=>void;onFeaturedChange?:(id:string|null)=>void}){
 const {t,locale}=useI18n();const [prefs,setPrefs]=useState(readMemoryPreferences);
 useEffect(()=>{const changed=(event:Event)=>setPrefs((event as CustomEvent<MemoryPreferences>).detail??readMemoryPreferences());window.addEventListener('dafeiyu-memory-setting',changed);const timer=setInterval(()=>{if(localDay()!==prefs.day)setPrefs(readMemoryPreferences());},60_000);return()=>{clearInterval(timer);window.removeEventListener('dafeiyu-memory-setting',changed);};},[prefs.day]);
 const cue=all?null:dailyResurfacing(records,prefs);
 useEffect(()=>{onFeaturedChange?.(cue?.record.id??null);},[cue?.record.id,onFeaturedChange]);
 useEffect(()=>{if(!cue||all)return;if(prefs.selected!==cue.id||prefs.shown[cue.record.id]!==prefs.day)updateMemoryPreferences({selected:cue.id,shown:{...prefs.shown,[cue.record.id]:prefs.day}});},[all,cue?.id,cue?.record.id,prefs.day,prefs.selected,prefs.shown]);
 const terms=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
 const allCues:ResurfaceCue[]=all?records.flatMap(record=>record.highlights.map(highlight=>({id:highlight.id,record,highlight,text:highlight.text,start:highlight.start,end:highlight.end,reason:highlight.stale?'原文已修改 · 保留旧重点供核对':'你亲手划过的重点'}))).filter(({record,highlight})=>terms.every(term=>[recordTitle(record),highlight!.text,record.createdAt,new Date(record.createdAt).toLocaleDateString(locale),highlight!.createdAt,new Date(highlight!.createdAt).toLocaleDateString(locale)].join('\n').toLocaleLowerCase().includes(term))).sort((a,b)=>Date.parse(b.highlight!.createdAt)-Date.parse(a.highlight!.createdAt)):cue?[cue]:[];
 if(!all&&prefs.frequency==='off')return <button className="text-button enable-memory" onClick={()=>updateMemoryPreferences({frequency:'daily',hiddenToday:false})}>{t('开启首页回顾')}</button>;
 if(!all&&prefs.hiddenToday)return <button className="text-button enable-memory" onClick={()=>updateMemoryPreferences({hiddenToday:false})}>{t('展开今日回顾')}</button>;
 if(!all&&!cue&&(!resurfacingCandidates(records).length||!prefs.dismissed.length))return null;
 return <section className={`memory-cues ${all?'all-highlights':'daily-memory'}`} aria-label={all?t('全部重点'):t('可能有用的回顾')}>
  <div className="memory-heading"><div><h2>{all&&<Highlighter size={17}/>} {all?t('你划过的重点'):t('重读一页')}</h2>{all&&<p>{t('重点、记录时间和原文都在这里。')}</p>}</div>{!all&&<div className="memory-controls"><button className="text-button" disabled={!cue} onClick={()=>cue&&updateMemoryPreferences({selected:'',dismissed:[...prefs.dismissed,cue.id]})}>{t('换一条')}</button><details className="memory-options"><summary aria-label={t('回顾选项')} title={t('回顾选项')}><MoreHorizontal size={17}/></summary><div><button onClick={event=>{updateMemoryPreferences({frequency:prefs.frequency==='quiet'?'daily':'quiet'});event.currentTarget.closest('details')!.open=false;}}>{t(prefs.frequency==='quiet'?'恢复每日回顾':'减少出现')}</button><button onClick={()=>updateMemoryPreferences({frequency:'off'})}>{t('关闭首页回顾')}</button></div></details></div>}</div>
  <div className="memory-grid">{allCues.map(({id,record,highlight,text,start,end,reason})=><article className={`memory-card ${highlight?.stale?'stale':''}`} key={id} data-record-id={record.id}>
   <div className="memory-reason">{t(reason)}{!all&&<button className="icon-button" aria-label={t(highlight?'今天收起重点：{0}':'今天收起记录：{0}',text.slice(0,30))} title={t('今天不再提示')} onClick={()=>updateMemoryPreferences({hiddenToday:true})}><X size={14}/></button>}</div>
   <h3>{recordTitle(record)==='未命名记录'?t('未命名记录'):recordTitle(record)}</h3><p className="memory-dates">{t('记录于 ')}<time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleDateString(locale)}</time>{highlight&&<>{t(' · 划重点于 ')}<time dateTime={highlight.createdAt}>{new Date(highlight.createdAt).toLocaleDateString(locale)}</time></>}</p>
   <blockquote>{text}</blockquote><button className="text-button" onClick={()=>onOpen(record,highlight?.stale?undefined:{start,end})}>{highlight?.stale?t('打开记录重新核对'):t('打开记录')}<ArrowUpRight size={14}/></button>
  </article>)}</div>
  {!allCues.length&&<p className="memory-empty">{all?query?t('没有匹配的重点，试试事情或时间线索。'):t('写记录时选中一句话，点“划重点”，保存后就会收在这里。'):t('今天先看到这里。')}</p>}
 </section>;
}
