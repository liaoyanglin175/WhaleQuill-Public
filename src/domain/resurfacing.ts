import type { NoteRecord,Highlight } from './models';
import {liveHighlights} from './highlights';

export type ResurfaceCue={id:string;record:NoteRecord;highlight?:Highlight;text:string;start:number;end:number;reason:string};
export type MemoryPreferences={day:string;frequency:'daily'|'quiet'|'off';selected:string;dismissed:string[];shown:Record<string,string>;hiddenToday:boolean};
export const localDay=(date=new Date())=>date.toLocaleDateString('sv-SE');
const hash=(text:string)=>{let value=2166136261;for(const char of text)value=Math.imul(value^char.charCodeAt(0),16777619);return value>>>0;};
function terms(text:string):Set<string>{const result=new Set<string>();for(const chunk of text.toLocaleLowerCase().match(/[\p{Script=Han}]+|[a-z0-9_-]{3,}/gu)??[]){if(/^[a-z0-9_-]+$/.test(chunk)){result.add(chunk);continue;}for(let i=0;i+3<=chunk.length;i++)result.add(chunk.slice(i,i+3));}return result;}

export function resurfacingCandidates(records:NoteRecord[],now=new Date()):ResurfaceCue[]{
 const startOfToday=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),day=localDay(now);
 const recent=[...records].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,4);
 const candidates:{cue:ResurfaceCue;score:number}[]=[];
 for(const record of records){
  if((record as NoteRecord&{deletedAt?:string|null}).deletedAt||!record.body.trim()||!Number.isFinite(Date.parse(record.createdAt))||Date.parse(record.createdAt)>now.getTime())continue;
  const highlights=liveHighlights(record).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt));
  const age=Math.max(0,Math.floor((now.getTime()-Date.parse(record.createdAt))/86_400_000));
  const own=terms(`${record.title} ${record.body.slice(0,350)}`),recentTerms=terms(recent.filter(item=>item.id!==record.id).map(item=>`${item.title} ${item.body.slice(0,200)}`).join(' '));
  const overlap=[...own].filter(term=>recentTerms.has(term)).length,related=overlap>=2;
  if(highlights.length){const highlight=highlights[0];candidates.push({cue:{id:highlight.id,record,highlight,text:highlight.text,start:highlight.start,end:highlight.end,reason:Date.parse(highlight.createdAt)<startOfToday-6*86_400_000?'回看一周前划过的重点':'你亲手划过的重点'},score:60+Math.min(age,18)+(related?10:0)+hash(day+highlight.id)%11});}
  else if(Date.parse(record.createdAt)<startOfToday){
   const start=record.body.search(/\S/u);let end=Math.min(record.body.length,start+160);if(end>start&&/[\uD800-\uDBFF]/.test(record.body[end-1]))end--;
   const text=record.body.slice(start,end).trimEnd();end=start+text.length;
   candidates.push({cue:{id:`record:${record.id}`,record,text,start,end,reason:related?'包含近期记录中的词':age>=7?'一段时间前的记录':'之前留下的记录'},score:18+Math.min(age,18)+(related?12:0)+hash(day+record.id)%17+(hash(day)%3===0?16:0)});
  }
 }
 return candidates.sort((a,b)=>b.score-a.score||a.cue.id.localeCompare(b.cue.id)).map(item=>item.cue);
}

export function dailyResurfacing(records:NoteRecord[],prefs:MemoryPreferences,now=new Date()):ResurfaceCue|null{
 if(prefs.frequency==='off'||prefs.hiddenToday||(prefs.frequency==='quiet'&&Math.floor(Date.parse(`${prefs.day}T00:00:00Z`)/86_400_000)%3!==0))return null;
 const candidates=resurfacingCandidates(records,now).filter(cue=>!prefs.dismissed.includes(cue.id));
 const pinned=candidates.find(cue=>cue.id===prefs.selected);if(pinned)return pinned;
 const today=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
 return candidates.find(cue=>{
  const shown=prefs.shown[cue.record.id];if(!shown)return true;
  const elapsed=(today-new Date(`${shown}T00:00:00`).getTime())/86_400_000;
  return elapsed>=7||!!cue.highlight&&Date.parse(cue.highlight.createdAt)>=today;
 })??null;
}
