import {useEffect,useRef,useState} from 'react';
import {ArrowUpRight,Check,Clock3,MoreHorizontal,Plus} from 'lucide-react';
import {useI18n} from '../i18n';
import type {NoteRecord,Task} from '../domain/models';
import {blankPlannerDraft,buildPlannerTask} from '../domain/planner-draft';
import type {PlannerDraft} from '../domain/planner-draft';
import {eventOrder,eventTime,plannerDay,taskGroup} from '../domain/planner';
import {isTaskOverdue} from '../domain/reminders';
import {taskOrder} from '../tasks/model';
import PlannerEdit from './PlannerEdit';
import PlannerFields from './PlannerFields';
import CleanupHint from '../tasks/CleanupHint';

export default function PlannerPanel({tasks,records,busy,query,onAdd,onUpdate,onDelete,onOpenRecord,active=true}:{tasks:Task[];records:NoteRecord[];busy:boolean;query:string;onAdd:(task:Task)=>Promise<boolean>;onUpdate:(task:Task,expectedUpdatedAt?:string)=>Promise<boolean>;onDelete:(task:Task)=>void;onOpenRecord:(id:string)=>void;active?:boolean}){
 const {t}=useI18n(),root=useRef<HTMLElement>(null),composing=useRef(false);
 const [tab,setTab]=useState<'task'|'event'>(()=>localStorage.getItem('jingjian-planner-tab')==='event'?'event':'task');
 const [drafts,setDrafts]=useState({task:blankPlannerDraft(),event:blankPlannerDraft()}),[editing,setEditing]=useState<Task|null>(null),[showDone,setShowDone]=useState(false),[showPast,setShowPast]=useState(false),[error,setError]=useState('');
 const [now,setNow]=useState(Date.now);
 useEffect(()=>{if(!active)return;const refresh=()=>setNow(Date.now());refresh();const timer=setInterval(refresh,30_000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);return()=>{clearInterval(timer);window.removeEventListener('focus',refresh);document.removeEventListener('visibilitychange',refresh);};},[active]);
 const draft=drafts[tab],today=plannerDay(new Date(now));
 const update=(patch:Partial<PlannerDraft>)=>setDrafts(current=>({...current,[tab]:{...current[tab],...patch}}));
 useEffect(()=>{localStorage.setItem('jingjian-planner-tab',tab);setError('');},[tab]);
 useEffect(()=>{
  const close=(event:PointerEvent)=>root.current?.querySelectorAll<HTMLDetailsElement>('.planner-menu[open]').forEach(menu=>{if(!menu.contains(event.target as Node))menu.open=false;});
  const escape=(event:KeyboardEvent)=>{if(event.key!=='Escape')return;root.current?.querySelectorAll<HTMLDetailsElement>('.planner-menu[open]').forEach(menu=>{event.preventDefault();menu.open=false;menu.querySelector('summary')?.focus();});};
  document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};
 },[]);
 const words=query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
 const matching=tasks.filter(task=>task.kind===tab&&words.every(word=>[task.title,task.dueDate,task.eventDate,task.location,task.notes].join(' ').normalize('NFKC').toLocaleLowerCase().includes(word)));
 const pending=matching.filter(task=>task.status==='todo').sort(taskOrder),done=matching.filter(task=>task.status==='done'&&!!task.completedAt&&plannerDay(new Date(task.completedAt))===today).sort((a,b)=>(b.completedAt??b.updatedAt).localeCompare(a.completedAt??a.updatedAt));
 const events=matching.sort(eventOrder),future=events.filter(event=>(event.endDate??event.eventDate??'')>=today),past=events.filter(event=>(event.endDate??event.eventDate??'')<today);
 function row(task:Task){
  const source=records.find(record=>record.id===task.sourceRecordId),event=task.kind==='event',done=task.status==='done';
  return <article className={`task-row${event?' event-row':''}${done?' completed':''}`} key={task.id}>
   {event?<Clock3 size={17} className="planner-event-clock"/>:<button className="task-checkbox" disabled={busy} aria-label={t(done?'标为未完成：{0}':'完成任务：{0}',task.title)} onClick={()=>void onUpdate({...task,status:done?'todo':'done',updatedAt:new Date().toISOString()},task.updatedAt)}>{done&&<Check size={14}/>}</button>}
   <div className="task-description"><h3><button className="task-edit-name" aria-label={t(event?'编辑行程：{0}':'编辑任务：{0}',task.title)} onClick={()=>setEditing(task)} disabled={busy}>{task.title}</button>{!event&&task.priority==='high'&&<span className="planner-important">{t('重要')}</span>}</h3>
    <div className="task-details">{event?<span>{eventTime(task)==='全天'?t('全天'):eventTime(task)}{task.location?' · '+task.location:''}</span>:task.dueDate&&<span className={isTaskOverdue(task,now)?'overdue':''}>{task.dueDate}{task.dueTime?' · '+task.dueTime:''}</span>}{source&&<button className="source-link" onClick={()=>onOpenRecord(source.id)}>{source.title}<ArrowUpRight size={12}/></button>}</div>{event&&task.notes&&<p className="planner-note">{task.notes}</p>}
   </div>
   <details className="planner-menu" onClick={event=>{if((event.target as Element).closest('button'))event.currentTarget.open=false;}}><summary aria-label={t('事项操作：{0}',task.title)} title={t('事项操作')}><MoreHorizontal size={18}/></summary><div>{!event&&<button disabled={busy} onClick={()=>void onUpdate({...task,priority:task.priority==='high'?'normal':'high',updatedAt:new Date().toISOString()},task.updatedAt)}>{t(task.priority==='high'?'取消重要':'标为重要')}</button>}<button className="delete-button" disabled={busy} aria-label={t(event?'删除行程：{0}':'删除任务：{0}',task.title)} onClick={()=>onDelete(task)}>{t('移入回收站')}</button></div></details>
  </article>;
 }
 function eventGroups(values:Task[]){const groups=new Map<string,Task[]>();for(const event of values){const date=event.eventDate??today;groups.set(date,[...(groups.get(date)??[]),event]);}return [...groups].map(([date,items])=><section key={date} className="planner-group"><h2>{date===today?t('今天'):date}<span>{items.length}</span></h2>{items.map(row)}</section>);}
 return <section ref={root} hidden={!active} className="tasks-panel planner-panel" aria-label={t('日程事项')}>
  <nav role="tablist" aria-label={t('日程视图')} className="planner-tabs">{(['task','event'] as const).map(kind=><button role="tab" key={kind} aria-selected={tab===kind} onClick={()=>setTab(kind)}>{t(kind==='task'?'待办':'行程')}</button>)}</nav>
  <form className="planner-form" onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={event=>{if(event.key==='Enter'&&(event.nativeEvent.isComposing||composing.current))event.preventDefault();}} onSubmit={async event=>{event.preventDefault();if(busy||composing.current||!draft.title.trim())return;setError('');try{if(await onAdd(buildPlannerTask(draft,tab)))update({title:'',notes:'',location:''});}catch(error){setError(t(error instanceof Error&&error.message.includes('结束')?'结束时间不能早于开始时间':'请检查事项名称、日期和时间。'));}}}>
   <div className="planner-create-row"><label className="sr-only" htmlFor="planner-title">{t(tab==='task'?'新任务名称':'行程名称')}</label><input id="planner-title" aria-label={t(tab==='task'?'新任务名称':'行程名称')} placeholder={t(tab==='task'?'记下一件要做的事…':'安排一段时间…')} value={draft.title} maxLength={200} disabled={busy} onChange={event=>update({title:event.target.value})}/><button data-floating-avoid className="button primary" aria-label={t(tab==='task'?'添加任务':'添加行程')} disabled={busy||!draft.title.trim()}><Plus size={16}/>{t('添加')}</button></div>
   <div className="planner-create-fields"><PlannerFields kind={tab} draft={draft} update={update} disabled={busy}/></div>{error&&<p className="planner-error" role="alert">{error}</p>}
  </form>
  {editing&&<PlannerEdit task={editing} onSave={onUpdate} onClose={()=>setEditing(null)}/>}
  {tab==='task'?<><div className="planner-count">{t('待完成 ')}{pending.length}</div>{(['逾期','今天','之后','未定日期'] as const).map(group=>{const items=pending.filter(task=>taskGroup(task,now)===group);return items.length>0&&<section className="planner-group" key={group}><h2>{t(group)}<span>{items.length}</span></h2>{items.map(row)}</section>;})}{!pending.length&&<p className="planner-empty">{t(query?'没有匹配的待办任务。':'暂时没有待办。')}</p>}{done.length>0&&<section className="planner-done"><button className="done-toggle" aria-expanded={showDone} onClick={()=>setShowDone(!showDone)}>{t(showDone?'收起':'展开')}{t('已完成 · ')}{done.length}</button><CleanupHint/>{showDone&&done.map(row)}</section>}</>:<>{eventGroups(future)}{!future.length&&<p className="planner-empty">{t(query?'没有匹配的行程。':'暂时没有行程。')}</p>}{past.length>0&&<section className="planner-done"><button className="done-toggle" aria-expanded={showPast} onClick={()=>setShowPast(!showPast)}>{t(showPast?'收起往期':'往期行程')}{' · '+past.length}</button>{showPast&&eventGroups(past)}</section>}</>}
 </section>;
}

