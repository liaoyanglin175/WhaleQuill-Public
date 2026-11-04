import 'fake-indexeddb/auto';
import {it,expect} from 'vitest';
import {BrowserRepository} from '../../src/storage/browser';
import {creationProposalSchema,creationIntent} from '../../src/domain/creation';
const repo=()=>new BrowserRepository(`creation-${crypto.randomUUID()}`);
const items=()=>creationProposalSchema.parse({items:[{kind:'note',title:'  旅行想法  ',body:'尚待确认的路线'}, {kind:'event',title:'逛美术馆',date:'2030-12-30',time:'14:00',endTime:'16:00'}]}).items;
it('AI草案本身不写入，确认后原子创建，重试不重复且不同内容拒绝复用请求',async()=>{
 const storage=repo(),proposal=items(),id=crypto.randomUUID();expect((await storage.load()).records).toHaveLength(0);
 const first=await storage.commitCreation(id,proposal),retry=await storage.commitCreation(id,proposal);
 expect(retry.records).toEqual(first.records);expect((await storage.load()).tasks).toHaveLength(1);expect(first.records[0].title).toBe('旅行想法');
 await expect(storage.commitCreation(id,[{...proposal[0],title:'另一个想法'}])).rejects.toThrow('内容与上次不同');
 expect((await storage.load()).records).toHaveLength(1);
});
it('批量撤销可恢复；任意内容后来被改动时整批不撤销',async()=>{
 const storage=repo(),first=await storage.commitCreation(crypto.randomUUID(),items());
 await storage.saveRecord({...first.records[0],body:'后来自己改写',updatedAt:first.records[0].updatedAt});
 await expect(storage.undoCreation(first.requestId)).rejects.toThrow('已修改');expect((await storage.load()).tasks).toHaveLength(1);
 const second=await storage.commitCreation(crypto.randomUUID(),items());await storage.undoCreation(second.requestId);await storage.undoCreation(second.requestId);
 expect(await storage.loadTrash()).toHaveLength(2);expect((await storage.load()).records[0].body).toBe('后来自己改写');
 await expect(storage.commitCreation(second.requestId,items())).rejects.toThrow('已撤销');
});
it('无效行程拒绝整批写入；普通聊天不会误判为请求创建',async()=>{
 const storage=repo(),proposal=items();await expect(storage.commitCreation(crypto.randomUUID(),[proposal[0],{...proposal[1],date:null}])).rejects.toThrow();expect((await storage.load()).records).toHaveLength(0);
 expect(creationIntent('帮我安排去杭州玩的行程')).toBe(true);expect(creationIntent('Create a note about my trip')).toBe(true);expect(creationIntent('我今天很累，想歇会儿')).toBe(false);
});
