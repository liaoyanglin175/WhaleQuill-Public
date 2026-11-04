import {describe,it,expect} from 'vitest';
import {createRecord} from '../../src/domain/models';
import {combineMemorySources,makeMemorySource,memorySources,sourcesCurrent,reindexSources} from '../../src/domain/memory-context';
const note=(body:string,date='2026-10-27T10:00:00.000Z')=>({...createRecord(),body,createdAt:date,updatedAt:date});
describe('AI发送范围与来源失效',()=>{
 it('追问优先采用当前问题命中的新片段，再补入前文来源且不重复计数',()=>{
   const record=note('新的问题对应这段原话。'),fresh=memorySources([record],'新的问题'),previous={...fresh[0],body:'旧问题只看过另一段。'};
   const combined=combineMemorySources(fresh,[previous]);expect(combined).toHaveLength(1);expect(combined[0].body).toBe(record.body);expect(combined[0].reference).toBe(1);
 });
 it('仅选择相关已保存原文，临时片段不变成历史记录',()=>{const records=[note('项目预算有限，所以暂缓云同步。'),note('今天去公园。')];const sources=memorySources(records,'为什么暂缓上云？','我想重新考虑云同步。');expect(sources.map(s=>s.recordId)).toEqual([records[0].id]);expect(sources[0].body).toContain('项目预算有限');expect(sourcesCurrent(sources,records)).toBe(true);});
 it('原文删除、修改或移除记忆后的版本变化使旧结果失效',()=>{const record=note('预算有限，暂缓上云。'),sources=memorySources([record],'云同步');expect(sourcesCurrent(sources,[])).toBe(false);expect(sourcesCurrent(sources,[{...record,body:'预算充足。'}])).toBe(false);expect(sourcesCurrent(sources,[{...record,updatedAt:'2026-10-28T10:00:00.000Z'}])).toBe(false);});
 it('日期回顾限制范围与片段数量，不声称回顾所有记录',()=>{const now=Date.parse('2026-10-28T12:00:00.000Z'),records=[note('太早的记录','2026-01-01T10:00:00.000Z'),...Array.from({length:8},(_,i)=>note(`最近第${i}条`))];const sources=memorySources(records,'回顾这周','','week',now);expect(sources).toHaveLength(5);expect(sources.some(s=>s.body.includes('太早'))).toBe(false);expect(reindexSources(sources.slice(2)).map(s=>s.reference)).toEqual([1,2,3]);});
 it('未找到相关记录时不将无关历史凑作证据',()=>{expect(memorySources([note('公园的桂花开了。')],'谁收到了报价？')).toEqual([]);});
 it('截取长原文的边界不切断emoji，仍能按原位置核对',()=>{const record=note('x'.repeat(1499)+'🐟很长的后续文字');const sources=[makeMemorySource(record,1)];expect(sources[0].body).toBe('x'.repeat(1499));expect(sourcesCurrent(sources,[record])).toBe(true);const another=note('🐟'+'x'.repeat(178)+'\n云同步需要预算。');const boundary=memorySources([another],'云同步');expect(boundary[0].start).toBe(0);expect(boundary[0].body.startsWith('🐟')).toBe(true);});
});
