import {useEffect,useRef,useState} from 'react';
import type {Task} from '../domain/models';
import {plannerDraft,buildPlannerTask} from '../domain/planner-draft';
import {useI18n} from '../i18n';
import PlannerFields from './PlannerFields';
export default function PlannerEdit({task,onSave,onClose}:{task:Task;onSave:(task:Task,expectedUpdatedAt?:string)=>Promise<boolean>;onClose:()=>void}){
 const {t}=useI18n(),dialog=useRef<HTMLDialogElement>(null),[draft,setDraft]=useState(()=>plannerDraft(task)),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} className="confirm-dialog task-composer planner-edit" aria-label={t(task.kind==='event'?'编辑行程':'编辑任务')} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><h2>{t(task.kind==='event'?'编辑行程':'编辑任务')}</h2>
  <form onSubmit={async event=>{event.preventDefault();if(busy||!draft.title.trim())return;setBusy(true);setError('');try{if(await onSave(buildPlannerTask(draft,task.kind,task),task.updatedAt))onClose();else setError(t('未能保存任务，请关闭后重新编辑。'));}catch(error){setError(t(error instanceof Error&&error.message.includes('结束')?'结束时间不能早于开始时间':'请检查事项名称、日期和时间。'));}finally{setBusy(false);}}}>
   <label className="task-name-label" htmlFor="edit-task-title">{t(task.kind==='event'?'行程名称':'任务名称')}</label><input id="edit-task-title" autoFocus value={draft.title} maxLength={200} disabled={busy} onChange={event=>setDraft(current=>({...current,title:event.target.value}))}/>
   <PlannerFields draft={draft} update={patch=>setDraft(current=>({...current,...patch}))} disabled={busy} kind={task.kind} editing/>
   {error&&<p role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={busy||!draft.title.trim()}>{t(task.kind==='event'?'保存行程':'保存任务')}</button></div>
  </form>
 </dialog>;
}
