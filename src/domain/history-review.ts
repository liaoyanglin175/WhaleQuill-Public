import type {NoteRecord} from './models';
import {recordTitle} from './models';
import {hasTag} from './tags';
import {recallRecords,type RecallQuote} from './recall';
import {parseRecallQuery} from './recall-query';
import {makeMemorySource,type MemorySource, type MemoryPeriod} from './memory-context';

export type ReviewFilter={query:string;tag:string|null;period:MemoryPeriod;now:number};
export type ReviewEntry={record:NoteRecord;quote:RecallQuote;reference:number};
export function historyReview(records:NoteRecord[],filter:ReviewFilter){
 const parsed=parseRecallQuery(filter.query,filter.now,records.flatMap(record=>record.tags));
 const limit=filter.period==='week'?7:filter.period==='month'?30:Infinity;
 const allowed=records.filter(record=>!('deletedAt' in record&&record.deletedAt)&&(!filter.tag||hasTag(record,filter.tag))&&Date.parse(record.createdAt)>=filter.now-limit*86400000&&Date.parse(record.createdAt)<=filter.now);
 const meaningful=parsed.terms.length||parsed.groups.length||parsed.required.length||parsed.tags.length||parsed.time;
 const matches=parsed.error?[]:meaningful?recallRecords(allowed,filter.query,{now:filter.now,limit:Infinity}):allowed.map(record=>{
   const highlight=record.highlights.find(item=>!item.stale&&record.body.slice(item.start,item.end)===item.text);
   const quote=highlight?{text:highlight.text,start:highlight.start,end:highlight.end,line:1}:{text:record.body.split(/\r?\n/).find(line=>line.trim())??'',start:0,end:0,line:1};
   if(!highlight){quote.start=record.body.indexOf(quote.text);quote.end=quote.start+quote.text.length;quote.line=record.body.slice(0,quote.start).split('\n').length;}
   return {record,quotes:[quote],matchedTerms:[]};
 });
 const ordered=[...matches].sort((a,b)=>Date.parse(a.record.createdAt)-Date.parse(b.record.createdAt)||a.record.id.localeCompare(b.record.id));
 const shown=ordered.length>200?[...ordered.slice(0,100),...ordered.slice(-100)]:ordered;
 const entries:ReviewEntry[]=shown.map((match,index)=>{
   const original=match.quotes[0]??{text:'',start:0,end:0,line:1};let from=0;
   if(original.text.length>240){const indexes=match.matchedTerms.map(term=>original.text.toLocaleLowerCase().indexOf(term)).filter(index=>index>=0);from=Math.max(0,(indexes.length?Math.min(...indexes):0)-60);}
   if(from>0&&/[\uDC00-\uDFFF]/.test(original.text[from]))from--;
   let end=Math.min(original.text.length,from+240);if(end<original.text.length&&/[\uD800-\uDBFF]/.test(original.text[end-1]))end--;
   const quote={...original,text:original.text.slice(from,end),start:original.start+from,end:original.start+end};
   return {record:match.record,quote,reference:index+1};
 });
 const signature=ordered.map(({record})=>JSON.stringify([record.id,record.updatedAt,recordTitle(record),record.body.length,record.tags,record.highlights])).join('\n');
 return {entries,total:ordered.length,error:parsed.error,time:parsed.time,signature};
}

export function reviewSources(entries:ReviewEntry[]):MemorySource[]{
 const indexes=entries.length<=5?entries.map((_,index)=>index):Array.from({length:5},(_,index)=>Math.round(index*(entries.length-1)/4));
 return indexes.map((index,reference)=>makeMemorySource(entries[index].record,reference+1,entries[index].quote.start));
}
