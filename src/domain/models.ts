import { z } from 'zod';
import {richDocumentSchema,documentText,hasNewFormatting} from './rich-document';
import {documentTags} from './inline-tags';
import {tagKey} from './tags';

export const recordTypes = ['note', 'work', 'diary'] as const;
export type RecordType = (typeof recordTypes)[number];
export const recordTypeNames: Record<RecordType, string> = {
  note: '普通笔记', work: '工作记录', diary: '生活日记',
};

const timestamp = z.string().datetime({ offset: true });
const identity = z.string().uuid();

export const highlightSchema = z.object({
  id: identity,
  start: z.number().int().min(0).max(1_000_000),
  end: z.number().int().min(1).max(1_000_000),
  text: z.string().min(1).max(4000),
  createdAt: timestamp,
  stale: z.boolean().default(false),
});
export type Highlight = z.infer<typeof highlightSchema>;

export const recordSchema = z.object({
  id: identity,
  title: z.string().trim().min(1, '请填写标题').max(200),
  body: z.string().max(1_000_000),
  document:richDocumentSchema.nullable().default(null),
  recordType: z.enum(recordTypes),
  tags: z.array(z.string().trim().min(1).max(40)).max(20),
  highlights: z.array(highlightSchema).max(200).default([]),
  createdAt: timestamp,
  updatedAt: timestamp,
}).superRefine((record, context) => {
  if(record.document&&documentText(record.document)!==record.body)context.addIssue({code:'custom',path:['document'],message:'排版文档与正文不一致'});
  for(const name of documentTags(record.document))if(!record.tags.some(tag=>tagKey(tag)===tagKey(name)))context.addIssue({code:'custom',path:['tags'],message:'正文标签与关联记录索引不一致'});
  const ids = new Set<string>();
  record.highlights.forEach((highlight, index) => {
    if (ids.has(highlight.id) || highlight.end <= highlight.start || highlight.end - highlight.start !== highlight.text.length || (!highlight.stale && record.body.slice(highlight.start, highlight.end) !== highlight.text)) {
      context.addIssue({ code: 'custom', path: ['highlights', index], message: '重点与原文不一致，请重新划重点' });
    }
    ids.add(highlight.id);
  });
});
export type NoteRecord = z.infer<typeof recordSchema>;

export const taskSchema = z.object({
  id: identity,
  title: z.string().trim().min(1, '请填写任务名称').max(200),
  status: z.enum(['todo', 'done']),
  priority: z.enum(['normal', 'high']),
  dueDate: z.iso.date().nullable(),
  dueTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  sourceRecordId: identity.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  kind:z.enum(['task','event']).default('task'),
  eventDate:z.iso.date().nullable().default(null),
  startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  endDate:z.iso.date().nullable().default(null),
  endTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().default(null),
  location:z.string().trim().max(200).default(''),
  notes:z.string().max(4000).default(''),
  completedAt:timestamp.nullable().default(null),
  cleanupOn:z.iso.date().nullable().default(null),
}).superRefine((task,context)=>{
  const error=(message:string)=>context.addIssue({code:'custom',message});
  if(task.kind==='event'){
    if(!task.eventDate)error('请选择行程日期');
    if(task.status!=='todo'||task.completedAt||task.cleanupOn||task.dueDate||task.dueTime)error('行程不能标记为待办完成');
    if(task.endTime&&!task.startTime)error('请先设置开始时间');
    if(task.eventDate&&`${task.endDate??task.eventDate}T${task.endTime??task.startTime??'23:59'}`<`${task.eventDate}T${task.startTime??'00:00'}`)error('结束时间不能早于开始时间');
  }else{
    if(task.dueTime&&!task.dueDate)error('请先选择截止日期');
    if(task.eventDate||task.startTime||task.endDate||task.endTime)error('待办与行程时间不一致');
    if(task.status==='todo'&&(task.completedAt||task.cleanupOn))error('未完成待办不能带有清理计划');
  }
});
export type Task = z.infer<typeof taskSchema>;

export const trashEntrySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('record'), deletedAt: timestamp, record: recordSchema }),
  z.object({ kind: z.literal('task'), deletedAt: timestamp, task: taskSchema }),
]);
export type TrashEntry = z.infer<typeof trashEntrySchema>;

export const workspaceSchema = z.object({
  records: z.array(recordSchema).max(50_000),
  tasks: z.array(taskSchema).max(50_000),
}).superRefine((workspace, context) => {
  const recordIds = new Set(workspace.records.map((record) => record.id));
  const taskIds = new Set(workspace.tasks.map((task) => task.id));
  if (recordIds.size !== workspace.records.length || taskIds.size !== workspace.tasks.length) {
    context.addIssue({ code: 'custom', message: '备份中含有重复 ID' });
  }
  workspace.tasks.forEach((task, index) => {
    if (task.sourceRecordId && !recordIds.has(task.sourceRecordId)) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'sourceRecordId'], message: '任务引用的来源记录不存在' });
    }
  });
});
export type Workspace = z.infer<typeof workspaceSchema>;

export const fullSnapshotSchema = z.object({
  records: z.array(recordSchema.safeExtend({ deletedAt: timestamp.nullable() })).max(50_000),
  tasks: z.array(taskSchema.safeExtend({ deletedAt: timestamp.nullable() })).max(50_000),
}).superRefine((snapshot, context) => {
  const records = new Set(snapshot.records.map((record) => record.id));
  const tasks = new Set(snapshot.tasks.map((task) => task.id));
  if (records.size !== snapshot.records.length || tasks.size !== snapshot.tasks.length) context.addIssue({ code: 'custom', message: '备份中含有重复 ID' });
  snapshot.tasks.forEach((task) => {
    if (task.sourceRecordId && !records.has(task.sourceRecordId)) context.addIssue({ code: 'custom', message: '任务引用的来源记录不存在于完整备份中' });
  });
});
export type FullSnapshot = z.infer<typeof fullSnapshotSchema>;

const legacyArchiveSchema = z.object({
  application: z.literal('dafeiyu-notebook'),
  version: z.literal(1),
  exportedAt: timestamp,
  workspace: workspaceSchema,
});
const completeArchiveSchema = z.object({
  application: z.literal('dafeiyu-notebook'), version: z.literal(2), exportedAt: timestamp, snapshot: fullSnapshotSchema,
});
const memoryArchiveSchema = completeArchiveSchema.extend({ version: z.literal(3) });
const richArchiveSchema=completeArchiveSchema.extend({version:z.literal(4)});
const inlineArchiveSchema=completeArchiveSchema.extend({version:z.literal(5)});
const plannerArchiveSchema=completeArchiveSchema.extend({version:z.literal(6)});
const reminderArchiveSchema=completeArchiveSchema.extend({version:z.literal(7)});
export const archiveSchema = z.discriminatedUnion('version', [legacyArchiveSchema, completeArchiveSchema, memoryArchiveSchema,richArchiveSchema,inlineArchiveSchema,plannerArchiveSchema,reminderArchiveSchema]);
export type Archive = z.infer<typeof archiveSchema>;

export function createRecord(recordType: RecordType = 'note'): NoteRecord {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), title: '未命名记录', body: '', document:null, recordType, tags: [], highlights: [], createdAt: now, updatedAt: now };
}

export function createTask(title: string, dueDate: string | null = null, sourceRecordId: string | null = null): Task {
  const now = new Date().toISOString();
  return taskSchema.parse({ id: crypto.randomUUID(), title, status: 'todo', priority: 'normal', dueDate, sourceRecordId, createdAt: now, updatedAt: now });
}

export function encodeArchive(workspace: Workspace): string {
  if(workspace.tasks.some(task=>hasPlannerData(task)||task.dueTime))return encodeCompleteArchive({records:workspace.records.map(record=>({...record,deletedAt:null})),tasks:workspace.tasks.map(task=>({...task,deletedAt:null}))});
  return JSON.stringify(legacyArchiveSchema.parse({ application: 'dafeiyu-notebook', version: 1, exportedAt: new Date().toISOString(), workspace }), null, 2);
}

export function encodeCompleteArchive(snapshot: FullSnapshot): string {
  const version=snapshot.tasks.some(task=>task.dueTime)?7:snapshot.tasks.some(hasPlannerData)?6:snapshot.records.some(record=>hasNewFormatting(record.document))?5:snapshot.records.some(record=>record.document)?4:3;
  const schema=version===7?reminderArchiveSchema:version===6?plannerArchiveSchema:version===5?inlineArchiveSchema:version===4?richArchiveSchema:memoryArchiveSchema;
  const text = JSON.stringify(schema.parse({ application: 'dafeiyu-notebook', version, exportedAt: new Date().toISOString(), snapshot }), null, 2);
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('完整备份超过当前 20 MB 上限，请先分篇导出内容');
  return text;
}

function hasPlannerData(task:Task):boolean {return task.kind==='event'||!!(task.completedAt||task.cleanupOn||task.location||task.notes);}

export function decodeArchive(text: string): Archive {
  if (new TextEncoder().encode(text).byteLength > 20 * 1024 * 1024) throw new Error('备份文件不能超过 20 MB');
  try { return archiveSchema.parse(JSON.parse(text)); }
  catch (error) {
    if (error instanceof z.ZodError) throw new Error(`备份格式不正确：${error.issues[0]?.message ?? '校验失败'}`);
    throw new Error('无法读取 JSON 备份文件');
  }
}

export function matchesQuery(record: NoteRecord, query: string): boolean {
  const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = [record.title, record.body, ...record.tags].join('\n').normalize('NFKC').toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function recordTitle(record: Pick<NoteRecord, 'title' | 'body'>): string {
  const title = record.title.trim();
  return title && title !== '未命名记录' ? title : Array.from(record.body.trim().split(/\r?\n/, 1)[0].replace(/^[#>*-]+\s*/, '').slice(0,120)).slice(0, 60).join('').trim() || '未命名记录';
}
