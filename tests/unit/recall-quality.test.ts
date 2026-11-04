import {it,expect} from 'vitest';
import {createRecord} from '../../src/domain/models';
import {recallRecords} from '../../src/domain/recall';
import {parseRecallQuery} from '../../src/domain/recall-query';
const note=(title:string,body:string)=>({...createRecord(),title,body});
it('英文功能词和单词内部字母不能把不相关记录找出来',()=>{
 const cloud=note('Cloud','Cloud sync was postponed because the budget was only200 yuan.');
 expect(recallRecords([cloud],'why keep my diary on my computer')).toEqual([]);
 expect(recallRecords([cloud],'on')).toEqual([]);
 expect(recallRecords([cloud],'why cloud sync')).toHaveLength(1);
});
it('中文收件人与发件人分开，未指定方向时保留双向结果',()=>{
 const sent=note('发出','给小林发送报价，费用800元。'),received=note('收到','小林给我发来了报价，费用500元。');
 const records=[sent,received];
 expect(recallRecords(records,'小林给我的报价').map(r=>r.record.id)).toEqual([received.id]);
 expect(recallRecords(records,'谁给我报了价').map(r=>r.record.id)).toEqual([received.id]);
 expect(recallRecords(records,'发送给小林的估价').map(r=>r.record.id)).toEqual([sent.id]);
 expect(recallRecords(records,'小林的报价')).toHaveLength(2);
});
it('人物关系的独立样本支持不同人名和收到某人资料的说法',()=>{
 const sent=note('寄出','向陈安发送报价，费用300元。'),received=note('收到','收到陈安的报价，费用700元。'),other=note('其他','周禾给我提供了报价，费用900元。');
 expect(recallRecords([sent,received,other],'收到陈安的估价').map(r=>r.record.id)).toEqual([received.id]);
 expect(recallRecords([sent,received,other],'周禾给我的报价').map(r=>r.record.id)).toEqual([other.id]);
});
it('多个明确关键词同时满足，避免只因出现同一个人而返回无关事件',()=>{
 const sea=note('出游','小林去厦门看海。'),quote=note('报价','给小林发了报价。');
 expect(recallRecords([sea,quote],'小林 厦门').map(r=>r.record.id)).toEqual([sea.id]);
});
it('本地日记的常用线索可跨同义表达查找，不把它称为通用语义理解',()=>{
 const local=note('日记存放','不想把私人日记上传，所以只放在本机。');
 expect(recallRecords([local],'之前为什么把数据留在电脑上')[0]?.record.id).toBe(local.id);
 expect(recallRecords([local],'why keep my diary on my computer')[0]?.record.id).toBe(local.id);
});
it('放宽推断条件仍保留日期、标签和明确引用，不能跨越用户选择的范围',()=>{
 const good={...note('报价','小林给我提供了报价。'),tags:['项目'],createdAt:'2026-10-28T12:00:00+08:00'},old={...good,id:crypto.randomUUID(),createdAt:'2026-10-27T12:00:00+08:00'},other={...good,id:crypto.randomUUID(),tags:[]};
 const q='2026-10-28 #项目 “小林” 给阿宁的报价';
 expect(recallRecords([good,old,other],q,{relaxed:true}).map(r=>r.record.id)).toEqual([good.id]);
 expect(parseRecallQuery(q).quoted).toEqual(['小林']);
 expect(recallRecords([note('无关','公园的桂花开了。')],'发送给陈安的估价',{relaxed:true})).toEqual([]);
});
it('完整结果可显式获取，同分时顺序稳定，默认AI上下文仍只取12条',()=>{
 const records=Array.from({length:100},(_,i)=>({...note('阅读','阅读线索 '+i),updatedAt:'2026-10-28T00:00:00Z'}));
 expect(recallRecords(records,'阅读线索')).toHaveLength(12);
 const all=recallRecords(records,'阅读线索',{limit:Infinity});expect(all).toHaveLength(100);expect(new Set(all.map(r=>r.record.id)).size).toBe(100);
 expect(recallRecords([...records].reverse(),'阅读线索',{limit:Infinity}).map(r=>r.record.id)).toEqual(all.map(r=>r.record.id));
});
