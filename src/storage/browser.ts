import {initializeTrash,maintainTrash,trashInfo,previewTrash,updateTrash} from './browser-trash';
import {allowImportedRecovery} from './recovery';
import {retentionKey} from '../domain/trash-retention';
import type {RetentionDays,TrashRetentionInfo,TrashPolicy} from '../domain/trash-retention';
import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import { fullSnapshotSchema, recordSchema, taskSchema, workspaceSchema } from '../domain/models';
import type { FullSnapshot, NoteRecord, Task, TrashEntry, Workspace } from '../domain/models';
import type { NotebookRepository } from './repository';
import {cleanupDue,cleanupEnabled,completion,importedTask,plannerDay} from '../domain/planner';
import {materializeCreation,creationProposalSchema} from '../domain/creation';
import type {CreationItem,CreationBatch} from '../domain/creation';

export interface NotebookDatabase extends DBSchema {
  trashPolicy:{key:string;value:TrashPolicy&{id:string}};
  trashStarts:{key:string;value:{id:string;startedAt:string}};
  purgedItems:{key:string;value:{id:string;kind:"record"|"task";itemId:string}};
  creationBatches:{key:string;value:CreationBatch&{proposal:string;purged?:boolean}};
  records: { key: string; value: NoteRecord & { deletedAt?: string | null } };
  tasks: { key: string; value: Task & { deletedAt?: string | null } };
}

export class BrowserRepository implements NotebookRepository {
  readonly mode = 'browser' as const;
  private database: Promise<IDBPDatabase<NotebookDatabase>>;

  constructor(name = 'dafeiyu-notebook-v1') {
    this.database = openDB<NotebookDatabase>(name, 6, {
      upgrade(db,oldVersion) {
        if(oldVersion<1){db.createObjectStore('records', { keyPath: 'id' });db.createObjectStore('tasks', { keyPath: 'id' });}
        if(oldVersion<5)db.createObjectStore('creationBatches',{keyPath:'requestId'});
        if(oldVersion<6)for(const name of ['trashPolicy','trashStarts','purgedItems'] as const)db.createObjectStore(name,{keyPath:'id'});
      },
    }).then(async db=>{await initializeTrash(db);return db;});
  }

  async load(): Promise<Workspace> {
    await this.maintainTasks();
    const db = await this.database;
    const tx = db.transaction(['records', 'tasks'], 'readonly');
    const [records, tasks] = await Promise.all([tx.objectStore('records').getAll(), tx.objectStore('tasks').getAll()]);
    await tx.done;
    const visibleRecords = records.filter((record) => !record.deletedAt);
    const ids = new Set(visibleRecords.map((record) => record.id));
    return workspaceSchema.parse({ records: visibleRecords, tasks: tasks.filter((task) => !task.deletedAt).map((task) => ({ ...task, sourceRecordId: task.sourceRecordId && ids.has(task.sourceRecordId) ? task.sourceRecordId : null })) });
  }

  async commitCreation(requestId:string,items:CreationItem[]):Promise<CreationBatch>{
    const proposal=JSON.stringify(creationProposalSchema.parse({items})),batch=materializeCreation(requestId,items),db=await this.database,tx=db.transaction(['records','tasks','creationBatches'],'readwrite');
    try{const previous=await tx.objectStore('creationBatches').get(requestId);if(previous){await tx.done;if(previous.purged)throw new Error('这次创建包含已永久清理的内容，请重新生成。');if(previous.undone)throw new Error('这次创建已撤销，请重新生成。');if(previous.proposal!==proposal)throw new Error('这次创建已确认，内容与上次不同；请先查看日程或随记。');return previous;}
      for(const record of batch.records)await tx.objectStore('records').add(record);
      for(const task of batch.tasks)await tx.objectStore('tasks').add(task);
      await tx.objectStore('creationBatches').add({...batch,proposal});await tx.done;return batch;
    }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
  }
  async undoCreation(requestId:string):Promise<void>{
    const db=await this.database,tx=db.transaction(['records','tasks','creationBatches'],'readwrite');
    try{const batch=await tx.objectStore('creationBatches').get(requestId);if(!batch)throw new Error('找不到这次创建');if(batch.purged)throw new Error('这次创建包含已永久清理的内容，无法整批撤销。');if(batch.undone){await tx.done;return;}
      for(const group of ['records','tasks'] as const){for(const item of batch[group]){const raw=await tx.objectStore(group).get(item.id);const current=raw&&!raw.deletedAt?(group==='records'?recordSchema.parse(raw):taskSchema.parse(raw)):null;if(JSON.stringify(current)!==JSON.stringify(item))throw new Error('其中内容已修改或删除，未撤销；请到对应页面处理。');}}
      const deletedAt=new Date().toISOString();for(const record of batch.records)await tx.objectStore('records').put({...record,deletedAt});for(const task of batch.tasks)await tx.objectStore('tasks').put({...task,deletedAt});await tx.objectStore('creationBatches').put({...batch,undone:true});await tx.done;
    }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
  }

  async loadTrash(): Promise<TrashEntry[]> {
    await this.maintainTasks();
    const db = await this.database;
    const tx = db.transaction(['records', 'tasks'], 'readonly');
    const [records, tasks] = await Promise.all([tx.objectStore('records').getAll(), tx.objectStore('tasks').getAll()]);
    await tx.done;
    return [
      ...records.filter((r) => r.deletedAt).map((record) => ({ kind: 'record' as const, deletedAt: record.deletedAt!, record: recordSchema.parse(record) })),
      ...tasks.filter((t) => t.deletedAt).map((task) => ({ kind: 'task' as const, deletedAt: task.deletedAt!, task: taskSchema.parse(task) })),
    ].sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  }

  async restore(kind: TrashEntry['kind'], id: string): Promise<void> {
    const db = await this.database;
    const tx = db.transaction(kind === 'record' ? 'records' : 'tasks', 'readwrite');
    const value = await tx.store.get(id);
    if (!value?.deletedAt) { await tx.done; throw new Error('条目已恢复或不存在，未覆盖现有内容'); }
    await tx.store.put(kind==='task'?{...value,status:'todo',completedAt:null,cleanupOn:null,updatedAt:new Date().toISOString(),deletedAt:null}:{ ...value, deletedAt: null });
    await tx.done;
  }

  async saveRecord(record: NoteRecord): Promise<void> {
    const value = recordSchema.parse(record);
    const db = await this.database;
    const tx = db.transaction(['records','purgedItems'], 'readwrite');
    if(await tx.objectStore('purgedItems').get(retentionKey('record',value.id))){await tx.done;throw new Error('原内容已永久清理，请新建后保存。');}
    if ((await tx.objectStore('records').get(value.id))?.deletedAt) { await tx.done; throw new Error('记录已在回收站中，请先恢复'); }
    await tx.objectStore('records').put(value);
    await tx.done;
  }

  async deleteRecord(id: string): Promise<void> {
    const db = await this.database;
    const tx = db.transaction('records', 'readwrite');
    const record = await tx.store.get(id);
    if (record && !record.deletedAt) await tx.store.put({ ...record, deletedAt: new Date().toISOString() });
    await tx.done;
  }

  async saveTask(task: Task, expectedUpdatedAt?:string): Promise<void> {
    const db = await this.database;
    const tx = db.transaction(['records','tasks','purgedItems'], 'readwrite');
    if(await tx.objectStore('purgedItems').get(retentionKey('task',task.id))){await tx.done;throw new Error('原内容已永久清理，请新建后保存。');}
    const existing=await tx.objectStore('tasks').get(task.id);
    const value = taskSchema.parse(completion(task,existing?taskSchema.parse(existing):undefined));
    const source = value.sourceRecordId ? await tx.objectStore('records').get(value.sourceRecordId) : null;
    if (existing?.deletedAt) { await tx.done; throw new Error('任务已在回收站中，请先恢复'); }
    if(expectedUpdatedAt!==undefined&&existing?.updatedAt!==expectedUpdatedAt){await tx.done;throw new Error('任务已变化，请重新打开后编辑');}
    if (value.sourceRecordId && (!source || source.deletedAt)) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new Error('任务的来源记录已不存在');
    }
    await tx.objectStore('tasks').put(value);
    await tx.done;
  }

  async deleteTask(id: string): Promise<void> {
    const db = await this.database;
    const tx = db.transaction('tasks', 'readwrite');
    const task = await tx.store.get(id);
    if (task && !task.deletedAt) await tx.store.put({ ...task, deletedAt: new Date().toISOString() });
    await tx.done;
  }

  async maintainTasks():Promise<boolean>{
    const db=await this.database,tx=db.transaction('tasks','readwrite'),now=new Date(),day=plannerDay(now),enabled=cleanupEnabled();let changed=false;
    const values=await tx.store.getAll();
    for(const raw of values){
      if(raw.deletedAt)continue;
      const parsed=taskSchema.parse(raw),task=importedTask(parsed,now);
      if(enabled&&cleanupDue(task,day)){await tx.store.put({...task,deletedAt:now.toISOString()});changed=true;}
      else if(parsed.cleanupOn!==task.cleanupOn){await tx.store.put(task);changed=true;}
    }
    await tx.done;return await maintainTrash(db)||changed;
  }

  async trashRetentionInfo():Promise<TrashRetentionInfo>{return trashInfo(await this.database);}
  async previewTrashRetention(days:RetentionDays):Promise<number>{return previewTrash(await this.database,days);}
  async setTrashRetention(days:RetentionDays,count:number):Promise<TrashRetentionInfo>{return updateTrash(await this.database,days,count);}

  async mergeWorkspace(workspace: Workspace): Promise<void> {
    const value = workspaceSchema.parse(workspace);
    const db = await this.database;
    const tx = db.transaction(['records','tasks','trashStarts','purgedItems'], 'readwrite');
    try {
      for(const record of value.records){await tx.objectStore('purgedItems').delete(retentionKey('record',record.id));await tx.objectStore('trashStarts').delete(retentionKey('record',record.id));}
      for(const task of value.tasks){await tx.objectStore('purgedItems').delete(retentionKey('task',task.id));await tx.objectStore('trashStarts').delete(retentionKey('task',task.id));}
      for (const record of value.records) await tx.objectStore('records').put(record);
      for (const task of value.tasks) await tx.objectStore('tasks').put(importedTask(task));
      await tx.done;allowImportedRecovery('browser',value.records.map(r=>r.id));
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already have aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }

  async exportSnapshot(): Promise<FullSnapshot> {
    const db = await this.database;
    const tx = db.transaction(['records', 'tasks'], 'readonly');
    const [records, tasks] = await Promise.all([tx.objectStore('records').getAll(), tx.objectStore('tasks').getAll()]);
    await tx.done;
    return fullSnapshotSchema.parse({ records: records.map((record) => ({ ...record, deletedAt: record.deletedAt ?? null })), tasks: tasks.map((task) => ({ ...task, deletedAt: task.deletedAt ?? null })) });
  }

  async mergeSnapshot(snapshot: FullSnapshot): Promise<void> {
    const value = fullSnapshotSchema.parse(snapshot);
    const db = await this.database;
    const tx = db.transaction(['records','tasks','trashStarts','purgedItems'], 'readwrite');
    try {
      for(const record of value.records){await tx.objectStore('purgedItems').delete(retentionKey('record',record.id));await tx.objectStore('trashStarts').delete(retentionKey('record',record.id));}
      for(const task of value.tasks){await tx.objectStore('purgedItems').delete(retentionKey('task',task.id));await tx.objectStore('trashStarts').delete(retentionKey('task',task.id));}
      for (const record of value.records) await tx.objectStore('records').put(record);
      for (const task of value.tasks) await tx.objectStore('tasks').put({...importedTask(task),deletedAt:task.deletedAt});
      for(const kind of ['record','task'] as const)for(const item of kind==='record'?value.records:value.tasks){const id=retentionKey(kind,item.id);if(item.deletedAt)await tx.objectStore('trashStarts').put({id,startedAt:new Date().toISOString()});}
      await tx.done;allowImportedRecovery('browser',value.records.map(r=>r.id));
    } catch (error) {
      try { tx.abort(); } catch { /* Already aborted. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  }
}
