import {it,expect} from 'vitest';
import {backupBlob,backupLines,readBackupBlob,readBackupStream} from '../../src/domain/stream-backup';
import {createRecord,createTask,encodeCompleteArchive,encodeArchive} from '../../src/domain/models';
const fixture=()=>{const record={...createRecord(),title:'原始记录',body:'中文🌊\n留给未来的记录。',tags:['旅行'],deletedAt:null};const task={...createTask('出发前准备','2030-12-30',record.id),dueTime:'20:00',deletedAt:null};return {records:[record],tasks:[task]};};
it('UTF8跨字节分块仍完整恢复正文、删除状态和任务来源',async()=>{
 const snapshot=fixture(),blob=await backupBlob(snapshot),bytes=new Uint8Array(await blob.arrayBuffer());async function* chunks(){for(let i=0;i<bytes.length;i+=7)yield bytes.slice(i,i+7);}
 const archive=await readBackupStream(chunks());expect(archive.version).toBe(8);if(archive.version!==1)expect(archive.snapshot).toEqual(snapshot);
});
it('超过20MB的合法记录可完整读写，而不是放宽旧JSON的防护',async()=>{
 const snapshot=fixture();snapshot.records=Array.from({length:8},()=>({...snapshot.records[0],id:crypto.randomUUID(),body:'记'.repeat(1_000_000)}));snapshot.tasks=[];
 const blob=await backupBlob(snapshot);expect(blob.size).toBeGreaterThan(20*1024*1024);const archive=await readBackupBlob(blob);if(archive.version!==1){expect(archive.snapshot.records).toHaveLength(8);expect(archive.snapshot.records[7].body).toBe(snapshot.records[7].body);}
},15000);
it('缺少尾部、修改内容、缺少条目或追加垃圾都拒绝返回可导入数据',async()=>{
 const text=await(await backupBlob(fixture())).text(),lines=text.trimEnd().split('\n');
 for(const invalid of [lines.slice(0,-1).join('\n')+'\n',text.replace('原始记录','被改动了'),[...lines.slice(0,1),...lines.slice(2)].join('\n')+'\n',text+'{}\n'])await expect(readBackupBlob(new Blob([invalid]))).rejects.toThrow();
});
it('旧v1和v7 JSON继续可读',async()=>{
 const snapshot=fixture();const old=encodeArchive({records:snapshot.records,tasks:[]}),recent=encodeCompleteArchive(snapshot);
 expect((await readBackupBlob(new Blob([old]))).version).toBe(1);expect((await readBackupBlob(new Blob([recent]))).version).toBe(7);
});
it('取消读写会停止工作，损坏的跨记录关联不会被当作有效备份',async()=>{
 const controller=new AbortController();controller.abort();await expect(backupBlob(fixture(),controller.signal)).rejects.toMatchObject({name:'AbortError'});await expect(readBackupBlob(new Blob(['{}']),controller.signal)).rejects.toMatchObject({name:'AbortError'});
 const invalid=fixture();invalid.tasks[0].sourceRecordId=crypto.randomUUID();const iterator=backupLines(invalid);await expect(iterator.next()).rejects.toThrow();
});
