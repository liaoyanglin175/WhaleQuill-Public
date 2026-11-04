import 'fake-indexeddb/auto';
import {expect,it,vi} from 'vitest';
import {openDB} from 'idb';
import {BrowserRepository} from '../../src/storage/browser';
import type {NotebookDatabase} from '../../src/storage/browser';
import {createRecord,createTask} from '../../src/domain/models';
import {maintainTrash,previewTrash,updateTrash} from '../../src/storage/browser-trash';
import {creationProposalSchema} from '../../src/domain/creation';
import {retentionExpiry} from '../../src/domain/trash-retention';
const after=(date:Date,days:number)=>new Date(date.getTime()+days*86400000);
async function setup(){const name='retention-'+crypto.randomUUID(),repo=new BrowserRepository(name);await repo.load();return {repo,db:await openDB<NotebookDatabase>(name)};}

it('old trash receives a full grace period when the version5 database upgrades',async()=>{
 const name='old-trash-'+crypto.randomUUID(),old=await openDB(name,5,{upgrade(db){for(const name of ['records','tasks','creationBatches'])db.createObjectStore(name,{keyPath:name==='creationBatches'?'requestId':'id'});}}),record=createRecord();
 await old.put('records',{...record,deletedAt:'2020-01-01T00:00:00Z'});old.close();const repo=new BrowserRepository(name);await repo.load();const info=await repo.trashRetentionInfo();
 expect(info.policy.days).toBe(30);expect(Date.parse(info.entries[0].expiresAt!)).toBeGreaterThan(Date.now()+29*86400000);expect(await repo.loadTrash()).toHaveLength(1);
});
it('expiry permanently removes the deleted note, clears its journal and detaches surviving tasks',async()=>{
 const {repo,db}=await setup(),request=crypto.randomUUID(),items=creationProposalSchema.parse({items:[{kind:'note',title:'待清理',body:'不应残留的正文'},{kind:'task',title:'保留的待办'}]}).items,batch=await repo.commitCreation(request,items),record=batch.records[0];
 const task={...createTask('有来源的任务',null),sourceRecordId:record.id};await repo.saveTask(task);await repo.deleteRecord(record.id);const now=new Date();expect(await maintainTrash(db,after(now,31))).toBe(true);
 expect(await db.get('records',record.id)).toBeUndefined();expect((await db.get('tasks',task.id))?.sourceRecordId).toBeNull();expect(await db.get('tasks',batch.tasks[0].id)).toBeDefined();
 expect(JSON.stringify(await db.get('creationBatches',request))).not.toContain('不应残留');await expect(repo.commitCreation(request,items)).rejects.toThrow('永久清理');await expect(repo.undoCreation(request)).rejects.toThrow('永久清理');await expect(repo.saveRecord(record)).rejects.toThrow('永久清理');db.close();
});
it('shortening the retention requires the current count; a wrong count changes nothing',async()=>{
 const {repo,db}=await setup(),record={...createRecord(),body:'保留直到确认'};await repo.saveRecord(record);await repo.deleteRecord(record.id);const now=after(new Date(),10);
 expect(await previewTrash(db,7,now)).toBe(1);await expect(updateTrash(db,7,0,now)).rejects.toThrow('重新确认');expect((await repo.trashRetentionInfo()).policy.days).toBe(30);expect(await db.get('records',record.id)).toBeDefined();
 await updateTrash(db,7,1,now);expect(await db.get('records',record.id)).toBeUndefined();db.close();
});
it('disabled cleanup and re-enabling protect old trash for a new full period',async()=>{
 const {repo,db}=await setup(),record=createRecord();await repo.saveRecord(record);await repo.deleteRecord(record.id);await updateTrash(db,null,0);const future=after(new Date(),400);
 expect(await maintainTrash(db,future)).toBe(false);await updateTrash(db,30,0,future);expect(await maintainTrash(db,after(future,29))).toBe(false);expect(await maintainTrash(db,after(future,31))).toBe(true);db.close();
});
it('restoration cancels cleanup and re-deletion starts its own clock; an explicit backup import gets grace',async()=>{
 const {repo,db}=await setup(),record=createRecord();await repo.saveRecord(record);await repo.deleteRecord(record.id);await repo.restore('record',record.id);expect(await maintainTrash(db,after(new Date(),40))).toBe(false);
 const backup={records:[{...record,deletedAt:'2020-01-01T00:00:00Z'}],tasks:[]};await repo.mergeSnapshot(backup);expect(await maintainTrash(db,new Date())).toBe(false);expect(await maintainTrash(db,after(new Date(),31))).toBe(true);
 await repo.mergeSnapshot(backup);expect(await repo.loadTrash()).toHaveLength(1);await repo.restore('record',record.id);await expect(repo.saveRecord(record)).resolves.toBeUndefined();expect(backup.records[0].deletedAt).toBe('2020-01-01T00:00:00Z');db.close();
});
it('a failed purge rolls back records and metadata together',async()=>{
 const {repo,db}=await setup(),records=[createRecord(),createRecord()];for(const r of records){await repo.saveRecord(r);await repo.deleteRecord(r.id);}
 const original=IDBObjectStore.prototype.delete,spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,key){if(this.name==='records'&&key===records[1].id)throw new Error('simulated delete failure');return original.call(this,key);});
 try{await expect(maintainTrash(db,after(new Date(),31))).rejects.toThrow('simulated');}finally{spy.mockRestore();}
 expect((await db.getAll('records')).length).toBe(2);expect(await db.getAll('purgedItems')).toHaveLength(0);db.close();
});
it('retention uses the latest deletion or grace time and preserves malformed entries',()=>{
 expect(retentionExpiry('2020-01-01T00:00:00Z','2030-01-01T00:00:00Z',{days:30,enabledAt:'2029-01-01T00:00:00Z'})).toBe('2030-01-31T00:00:00.000Z');
 expect(retentionExpiry('invalid','2030-01-01T00:00:00Z',{days:30,enabledAt:'2029-01-01T00:00:00Z'})).toBeNull();
});
