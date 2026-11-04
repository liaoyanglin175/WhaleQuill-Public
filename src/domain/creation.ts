import {z} from 'zod';
import {createRecord,createTask,recordSchema,taskSchema} from './models';
import type {NoteRecord,Task} from './models';
export const creationItemSchema=z.object({kind:z.enum(['note','task','event']),title:z.string().trim().min(1).max(200),body:z.string().max(20000).default(''),date:z.iso.date().nullable().default(null),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),endDate:z.iso.date().nullable().default(null),endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),location:z.string().max(200).default(''),notes:z.string().max(4000).default('')}).strict().superRefine((item,c)=>{
 if(item.kind==='event'&&!item.date)c.addIssue({code:'custom',message:'请确认行程日期',path:['date']});
 if(item.kind==='task'&&item.time&&!item.date)c.addIssue({code:'custom',message:'请先选择截止日期',path:['date']});
 if(item.kind==='event'&&item.endTime&&!item.time)c.addIssue({code:'custom',message:'请先设置开始时间',path:['time']});
 if(item.kind==='event'&&item.date&&`${item.endDate??item.date}T${item.endTime??item.time??'23:59'}`<`${item.date}T${item.time??'00:00'}`)c.addIssue({code:'custom',message:'结束时间不能早于开始时间',path:[item.endDate&&item.endDate<item.date?'endDate':'endTime']});
 if(item.kind!=='event'&&(item.endDate||item.endTime))c.addIssue({code:'custom',message:'只有行程可设置结束时间'});
});
export const creationProposalSchema=z.object({items:z.array(creationItemSchema).min(1).max(20)}).strict();
export type CreationItem=z.infer<typeof creationItemSchema>;
export type CreationProposal=z.infer<typeof creationProposalSchema>;
export type CreationBatch={requestId:string;createdAt:string;records:NoteRecord[];tasks:Task[];undone:boolean};
export type CreationActions={create:(requestId:string,items:CreationItem[])=>Promise<CreationBatch>;undo:(batch:CreationBatch)=>Promise<void>;showPlanner:()=>void;showRecord:(record:NoteRecord)=>void};
export function creationIntent(text:string):boolean{return /创建|新建|记下|帮.{0,12}(安排|记录|写|规划)|安排行程|制定.{0,8}(计划|行程)|添加.{0,8}(任务|待办)|\b(create|schedule|plan).{0,30}\b(note|task|event|trip|itinerary)\b/i.test(text);}
export function materializeCreation(requestId:string,input:CreationItem[],now=new Date().toISOString()):CreationBatch{
 z.string().uuid().parse(requestId);const {items}=creationProposalSchema.parse({items:input});
 const records:NoteRecord[]=[],tasks:Task[]=[];
 for(const item of items){if(item.kind==='note'){records.push(recordSchema.parse({...createRecord(),title:item.title,body:item.body,createdAt:now,updatedAt:now}));}else{
  tasks.push(taskSchema.parse({...createTask(item.title),kind:item.kind==='event'?'event':'task',dueDate:item.kind==='task'?item.date:null,dueTime:item.kind==='task'&&item.date?item.time??'23:59':null,eventDate:item.kind==='event'?item.date:null,startTime:item.kind==='event'?item.time:null,endDate:item.endDate,endTime:item.endTime,location:item.location,notes:item.notes,createdAt:now,updatedAt:now}));
 }}return {requestId,createdAt:now,records,tasks,undone:false};
}
