import {useState,useEffect,useRef,useId} from 'react';
import {creationProposalSchema} from '../domain/creation';
import type {CreationActions,CreationBatch,CreationProposal,CreationItem} from '../domain/creation';
import {useI18n} from '../i18n';

export default function CreationPreview({proposal,requestId,actions,disabled,onApplied,initialBatch,initialSelected,onDraftChange}:{proposal:CreationProposal;requestId:string;actions:CreationActions;disabled:boolean;onApplied:(batch:CreationBatch|null)=>void;initialBatch?:CreationBatch|null;initialSelected?:boolean[];onDraftChange:(items:CreationItem[],selected:boolean[])=>void}){
 const {t}=useI18n(),id=useId();
 const [items,setItems]=useState(proposal.items),[selected,setSelected]=useState(()=>initialSelected??proposal.items.map(()=>true));
 const [batch,setBatch]=useState<CreationBatch|null>(initialBatch??null),[working,setWorking]=useState(false),[error,setError]=useState(''),[undone,setUndone]=useState(initialBatch===null);
 const [fieldErrors,setFieldErrors]=useState<Record<string,string>>({}),preview=useRef<HTMLElement>(null),failure=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{const frame=requestAnimationFrame(()=>preview.current?.scrollIntoView({block:'start'}));return()=>cancelAnimationFrame(frame);},[]);
 useEffect(()=>{
  const key=Object.keys(fieldErrors)[0];if(!key&&!error)return;
  const frame=requestAnimationFrame(()=>{
   const field=key?preview.current?.querySelector<HTMLInputElement|HTMLTextAreaElement>(`[data-creation-field="${key}"]`):null;
   if(field){const details=field.closest('details');if(details)details.open=true;field.focus({preventScroll:true});field.scrollIntoView({block:'center'});}
   else failure.current?.scrollIntoView({block:'nearest'});
  });return()=>cancelAnimationFrame(frame);
 },[fieldErrors,error]);
 function patch(index:number,update:Partial<CreationItem>){
  const item=items[index];
  if(item.kind==='task'&&update.date===null)update={...update,time:null};
  if(item.kind==='event'&&update.time===null)update={...update,endTime:null};
  const next=items.map((item,i)=>i===index?{...item,...update}:item);setItems(next);onDraftChange(next,selected);setFieldErrors({});setError('');
 }
 async function create(){
  if(working||disabled||batch||undone)return;
  const indexes=items.flatMap((_,i)=>selected[i]?[i]:[]),parsed=creationProposalSchema.safeParse({items:indexes.map(i=>items[i])});
  if(!parsed.success){
   const errors:Record<string,string>={};
   for(const issue of parsed.error.issues){const index=indexes[Number(issue.path[1])],field=String(issue.path[2]??'title');if(index===undefined)continue;
    const message=issue.code==='custom'?issue.message:field==='title'?'请填写名称。':field==='body'?'正文过长，请缩短后再创建。':/date/i.test(field)?'请确认日期。':/time/i.test(field)?'请确认时间。':'请检查此项内容。';
    errors[`${index}:${field}`]??=message;
   }
   setFieldErrors(errors);setError('请检查标出的字段。');return;
  }
  setWorking(true);setError('');setFieldErrors({});
  try{const result=await actions.create(requestId,parsed.data.items);setBatch(result);onApplied(result);}
  catch(error){setError(error instanceof Error?error.message:String(error));}finally{setWorking(false);}
 }
 async function undo(){if(!batch||working)return;setWorking(true);setError('');try{await actions.undo(batch);setUndone(true);onApplied(null);}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setWorking(false);}}
 const attrs=(index:number,field:string)=>({'data-creation-field':`${index}:${field}`,'aria-invalid':fieldErrors[`${index}:${field}`]?true:undefined,'aria-describedby':fieldErrors[`${index}:${field}`]?`${id}-${index}-${field}`:undefined});
 const hint=(index:number,field:string)=>fieldErrors[`${index}:${field}`]?<span className="creation-field-error" id={`${id}-${index}-${field}`}>{t(fieldErrors[`${index}:${field}`])}</span>:null;
 return <section ref={preview} className="creation-preview" aria-label={t('创建预览')}>
  <div className="creation-heading"><strong>{t(batch?'已创建{0}项':'创建预览 · {0}项',batch?batch.records.length+batch.tasks.length:items.length)}</strong></div>
  {!batch&&!undone&&<><p className="creation-hint">{t('可修改或取消勾选，确认后加入鲸笺。')}</p>{items.map((item,index)=><div className="creation-item" key={index}>
   <label className="creation-select"><input type="checkbox" aria-label={t('创建此项：{0}',item.title)} checked={selected[index]} disabled={working||disabled} onChange={event=>{const next=selected.map((value,i)=>i===index?event.target.checked:value);setSelected(next);setFieldErrors({});setError('');onDraftChange(items,next);}}/><span>{t(item.kind==='note'?'随记':item.kind==='task'?'待办':'行程')}</span></label>
   <details open={items.length===1}><summary>{item.title}{item.date&&<time>{item.date}{item.time?' '+item.time:''}</time>}</summary><div className="creation-fields">
    <label>{t('名称')}<input {...attrs(index,'title')} aria-label={t('草案名称：{0}',index+1)} value={item.title} maxLength={200} disabled={working||disabled} onChange={event=>patch(index,{title:event.target.value})}/>{hint(index,'title')}</label>
    {item.kind==='note'?<label>{t('正文')}<textarea {...attrs(index,'body')} aria-label={t('草案正文：{0}',index+1)} value={item.body} maxLength={20000} disabled={working||disabled} onChange={event=>patch(index,{body:event.target.value})}/>{hint(index,'body')}</label>:<>
     <label>{t(item.kind==='event'?'行程日期':'截止日期（可选）')}<input {...attrs(index,'date')} type="date" aria-label={t('草案日期：{0}',index+1)} value={item.date??''} disabled={working||disabled} onChange={event=>patch(index,{date:event.target.value||null})}/>{hint(index,'date')}</label>
     {(item.kind==='event'||item.date)&&<label>{t(item.kind==='event'?'开始时间（可选）':'截止时间')}<input {...attrs(index,'time')} type="time" aria-label={t('草案时间：{0}',index+1)} value={item.time??''} disabled={working||disabled} onChange={event=>patch(index,{time:event.target.value||null})}/>{hint(index,'time')}</label>}
     {item.kind==='event'&&<><label>{t('结束日期（可选）')}<input {...attrs(index,'endDate')} aria-label={t('草案结束日期：{0}',index+1)} type="date" value={item.endDate??''} disabled={working||disabled} onChange={event=>patch(index,{endDate:event.target.value||null})}/>{hint(index,'endDate')}</label><label>{t('结束时间（可选）')}<input {...attrs(index,'endTime')} aria-label={t('草案结束时间：{0}',index+1)} type="time" value={item.endTime??''} disabled={working||disabled} onChange={event=>patch(index,{endTime:event.target.value||null})}/>{hint(index,'endTime')}</label></>}
     <label>{t('地点（可选）')}<input {...attrs(index,'location')} value={item.location} disabled={working||disabled} maxLength={200} onChange={event=>patch(index,{location:event.target.value})}/>{hint(index,'location')}</label><label>{t('备注（可选）')}<textarea {...attrs(index,'notes')} value={item.notes} disabled={working||disabled} maxLength={4000} onChange={event=>patch(index,{notes:event.target.value})}/>{hint(index,'notes')}</label>
    </>}
   </div></details>
  </div>)}<button data-floating-avoid className="button primary" disabled={disabled||working||!selected.some(Boolean)} onClick={()=>void create()}>{t(working?'正在创建…':'确认创建{0}项',selected.filter(Boolean).length)}</button></>}
  {batch&&!undone&&<><p role="status">{t('已加入鲸笺。')}</p><div className="creation-result-actions">{batch.tasks.length>0&&<button className="text-button" onClick={actions.showPlanner}>{t('查看日程')}</button>}{batch.records.length>0&&<button className="text-button" onClick={()=>actions.showRecord(batch.records[0])}>{t('查看随记')}</button>}<button className="text-button" disabled={working||disabled} onClick={()=>void undo()}>{t('撤销本次创建')}</button></div></>}
  {undone&&<p role="status">{t('已撤销，可从回收站恢复。')}</p>}{error&&<p ref={failure} className="save-error" role="alert">{t(error)}</p>}
 </section>;
}
