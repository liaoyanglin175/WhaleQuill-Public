import {createTask,taskSchema} from './models';
import type {Task} from './models';
import {plannerDay} from './planner';
export type PlannerDraft={title:string;date:string;dueTime:string;allDay:boolean;startTime:string;endDate:string;endTime:string;location:string;notes:string};
export function blankPlannerDraft():PlannerDraft{return {title:'',date:plannerDay(),dueTime:'23:59',allDay:true,startTime:'',endDate:'',endTime:'',location:'',notes:''};}
export function plannerDraft(task:Task):PlannerDraft{return {title:task.title,date:task.kind==='event'?task.eventDate??plannerDay():task.dueDate??'',dueTime:task.dueTime??'23:59',allDay:!task.startTime,startTime:task.startTime??'',endDate:task.endDate??'',endTime:task.endTime??'',location:task.location,notes:task.notes};}
export function buildPlannerTask(draft:PlannerDraft,kind:'task'|'event',original?:Task):Task{
 if(kind==='event'&&!draft.allDay&&!draft.startTime)throw new Error('请设置开始时间');
 const base=original??createTask(draft.title);
 return taskSchema.parse({...base,title:draft.title,kind,updatedAt:new Date().toISOString(),dueDate:kind==='task'?draft.date||null:null,dueTime:kind==='task'&&draft.date?draft.dueTime||'23:59':null,eventDate:kind==='event'?draft.date||null:null,startTime:kind==='event'&&!draft.allDay?draft.startTime||null:null,endDate:kind==='event'?draft.endDate||null:null,endTime:kind==='event'&&!draft.allDay?draft.endTime||null:null,location:draft.location,notes:draft.notes});
}
