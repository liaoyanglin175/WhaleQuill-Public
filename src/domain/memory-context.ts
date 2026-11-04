import {recallRecords} from './recall';
import {recordTitle} from './models';
import type {NoteRecord} from './models';
import {parseRecallQuery} from './recall-query';
export type MemorySource={recordId:string;revision:string;reference:number;title:string;date:string;body:string;start:number;end:number};
export type MemoryAnswer={answer:string;citations:number[];nextSteps:string[];creation?:import('./creation').CreationProposal|null};
export type ConversationTurn={question:string;answer:string};
export type MemoryPeriod='all'|'week'|'month';
export function memorySources(records:NoteRecord[],question:string,context='',period:MemoryPeriod='all',now=Date.now()):MemorySource[]{
  const limit=period==='week'?7:period==='month'?30:Infinity;
  const allowed=records.filter(record=>Date.parse(record.createdAt)>=now-limit*86_400_000);
  const matches=recallRecords(allowed,question,{now}),contextMatches=context?recallRecords(allowed,context.slice(0,200),{now}):[];
  const ranked=[...matches,...contextMatches.filter(match=>!matches.some(item=>item.record.id===match.record.id))];
  const review=/回顾|最近|这一周|本周|这周|这月|review|recap|this week|this month/i.test(question);
  const parsed=parseRecallQuery(question,now,records.flatMap(record=>record.tags));
  const genericReview=review&&!parsed.error&&!parsed.terms.length&&!parsed.groups.length&&!parsed.required.length&&!parsed.tags.length;
  const chosen=ranked.length?ranked.map(match=>({record:match.record,start:match.quotes[0]?.start??0})):genericReview?[...allowed].filter(record=>!parsed.time||Date.parse(record.createdAt)>=parsed.time.from&&Date.parse(record.createdAt)<parsed.time.to).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).map(record=>({record,start:record.highlights.find(item=>!item.stale)?.start??0})):[];
  return chosen.slice(0,5).map(({record,start},index)=>makeMemorySource(record,index+1,start));
}
export function makeMemorySource(record:NoteRecord,reference:number,start=0):MemorySource {
    let from=Math.max(0,start-180);if(from>0&&/[\uDC00-\uDFFF]/.test(record.body[from]))from--;
    let end=Math.min(record.body.length,from+1500);if(end<record.body.length&&/[\uD800-\uDBFF]/.test(record.body[end-1]))end--;
    return {recordId:record.id,revision:record.updatedAt,reference,title:recordTitle(record),date:record.createdAt,body:record.body.slice(from,end),start:from,end};
}
export function sourcesCurrent(sources:MemorySource[],records:NoteRecord[]):boolean{
  return sources.every(source=>{const record=records.find(item=>item.id===source.recordId);return !!record&&record.updatedAt===source.revision&&recordTitle(record)===source.title&&record.body.slice(source.start,source.end)===source.body;});
}
export function reindexSources(sources:MemorySource[]):MemorySource[]{return sources.map((source,index)=>({...source,reference:index+1}));}
export function combineMemorySources(fresh:MemorySource[],previous:MemorySource[]):MemorySource[]{
  const seen=new Set<string>();
  return reindexSources([...fresh,...previous].filter(source=>{
    if(seen.has(source.recordId))return false;seen.add(source.recordId);return true;
  }).slice(0,5));
}
