import {describe,it,expect} from 'vitest';
import {historyReview,reviewSources} from '../../src/domain/history-review';
import {sourcesCurrent,memorySources} from '../../src/domain/memory-context';
import {createRecord} from '../../src/domain/models';
import {parseRecallQuery} from '../../src/domain/recall-query';
import {recallRecords} from '../../src/domain/recall';
import {recallNotes,recallNow} from '../fixtures/recall-scenarios';
const filter={query:'云同步',tag:'项目',period:'all' as const,now:recallNow};

describe('按主题整理历史',()=>{
 it('按创建时间展示原话，起点和最近记录可核对，不把无关同标签记录凑进来',()=>{
  const review=historyReview(recallNotes,filter);expect(review.total).toBe(2);expect(review.entries.map(entry=>entry.record.title)).toEqual(['暂缓云同步','预算调整']);
  for(const entry of review.entries)expect(entry.record.body.slice(entry.quote.start,entry.quote.end)).toBe(entry.quote.text);
  expect(sourcesCurrent(reviewSources(review.entries),recallNotes)).toBe(true);
 });
 it('来源编辑与删除会更新脉络并使旧引用失效，未找到主题不回退到无关记录',()=>{
  const before=historyReview(recallNotes,filter),sources=reviewSources(before.entries),edited=recallNotes.map(record=>record===before.entries[1].record?{...record,body:'已完成本地备份。',updatedAt:'2026-10-28T12:00:00+08:00'}:record);
  const after=historyReview(edited,filter);expect(after.total).toBe(1);expect(after.signature).not.toBe(before.signature);expect(sourcesCurrent(sources,edited)).toBe(false);
  expect(historyReview(recallNotes,{...filter,query:'火星移民',tag:null}).total).toBe(0);expect(memorySources(recallNotes,'回顾火星移民','','all',recallNow)).toEqual([]);
 });
 it('大范围回顾只展示200条并保留真正起点和最近来源，联网候选最多五条',()=>{
  const records=Array.from({length:205},(_,index)=>({...createRecord(),title:`第${index}条`,body:'预算记录。',createdAt:new Date(Date.UTC(2026,0,1,index)).toISOString()}));
  const review=historyReview(records,{...filter,query:'',tag:null});expect(review.total).toBe(205);expect(review.entries).toHaveLength(200);expect(review.entries[0].record.id).toBe(records[0].id);expect(review.entries.at(-1)!.record.id).toBe(records.at(-1)!.id);
  const sources=reviewSources(review.entries);expect(sources).toHaveLength(5);expect(sources[0].recordId).toBe(records[0].id);expect(sources.at(-1)!.recordId).toBe(records.at(-1)!.id);expect(sourcesCurrent(sources,records)).toBe(true);
 });
 it('标题笔记和长段落都能回顾，截取不切断emoji且来源位置准确',()=>{
  const title={...createRecord(),title:'只有标题',body:'',createdAt:recallNotes[0].createdAt},long={...title,id:crypto.randomUUID(),body:'a'.repeat(300)+'🐟预算'+ 'b'.repeat(400)};
  const review=historyReview([title,long],{...filter,query:'',tag:null});expect(review.total).toBe(2);for(const entry of review.entries)expect(entry.record.body.slice(entry.quote.start,entry.quote.end)).toBe(entry.quote.text);
  for(const source of reviewSources(review.entries)){expect(source.body).not.toMatch(/[\uD800-\uDBFF]$/);expect(sourcesCurrent([source],[title,long])).toBe(true);}
 });
});

describe('日期与线索的边界',()=>{
 it('上周使用周一至周日，周五和显式范围均包含结束当天',()=>{
  const week=parseRecallQuery('上周',recallNow).time!,friday=parseRecallQuery('上周五',recallNow).time!;expect(new Date(week.from).getDay()).toBe(1);expect(week.to-week.from).toBe(7*86400000);expect(new Date(friday.from).getDay()).toBe(5);expect(friday.to-friday.from).toBe(86400000);
  expect(recallRecords(recallNotes,'2026-10-20到2026-10-22',{now:recallNow})).toHaveLength(3);
 });
 it('非法日期和没有交集的范围不被当作普通关键词',()=>{
  for(const query of ['2026年2月30日','2026-10-24到2026-10-20','去年2026年10月20日']){const parsed=parseRecallQuery(query,recallNow);expect(parsed.error).not.toBe('');expect(recallRecords(recallNotes,query,{now:recallNow})).toEqual([]);}
  const lastYear=parseRecallQuery('去年10月20日',recallNow);expect(lastYear.error).toBe('');expect(new Date(lastYear.time!.from).getFullYear()).toBe(2025);expect(new Date(lastYear.time!.from).getDate()).toBe(20);
 });
 it('记录日期与正文描述的事件时间分开，不从“昨天”推造记录日期',()=>{
  const today={...createRecord(),title:'海边',body:'昨天去了海边。',createdAt:'2026-10-28T10:00:00+08:00'};
  expect(recallRecords([today],'昨天海边',{now:recallNow})).toEqual([]);expect(recallRecords([today],'今天海边',{now:recallNow})).toHaveLength(1);
 });
 it('缺少原词时可用相近表达，明确的人名、标签和负面情绪不会被宽泛词替代',()=>{
  expect(recallRecords(recallNotes,'和李雷散心',{now:recallNow})).toEqual([]);expect(recallRecords(recallNotes,'心情不好',{now:recallNow}).map(result=>result.record.title)).toEqual(['周末心情']);expect(recallRecords(recallNotes,'#项目的记录',{now:recallNow})).toHaveLength(4);
 });
 it('未出现在对照表里的所属人说法也须同时满足人物和事情，不能返回另一个人的报价',()=>{
  for(const question of ['上周小林的估价','关于小林的报价'])expect(recallRecords(recallNotes,question,{now:recallNow}).map(result=>result.record.title)).toEqual(['报价发送']);
  const english=recallNotes.filter(record=>record.title.startsWith('报价')).map((record,index)=>({...record,body:index?'Quotation for Ben.':'Quotation for Alice.'}));expect(recallRecords(english,"Alice's quotation",{now:recallNow}).map(result=>result.record.title)).toEqual(['报价发送']);expect(recallRecords(english,'quotation for Ben',{now:recallNow}).map(result=>result.record.title)).toEqual(['报价沟通']);
 });
});
