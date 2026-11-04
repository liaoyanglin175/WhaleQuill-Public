import {taskSchema} from './models';
import type {Task} from './models';
import {isTaskOverdue} from './reminders';

export const plannerDay=(date=new Date())=>date.toLocaleDateString('sv-SE');
export function nextPlannerDay(now=new Date()):string{return plannerDay(new Date(now.getFullYear(),now.getMonth(),now.getDate()+1));}

export function completion(task:Task,previous:Task|undefined,now=new Date()):Task {
  if(task.kind==='event'||task.status==='todo')return {...task,completedAt:null,cleanupOn:null};
  if(previous?.status==='done'&&previous.kind==='task')return {...task,completedAt:previous.completedAt,cleanupOn:previous.cleanupOn??nextPlannerDay(now)};
  return {...task,completedAt:now.toISOString(),cleanupOn:nextPlannerDay(now)};
}
export function importedTask(task:Task,now=new Date()):Task {
  const parsed=taskSchema.parse(task);
  return parsed.kind==='task'&&parsed.status==='done'&&!parsed.cleanupOn?{...parsed,cleanupOn:nextPlannerDay(now)}:parsed;
}
export function cleanupDue(task:Task,day:string):boolean{return task.kind==='task'&&task.status==='done'&&!!task.cleanupOn&&task.cleanupOn<=day;}
export function isTodayEvent(task:Task,day=plannerDay()):boolean{return task.kind==='event'&&!!task.eventDate&&task.eventDate<=day&&(task.endDate??task.eventDate)>=day;}
export function eventOrder(a:Task,b:Task):number{return (a.eventDate??'').localeCompare(b.eventDate??'')||(a.startTime??'').localeCompare(b.startTime??'')||a.createdAt.localeCompare(b.createdAt);}
export function eventTime(task:Task):string{
  if(!task.startTime)return '全天';
  return task.startTime+(task.endTime?`–${task.endDate&&task.endDate!==task.eventDate?task.endDate+' ':''}${task.endTime}`:'');
}
export function taskGroup(task:Task,now=Date.now()):'逾期'|'今天'|'之后'|'未定日期'{return !task.dueDate?'未定日期':isTaskOverdue(task,now)?'逾期':task.dueDate===plannerDay(new Date(now))?'今天':'之后';}

const key='jingjian-task-cleanup';
export function cleanupEnabled():boolean{try{return localStorage.getItem(key)!=='off';}catch{return true;}}
export function setCleanupEnabled(enabled:boolean){localStorage.setItem(key,enabled?'trash':'off');window.dispatchEvent(new Event('jingjian-cleanup-setting'));}
