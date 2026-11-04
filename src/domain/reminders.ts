import type {Task} from './models';
export type ReminderNotice={taskId:string;title:string;dueAt:number;sentAt:number};
export function taskDeadline(task:Task):number|null{if(task.kind!=='task'||!task.dueDate)return null;const value=new Date(task.dueDate+'T'+(task.dueTime??'23:59')).getTime();return Number.isFinite(value)?value:null;}
export function isTaskOverdue(task:Task,now=Date.now()):boolean{const due=taskDeadline(task);return task.status==='todo'&&due!==null&&due<=now;}
export function reminderSlots(due:number,now=Date.now()):number[]{if(due<=now)return [];const left=due-now,first=due-Math.min(6*3600000,left/2),second=due-Math.min(3600000,left/5);return second-first<60000?[first]:[first,second];}
export function remainingText(due:number,now=Date.now(),language='zh'):string{const amount=Math.ceil(Math.abs(due-now)/60000),hours=Math.floor(amount/60),minutes=amount%60;return language==='en'?`${due<=now?'Overdue by':'Due in'} ${hours?hours+'h ':''}${minutes}m`:`${due<=now?'已逾期':'还剩'}${hours?hours+'小时':''}${minutes}分`;}
