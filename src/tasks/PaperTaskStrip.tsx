import {useCallback,useEffect,useRef,useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {ArrowUpRight,Check,Clock3,MoreHorizontal,Pin,PinOff,GripVertical,ChevronLeft,ChevronRight} from 'lucide-react';
import type {Task} from '../domain/models';
import type {ReminderNotice} from '../domain/reminders';
import {remainingText,taskDeadline,isTaskOverdue} from '../domain/reminders';
import {translate} from '../i18n';
import {defaultStripPreferences,setTaskStatus,stripPreferences,stripTasks,subscribeStrip,updateStrip} from './client';
import {retainRows} from './model';
import {eventOrder,eventTime,isTodayEvent,plannerDay} from '../domain/planner';
import './task-strip.css';
import './paper-strip.css';
import useStripDocking from './useStripDocking';

export default function PaperTaskStrip(){
 const [tasks,setTasks]=useState<Task[]>([]),[ids,setIds]=useState<string[]>([]),[preferences,setPreferences]=useState(defaultStripPreferences),[notices,setNotices]=useState<ReminderNotice[]>([]);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[loaded,setLoaded]=useState(false),[showDone,setShowDone]=useState(false),[now,setNow]=useState(Date.now());
 const sequence=useRef(0),alive=useRef(true),root=useRef<HTMLElement>(null);
 const {dock,fold,events:dockEvents}=useStripDocking(root,busy);
 const t=(text:string,...values:unknown[])=>translate(text,preferences.language,...values);
 const refresh=useCallback(async(reset=false)=>{
  const token=++sequence.current;
  try{const [next,prefs,reminders]=await Promise.all([stripTasks(),stripPreferences(),isTauri()?invoke<ReminderNotice[]>('reminder_notices'):Promise.resolve([])]);if(!alive.current||token!==sequence.current)return;
   setTasks(next);setPreferences(prefs);setNotices(reminders);setIds(previous=>retainRows(reset?[]:previous,next));setLoaded(true);setNow(Date.now());if(reset)setShowDone(false);
  }catch{if(alive.current&&token===sequence.current){setLoaded(true);setError('未能读取待办，请重试。');}}
 },[]);
 useEffect(()=>{alive.current=true;let stop:(()=>void)|undefined;void subscribeStrip(()=>void refresh(),()=>void refresh(true)).then(unsubscribe=>{if(alive.current){stop=unsubscribe;void refresh(true);}else unsubscribe();}).catch(()=>setError('未能读取待办，请重试。'));const timer=setInterval(()=>setNow(Date.now()),30_000);return()=>{alive.current=false;sequence.current++;stop?.();clearInterval(timer);};},[refresh]);
 useEffect(()=>{const close=(event:PointerEvent)=>root.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach(menu=>{if(!menu.contains(event.target as Node))menu.open=false;});document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close);},[]);
 async function action(run:()=>Promise<unknown>){if(busy)return;setBusy(true);setError('');try{await run();await refresh();}catch{setError('操作未完成，请重试。');await refresh();}finally{if(alive.current)setBusy(false);}}
 const today=plannerDay(new Date(now)),pending=tasks.filter(task=>task.kind==='task'&&task.status==='todo').length,events=tasks.filter(task=>isTodayEvent(task,today)).sort(eventOrder),map=new Map(tasks.map(task=>[task.id,task]));
 const rows=ids.map(id=>map.get(id)).filter((task):task is Task=>!!task&&(task.status==='todo'||!!task.completedAt&&plannerDay(new Date(task.completedAt))===today));
 const earlierDone=tasks.filter(task=>task.kind==='task'&&task.status==='done'&&!!task.completedAt&&plannerDay(new Date(task.completedAt))===today&&!ids.includes(task.id)).sort((a,b)=>(b.completedAt??'').localeCompare(a.completedAt??''));
 const reminders=notices.filter(notice=>{const task=map.get(notice.taskId);return task?.status==='todo'&&taskDeadline(task)===notice.dueAt;});
 function row(task:Task){const done=task.status==='done',overdue=isTaskOverdue(task,now);const date=task.dueDate===today?'':task.dueDate;
  return <li key={task.id} className={`strip-task${done?' is-done':''}`}>
   <button className="strip-check" role="checkbox" aria-checked={done} aria-label={t(done?'标为未完成：{0}':'完成任务：{0}',task.title)} disabled={busy} onClick={()=>void action(()=>setTaskStatus(task))}>{done&&<Check size={12}/>}</button>
   <div className="strip-task-copy"><span className="strip-task-title">{task.title}</span>{(date||task.dueTime||overdue)&&<span className={`strip-date${overdue?' overdue':''}`}>{overdue?t('已逾期'):[date,task.dueTime].filter(Boolean).join(' ')}</span>}</div>{task.priority==='high'&&!done&&<span className="strip-priority" title={t('重要')} aria-label={t('重要')}/>}
  </li>;
 }
 if(dock.folded)return <main ref={root} {...dockEvents} className={`task-strip paper-strip is-folded dock-${dock.side}`} aria-label={t('鲸笺便签')}>
  <button className="strip-edge-grip" aria-label={t('移动待办便签')} title={t('拖动移动；Home复位')} onPointerDown={()=>{if(isTauri())void getCurrentWindow().startDragging().catch(()=>{});}} onKeyDown={event=>{if(event.key==='Home'){event.preventDefault();void updateStrip({reset:true});}else if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();void invoke('move_task_strip',{dx:event.key==='ArrowLeft'?-24:24,dy:0});}}}><GripVertical size={12}/></button>
  <button className="strip-edge-open" aria-label={t('展开待办便签，{0}项',pending+events.length)} title={t('单击展开')} onClick={()=>void fold(false)}>{dock.side==='left'?<ChevronRight size={15}/>:<ChevronLeft size={15}/>}<span>{pending+events.length}</span>{reminders.length>0&&<i aria-label={t('有待办提醒')}/>}</button>
 </main>;
 return <main ref={root} {...dockEvents} className={`task-strip paper-strip ${dock.side?'is-edge-docked':''}`} aria-label={t('鲸笺便签')}>
  <header className="strip-header" tabIndex={0} aria-label={t('移动待办便签')} title={t('拖动移动；方向键移动，Home复位')} onKeyDown={event=>{if(event.target!==event.currentTarget||!isTauri())return;const moves:Record<string,[number,number]>={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};if(event.key==='Home'){event.preventDefault();void action(()=>updateStrip({reset:true}));}else if(moves[event.key]){event.preventDefault();const [dx,dy]=moves[event.key];void action(()=>invoke('move_task_strip',{dx,dy}));}}} onPointerDown={event=>{if(event.button!==0||(event.target as HTMLElement).closest('button,summary'))return;if(isTauri())void getCurrentWindow().startDragging().catch(()=>setError('未能移动便签，请重试。'));}}>
   <div className="strip-heading"><span>{t('今日')}</span><span className="strip-count">{pending+events.length}</span><small>{new Date(now).toLocaleDateString(preferences.language==='en'?'en-US':'zh-CN',{month:'short',day:'numeric'})}</small></div>
   <div className="strip-controls"><button aria-label={t(preferences.pinned?'取消置顶':'置顶便签')} title={t(preferences.pinned?'取消置顶':'置顶便签')} aria-pressed={preferences.pinned} disabled={busy||!isTauri()} onClick={()=>void action(()=>updateStrip({pinned:!preferences.pinned}))}>{preferences.pinned?<PinOff size={14}/>:<Pin size={14}/>}</button>
    <button aria-label={t('回到鲸笺')} title={t('回到鲸笺')} disabled={!isTauri()} onClick={()=>void action(()=>invoke('restore_notebook'))}><ArrowUpRight size={16}/></button>
    <details className="strip-menu" onClick={event=>{if((event.target as Element).closest('button'))event.currentTarget.open=false;}}><summary aria-label={t('便签操作')} title={t('便签操作')}><MoreHorizontal size={17}/></summary><div><button disabled={!isTauri()} onClick={()=>void action(()=>invoke('hide_task_strip'))}>{t('收起便签')}</button><button disabled={!isTauri()} onClick={()=>void action(()=>invoke('request_background_exit'))}>{t('退出便签后台')}</button></div></details>
   </div>
  </header>
  <div className="strip-content">{!loaded?<p className="strip-empty">{t('读取待办…')}</p>:<>
   {reminders.length>0&&<div className="strip-reminder" role="status"><span>{t('待办提醒')}</span><strong>{reminders[0].title}</strong><small>{remainingText(reminders[0].dueAt,now,preferences.language)}{reminders.length>1?' · '+t('另有{0}项',reminders.length-1):''}</small></div>}
   {pending===0&&!events.length&&<p className="strip-empty">{t(rows.length?'都完成了。':'暂时没有待办。')}</p>}
   {events.length>0&&<><h2 className="strip-section-label">{t('今日行程')}</h2><ul className="strip-rows">{events.map(task=><li className="strip-task strip-event" key={task.id}><Clock3 size={14}/><div className="strip-task-copy"><span className="strip-task-title">{task.title}</span><span className="strip-date">{eventTime(task)==='全天'?t('全天'):eventTime(task)}{task.location?' · '+task.location:''}</span></div></li>)}</ul>{rows.length>0&&<h2 className="strip-section-label">{t('待办')}</h2>}</>}
   <ul className="strip-rows">{rows.map(row)}</ul>
   {earlierDone.length>0&&<><button className="strip-done-toggle" aria-expanded={showDone} onClick={()=>setShowDone(!showDone)}>{t(showDone?'收起已完成 · {0}':'已完成 · {0}',earlierDone.length)}</button>{showDone&&<ul className="strip-rows">{earlierDone.map(row)}</ul>}</>}
  </>}</div>{error&&<div className="strip-error" role="alert"><span>{t(error)}</span><button onClick={()=>{setError('');void refresh();}}>{t('重试')}</button></div>}
 </main>;
}
