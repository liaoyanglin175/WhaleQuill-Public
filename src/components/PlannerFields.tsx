import {useId} from 'react';
import {useI18n} from '../i18n';
import type {PlannerDraft} from '../domain/planner-draft';
import {reminderSlots} from '../domain/reminders';
export default function PlannerFields({draft,update,disabled,kind,editing=false}:{draft:PlannerDraft;update:(patch:Partial<PlannerDraft>)=>void;disabled:boolean;kind:'task'|'event';editing?:boolean}){
 const {t}=useI18n(),id=useId();
 return <>
  <label className={editing?'planner-date-field':'planner-date-field is-inline'}><span>{t(kind==='event'?'行程日期':editing?'截止日期（可选）':'日期（可选）')}</span><input id={id+'date'} type="date" aria-label={t(kind==='event'?'行程日期':editing?'截止日期（可选）':'任务截止日期')} value={draft.date} required={kind==='event'} disabled={disabled} onChange={event=>update({date:event.target.value})}/></label>
  {kind==='task'&&draft.date&&<label className="planner-date-field is-inline"><span>{t('截止时间')}</span><input type="time" aria-label={t('截止时间')} value={draft.dueTime} disabled={disabled} onChange={event=>update({dueTime:event.target.value})}/></label>}
  {kind==='task'&&draft.date&&draft.dueTime&&<small className="planner-reminder-preview">{t('预计提醒：{0}',reminderSlots(new Date(draft.date+'T'+draft.dueTime).getTime()).map(time=>new Date(time).toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit',hour12:false})).join(' / ')||'—')}</small>}
  {kind==='event'&&<><label className="planner-all-day"><input type="checkbox" checked={draft.allDay} disabled={disabled} onChange={event=>update({allDay:event.target.checked})}/>{t('全天')}</label>
   {!draft.allDay&&<div className="planner-times"><label>{t('开始时间')}<input type="time" aria-label={t('开始时间')} value={draft.startTime} required disabled={disabled} onChange={event=>update({startTime:event.target.value})}/></label><label>{t('结束时间（可选）')}<input type="time" aria-label={t('结束时间（可选）')} value={draft.endTime} disabled={disabled} onChange={event=>update({endTime:event.target.value})}/></label></div>}
   <details className="planner-details" open={editing?true:undefined}><summary>{t('地点与更多信息')}</summary><div><label>{t('结束日期（可选）')}<input type="date" aria-label={t('结束日期（可选）')} value={draft.endDate} min={draft.date} disabled={disabled} onChange={event=>update({endDate:event.target.value})}/></label><label>{t('地点（可选）')}<input value={draft.location} maxLength={200} aria-label={t('地点（可选）')} disabled={disabled} onChange={event=>update({location:event.target.value})}/></label><label>{t('备注（可选）')}<textarea value={draft.notes} maxLength={4000} aria-label={t('备注（可选）')} disabled={disabled} onChange={event=>update({notes:event.target.value})}/></label></div></details>
  </>}
 </>;
}
