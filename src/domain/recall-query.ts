import {tagKey,tagName} from './tags';

export type RecallTime={from:number;to:number;label:string};
export type RecallRelation={direction:'sent'|'received';person:string|null};
export type RecallQuery={text:string;terms:string[];groups:string[][];required:string[];quoted:string[];literal:string[];relation:RecallRelation|null;tags:string[];time:RecallTime|null;error:string};
export const normalizeRecall=(text:string)=>text.normalize('NFKC').toLocaleLowerCase();
const groups=[
 ['云同步','云端','上云','云备份','网盘','联网存储','在线存储','放到网上','放到网','cloud sync','cloud storage'],
 ['离线','断网','没网','不联网','offline'],['备份','导出','数据带走','backup','export'],
 ['隐私','数据泄露','个人信息','privacy'],['数据库升级','数据库迁移','数据迁移','database migration'],
 ['手动保存','人为保存','自己保存','manual save'],['自动保存','autosave','auto save'],
 ['散心','放松','散步','透气','走走','relax','relaxing','relaxed','unwind'],
 ['旅行','旅游','出游','travel','trip'],['报价','估价','报价单','quotation','price quote'],
 ['背单词','记单词','英语单词','vocabulary','word practice'],
 ['失眠','睡不着','sleep trouble','insomnia'],
 ['不开心','心情不好','心情不太好','心情低落','难过','沮丧','feeling down','unhappy'],
 ['本机','本地','电脑','计算机','local','computer','device'],['日记','diary','journal'],
 ['车票','动车票','火车票','train ticket','train tickets'],
];
export const containsRecallTerm=(text:string,term:string)=>/^[a-z0-9 _-]+$/.test(term)?new RegExp(`(^|[^a-z0-9_])${term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?=$|[^a-z0-9_])`,'i').test(text):text.includes(term);
const personWord=(text:string)=>!/(?:我|我们|自己|发送|收到|关于|之前|以前|请问|谁|为什么)/.test(text);
function relationClue(text:string):RecallRelation|null{
 if(!/报价|估价|报(?:过|了)?价|quotation|price quote/i.test(text))return null;
 const received=/(?:给|向)(?:我|我们)|(?:我|我们)?收到|\b(?:received|from)\b/i.test(text);
 if(received){const named=text.match(/([\p{Script=Han}]{2,4}?)(?:给|向)(?:我|我们)/u)?.[1]??text.match(/收到(?:了)?([\p{Script=Han}]{2,4}?)(?=的)/u)?.[1]??text.match(/\bfrom\s+([a-z][a-z0-9_-]*)/i)?.[1];return {direction:'received',person:named&&personWord(named)?named:null};}
 const named=text.match(/(?:给|向)([\p{Script=Han}]{2,4}?)(?=的|发送|发|报|估价|报价|[，。？\s]|$)/u)?.[1]??text.match(/\bto\s+([a-z][a-z0-9_-]*)/i)?.[1];
 if(named&&personWord(named)||/\b(?:sent|send)\b/i.test(text))return {direction:'sent',person:named&&personWord(named)?named:null};return null;
}
export function matchesRecallRelation(text:string,relation:RecallRelation):boolean{
 const person=relation.person?.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 if(relation.direction==='received')return person?new RegExp(`${person}.{0,10}(?:给|向)(?:我|我们)|(?:收到|接到).{0,6}${person}|\\bfrom\\s+${person}(?=\\W|$)`,'i').test(text):/(?:给|向)(?:我|我们)|收到|接到|\breceived\b|\bfrom\b/i.test(text);
 return person?new RegExp(`(?:给|向|发给|寄给)${person}|\\bto\\s+${person}(?=\\W|$)`,'i').test(text):/发送|发给|寄给|\b(?:sent|send)\b/i.test(text);
}
const dayKey=(date:Date)=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
function day(year:number,month:number,date:number):Date|null {const value=new Date(year,month-1,date);return year>=1970&&year<=9999&&value.getFullYear()===year&&value.getMonth()===month-1&&value.getDate()===date?value:null;}
const shifted=(date:Date,days:number)=>new Date(date.getFullYear(),date.getMonth(),date.getDate()+days);
const numeral=(value:string)=>/^\d+$/.test(value)?Number(value):({'一':1,'二':2,'两':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10,'十四':14,'三十':30} as Record<string,number>)[value];

function timeClue(input:string,now:number){
 let text=input,error='';const intervals:{from:Date;to:Date}[]=[],today=new Date(new Date(now).getFullYear(),new Date(now).getMonth(),new Date(now).getDate());
 const add=(from:Date|null,to:Date|null)=>{if(!from||!to||from>=to){error='日期线索无效，请检查日期。';return;}intervals.push({from,to});};
 // Concrete dates are handled first, so "2026年10月20日" is not split into a month.
 const dates:Date[]=[],implicitYear=today.getFullYear()+(/去年|\blast year\b/i.test(input)?-1:0);
 text=text.replace(/(?<!\d)(?:(\d{4})[-/年])?(\d{1,2})[-/月](\d{1,2})(?:日|号)?(?!\d)/gu,(_all,y,m,d)=>{const date=day(Number(y??implicitYear),Number(m),Number(d));if(date)dates.push(date);else error='日期线索无效，请检查日期。';return ' ';});
 if(dates.length){const from=dates[0],last=dates.at(-1)!;add(from,shifted(last,1));}
 text=text.replace(/(?<!\d)(?:(\d{4})年)?(\d{1,2})月/gu,(_all,y,m)=>{const year=Number(y??implicitYear),month=Number(m);add(day(year,month,1),month===12?day(year+1,1,1):day(year,month+1,1));return ' ';});
 text=text.replace(/(?:最近|过去|近)\s*([\d一二三四五六七八九十两]+)\s*天|(?:past|last)\s+(\d+)\s+days?/gi,(_all,cn,en)=>{const count=numeral(cn??en);if(!count||count>3650)error='日期线索无效，请检查日期。';else add(shifted(today,1-count),shifted(today,1));return ' ';});
 text=text.replace(/(?:最近|过去|近)(?:一|1)(?:周|个星期)/gu,()=>{add(shifted(today,-6),shifted(today,1));return ' ';});
 text=text.replace(/(上(?:一)?|本|这)(?:周|星期)([一二三四五六日天1-7])?|\b(last|this)\s+week\b/giu,(_all,cn,weekday,en)=>{
   const monday=shifted(today,-((today.getDay()+6)%7)+(cn?.startsWith('上')||en==='last'?-7:0));
   if(weekday){const number=/\d/.test(weekday)?Number(weekday):'一二三四五六日天'.indexOf(weekday)+1;const from=shifted(monday,Math.min(number,7)-1);add(from,shifted(from,1));}else add(monday,shifted(monday,7));return ' ';
 });
 text=text.replace(/上(?:个)?月|上月|\blast month\b|本月|这(?:个)?月|\bthis month\b/giu,all=>{const month=today.getMonth()+(/上|last/i.test(all)?-1:0);add(new Date(today.getFullYear(),month,1),new Date(today.getFullYear(),month+1,1));return ' ';});
 text=text.replace(/前天|昨天|今天|\byesterday\b|\btoday\b/giu,all=>{const offset=/前天/.test(all)?-2:/昨天|yesterday/i.test(all)?-1:0;add(shifted(today,offset),shifted(today,offset+1));return ' ';});
 text=text.replace(/去年|今年|\blast year\b|\bthis year\b/giu,all=>{const year=today.getFullYear()+(/去年|last/i.test(all)?-1:0);add(new Date(year,0,1),new Date(year+1,0,1));return ' ';});
 let time:RecallTime|null=null;
 if(intervals.length){const from=Math.max(...intervals.map(range=>range.from.getTime())),to=Math.min(...intervals.map(range=>range.to.getTime()));if(from>=to)error='日期范围没有交集，请检查线索。';else time={from,to,label:`${dayKey(new Date(from))} — ${dayKey(shifted(new Date(to),-1))}`};}
 return {text,time,error};
}

export function parseRecallQuery(question:string,now=Date.now(),knownTags:string[]=[]):RecallQuery {
 const original=normalizeRecall(question).slice(0,200),date=timeClue(original,now);let text=date.text.replace(/报(?:过|了)(?:个|一份)?价/gu,'报价');
 const tags:string[]=[],required:string[]=[],quoted:string[]=[];
 text=text.replace(/#(?:"([^"]+)"|“([^”]+)”|([^\s#，,。？！?!；;]+))/gu,(_all,quoted,curly,plain)=>{
   const raw=tagName(quoted??curly??plain),short=raw.replace(/(?:的)?(?:相关)?(?:记录|笔记)$/u,'');
   const name=knownTags.find(tag=>tagKey(tag)===tagKey(raw))??knownTags.find(tag=>tagKey(tag)===tagKey(short))??raw;tags.push(name);return ' ';
 });
 text=text.replace(/["“「]([^"”」\r\n]{1,40})["”」]/gu,(_all,value)=>{required.push(value);quoted.push(value);return ' ';});
 const relation=relationClue(text);if(relation?.person)required.push(relation.person);
 for(const match of text.matchAll(/(?:和|跟|与|给|向|找)([\p{Script=Han}]{2,4}?)(?=一起|出去|出门|的|去|聊|吃|见|发|报|散|放松|估价)/gu))if(personWord(match[1]))required.push(match[1]);
 const subjects=text.replace(/关于|有关/g,' ');
 for(const match of subjects.matchAll(/(?:^|[\s，,])([\p{Script=Han}]{2,4})(?=的(?:报价|估价|记录|笔记|英语|旅行|计划|进展))/gu))if(personWord(match[1]))required.push(match[1]);
 for(const match of text.matchAll(/\b(?:with|for|to)\s+([a-z][a-z0-9_-]*)|\b([a-z][a-z0-9_-]*)'s\b/giu)){const subject=match[1]??match[2];if(!['the','a','an','my','our','me','you'].includes(subject))required.push(subject);}
 const active=groups.filter(group=>group.some(term=>containsRecallTerm(text,term)));
 const literal=/^[\p{Script=Han}\s]+$/u.test(text)&&text.trim().includes(' ')?text.trim().split(/\s+/).filter(term=>term.length>=2):[];
 text=text.replace(/我(?:们)?|之前|以前|当时|为什么|为何|怎么|怎样|什么|哪(?:条|些|个)|那(?:一)?次|这(?:一)?次|帮我|找回|找找|请问|有关|关于|决定|原因|记录|笔记|出去|出门|一起|来着|什么时候|最近|回顾|梳理|回看|全部|谁|收到|发送|是不是|是否|的|了|吗|呢|呀|？|\?|\b(?:why|what|when|who|did|decide|decision|reason|please|find|my|i|notes?|about|the|a|an|review|recap|all)\b/gi,' ');
 text=text.replace(/\b(?:on|in|at|of|for|to|from|with|was|were|is|are|do|does|have|has|had|it|its|and|or|that|this|these|those|me|our|your|my)\b/gi,' ');
 const chunks=text.match(/[\p{Script=Han}]+|[a-z0-9_-]{2,}/gu)??[],terms=new Set<string>();
 for(const chunk of chunks){if(/^[a-z0-9_-]+$/.test(chunk)){terms.add(chunk);continue;}if(chunk.length>=2)terms.add(chunk);for(let size=2;size<=Math.min(4,chunk.length);size++)for(let i=0;i+size<=chunk.length;i++)terms.add(chunk.slice(i,i+size));}
 return {text:original,terms:[...terms],groups:active,required:[...new Set(required)],quoted,literal,relation,tags:[...new Set(tags)],time:date.time,error:date.error};
}
