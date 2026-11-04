import type { NoteRecord } from './models';
import {hasTag} from './tags';
import {parseRecallQuery,normalizeRecall,containsRecallTerm,matchesRecallRelation} from './recall-query';
export type RecallQuote={text:string;start:number;end:number;line:number};
export type RecallMatch={record:NoteRecord;quotes:RecallQuote[];score:number;matchedTerms:string[];synonyms:string[];highlighted:boolean;reason:boolean;brief:string;timeLabel?:string};
export type RecallOptions={now?:number;limit?:number;tag?:string|null;relaxed?:boolean};
const reasonPattern=/原因\s*[:：]|因为|由于|考虑|为了|担心|所以|因此|reason|because/i;
export function recallRecords(records:NoteRecord[],question:string,options:RecallOptions={}):RecallMatch[]{
 const query=parseRecallQuery(question,options.now??Date.now(),records.flatMap(record=>record.tags));
 if(query.error||!query.text.trim()||!query.terms.length&&!query.groups.length&&!query.required.length&&!query.tags.length&&!query.time&&!options.tag)return [];
 const wantsReason=/为什么|为何|原因|怎么.*决定|why|reason|decid/i.test(question);
 const score=(text:string)=>{const haystack=normalizeRecall(text);return query.terms.reduce((sum,term)=>sum+(containsRecallTerm(haystack,term)?term.length*term.length:0),0)+query.groups.reduce((sum,group)=>sum+(group.some(term=>containsRecallTerm(haystack,term))?16:0),0);};
 return records.flatMap((record):RecallMatch[]=>{
  if(('deletedAt' in record&&record.deletedAt)||options.tag&&!hasTag(record,options.tag)||!query.tags.every(tag=>hasTag(record,tag)))return [];
  const date=Date.parse(record.createdAt);if(query.time&&(date<query.time.from||date>=query.time.to))return [];
  const whole=normalizeRecall([record.title,record.body,...record.tags].join('\n'));
  const required=options.relaxed?query.quoted:query.required;
  if(!required.every(term=>containsRecallTerm(whole,term)))return [];
  if(!options.relaxed&&(!query.groups.every(group=>group.some(term=>containsRecallTerm(whole,term)))||!query.literal.every(term=>containsRecallTerm(whole,term))||query.relation&&!matchesRecallRelation(whole,query.relation)))return [];
  const direct=query.terms.filter(term=>containsRecallTerm(whole,term)),synonyms=[...new Set(query.groups.flatMap(group=>group.filter(term=>containsRecallTerm(whole,term)&&!containsRecallTerm(query.text,term))))];
  const contentQuery=query.terms.length||query.groups.length||query.required.length;
  if(contentQuery&&!direct.length&&!synonyms.length&&!required.length)return [];
  let offset=0;const lines=record.body.split(/\n/).map((raw,index)=>{const text=raw.replace(/\r$/,'');const line={text,start:offset,end:offset+text.length,line:index+1,score:score(text)};offset+=raw.length+1;return line;});
  const liveHighlights=record.highlights.filter(h=>!h.stale&&record.body.slice(h.start,h.end)===h.text&&score(h.text)>0);
  for(const line of lines)if(liveHighlights.some(h=>h.start<line.end&&h.end>line.start))line.score+=30;
  const ranked=lines.filter(line=>line.text.trim()).sort((a,b)=>b.score-a.score||a.line-b.line),best=ranked[0],titleScore=score([record.title,...record.tags].join('\n'));
  if(contentQuery&&!titleScore&&!best?.score&&!required.length)return [];
  const sameSection=(a:number,b:number)=>lines.slice(Math.min(a,b)-1,Math.max(a,b)).every(line=>line.text.trim()&&!/^#{1,6}\s|^[-=]{3,}$|^另一个/.test(line.text));
  const reason=wantsReason&&best?lines.find(line=>Math.abs(line.line-best.line)<=3&&reasonPattern.test(line.text)&&sameSection(best.line,line.line)):undefined;
  const selected=new Set<number>();if(reason)selected.add(reason.line);if(best)selected.add(best.line);if(best&&lines[best.line]?.text.trim()&&sameSection(best.line,best.line+1))selected.add(best.line+1);
  const quotes=[...selected].map(number=>lines[number-1]).filter(Boolean).slice(0,4).map(({text,start,end,line})=>({text,start,end,line}));
  return [{record,quotes,score:titleScore*3+(best?.score??0)+(reason?15:0),timeLabel:query.time?.label,matchedTerms:[...new Set([...query.required,...direct,...synonyms])].sort((a,b)=>b.length-a.length).slice(0,24),synonyms,highlighted:liveHighlights.length>0,reason:!!reason,brief:(reason?.text??(best?.score?best.text:record.title)).slice(0,160)}];
 }).sort((a,b)=>b.score-a.score||Date.parse(b.record.updatedAt)-Date.parse(a.record.updatedAt)||a.record.id.localeCompare(b.record.id)).slice(0,options.limit??12);
}
