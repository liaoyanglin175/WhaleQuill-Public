import type {IDBPDatabase,IDBPTransaction} from 'idb';
import type {NotebookDatabase} from './browser';
import {retentionExpiry,retentionKey,retentionDays} from '../domain/trash-retention';
import type {TrashPolicy,TrashRetentionInfo,RetentionDays} from '../domain/trash-retention';
import {forgetPurgedRecovery} from './recovery';

const stores=['records','tasks','creationBatches','trashPolicy','trashStarts','purgedItems'] as const;
type DB=IDBPDatabase<NotebookDatabase>;
type Tx=IDBPTransaction<NotebookDatabase,typeof stores,'readwrite'>;
type Entry=TrashRetentionInfo['entries'][number];
export async function initializeTrash(db:DB){
 const tx=db.transaction(stores,'readwrite');
 if(!await tx.objectStore('trashPolicy').get('policy')){
  const now=new Date().toISOString();await tx.objectStore('trashPolicy').put({id:'policy',days:30,enabledAt:now});
  for(const kind of ['record','task'] as const)for(const item of await tx.objectStore(kind==='record'?'records':'tasks').getAll())if(item.deletedAt)await tx.objectStore('trashStarts').put({id:retentionKey(kind,item.id),startedAt:now});
 }
 await tx.done;
}
async function policy(tx:Tx):Promise<TrashPolicy>{const value=await tx.objectStore('trashPolicy').get('policy');if(!value)throw new Error('保留规则尚未准备好');return {days:value.days,enabledAt:value.enabledAt};}
async function entries(tx:Tx,p:TrashPolicy):Promise<Entry[]>{
 const starts=new Map((await tx.objectStore('trashStarts').getAll()).map(value=>[value.id,value.startedAt])),result:Entry[]=[];
 for(const kind of ['record','task'] as const)for(const item of await tx.objectStore(kind==='record'?'records':'tasks').getAll())if(item.deletedAt)result.push({kind,id:item.id,expiresAt:retentionExpiry(item.deletedAt,starts.get(retentionKey(kind,item.id))??p.enabledAt,p)});
 return result;
}
async function due(tx:Tx,p:TrashPolicy,now:Date){return (await entries(tx,p)).filter(e=>e.expiresAt&&Date.parse(e.expiresAt)<=now.getTime());}
async function purge(tx:Tx,items:Entry[],now:Date){
 const batches=await tx.objectStore('creationBatches').getAll(),recordIds=new Set(items.filter(e=>e.kind==='record').map(e=>e.id)),taskIds=new Set(items.filter(e=>e.kind==='task').map(e=>e.id));
 for(const batch of batches)if(batch.records.some(e=>recordIds.has(e.id))||batch.tasks.some(e=>taskIds.has(e.id)))await tx.objectStore('creationBatches').put({requestId:batch.requestId,createdAt:batch.createdAt,records:[],tasks:[],undone:true,proposal:'',purged:true});
 if(recordIds.size)for(const task of await tx.objectStore('tasks').getAll())if(task.sourceRecordId&&recordIds.has(task.sourceRecordId))await tx.objectStore('tasks').put({...task,sourceRecordId:null,updatedAt:now.toISOString()});
 for(const item of items){await tx.objectStore(item.kind==='record'?'records':'tasks').delete(item.id);const id=retentionKey(item.kind,item.id);await tx.objectStore('purgedItems').put({id,kind:item.kind,itemId:item.id});await tx.objectStore('trashStarts').delete(id);}
}
async function forget(tx:Tx){return (await tx.objectStore('purgedItems').getAll()).filter(e=>e.kind==='record').map(e=>e.itemId);}
export async function maintainTrash(db:DB,now=new Date()):Promise<boolean>{
 const tx=db.transaction(stores,'readwrite');try{const items=await due(tx,await policy(tx),now);await purge(tx,items,now);const ids=await forget(tx);await tx.done;forgetPurgedRecovery('browser',ids);return items.length>0;}catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
export async function trashInfo(db:DB):Promise<TrashRetentionInfo>{const tx=db.transaction(stores,'readwrite'),p=await policy(tx),result={policy:p,entries:await entries(tx,p)};await tx.done;return result;}
async function proposed(tx:Tx,days:RetentionDays,now:Date){retentionDays(days);const p=await policy(tx);return {days,enabledAt:p.days===null&&days!==null?now.toISOString():p.enabledAt};}
export async function previewTrash(db:DB,days:RetentionDays,now=new Date()):Promise<number>{const tx=db.transaction(stores,'readwrite'),p=await proposed(tx,days,now),count=(await due(tx,p,now)).length;await tx.done;return count;}
export async function updateTrash(db:DB,days:RetentionDays,confirmedCount:number,now=new Date()):Promise<TrashRetentionInfo>{
 const tx=db.transaction(stores,'readwrite');
 try{const p=await proposed(tx,days,now),items=await due(tx,p,now);if(items.length!==confirmedCount)throw new Error('回收站内容有变化，请重新确认清理数量。');
  await tx.objectStore('trashPolicy').put({id:'policy',...p});await purge(tx,items,now);const result={policy:p,entries:await entries(tx,p)},ids=await forget(tx);await tx.done;forgetPurgedRecovery('browser',ids);return result;
 }catch(error){try{tx.abort();}catch{}await tx.done.catch(()=>{});throw error;}
}
