import {useMemo,useState} from 'react';
import {ArrowUpRight,MoreHorizontal} from 'lucide-react';
import {useI18n} from '../i18n';
import {recordTitle} from '../domain/models';
import type {NoteRecord} from '../domain/models';
import {plannerDay} from '../domain/planner';

function excerpt(record:NoteRecord):string{
 const body=record.body.trim(),title=recordTitle(record),lines=body.split(/\r?\n/);
 const content=lines[0]?.trim()===title?lines.slice(1).join('\n').trim():body;
 return Array.from(content).slice(0,220).join('')+(Array.from(content).length>220?'…':'');
}
export default function RecallMemories({records,onOpen}:{records:NoteRecord[];onOpen:(record:NoteRecord)=>void}){
 const {t,locale}=useI18n(),[selected,setSelected]=useState<string|null>(null),[omitted,setOmitted]=useState<string[]>([]),[limit,setLimit]=useState(12),today=plannerDay();
 const sorted=useMemo(()=>records.filter(record=>record.body.trim()||record.title!=='未命名记录').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),[records]);
 const available=sorted.filter(record=>!omitted.includes(record.id)),older=available.filter(record=>plannerDay(new Date(record.createdAt))<today),pool=older.length?older:available;
 const featured=pool.find(record=>record.id===selected)??pool[0];
 const others=available.filter(record=>record.id!==featured?.id);
 const date=(record:NoteRecord)=>new Date(record.createdAt).toLocaleDateString(locale,{year:'numeric',month:'long',day:'numeric'});
 function next(){if(!featured)return;const index=pool.findIndex(record=>record.id===featured.id);setSelected(pool[(index+1)%pool.length]?.id??null);}
 return <div className="recall-memories">
  {featured?<><div className="recall-feature-heading"><h2>{t(older.length?'重读一页':'最近留下的记录')}</h2><div><button className="text-button" disabled={pool.length<2} onClick={next}>{t('换一条')}</button><details className="recall-item-menu"><summary aria-label={t('回忆操作')}><MoreHorizontal size={17}/></summary><div><button onClick={event=>{setOmitted(ids=>[...ids,featured.id]);event.currentTarget.closest('details')!.open=false;}}>{t('本次略过')}</button></div></details></div></div>
   <article className="recall-feature" data-record-id={featured.id}><time dateTime={featured.createdAt}>{date(featured)}</time><h3>{recordTitle(featured)}</h3>{excerpt(featured)&&<p>{excerpt(featured)}</p>}<button className="text-button" onClick={()=>onOpen(featured)}>{t('打开记录')}<ArrowUpRight size={14}/></button></article>
   {others.length>0&&<section className="recall-other"><h2>{t('继续翻阅')}</h2><div>{others.slice(0,limit).map(record=><button className="recall-history-row" key={record.id} onClick={()=>onOpen(record)}><time dateTime={record.createdAt}>{date(record)}</time><span>{recordTitle(record)}</span>{excerpt(record)&&<p>{excerpt(record)}</p>}<ArrowUpRight size={14}/></button>)}</div>{others.length>limit&&<button className="text-button" onClick={()=>setLimit(value=>value+12)}>{t('再看一些')}</button>}</section>}
  </>:<div className="recall-empty"><p>{t(sorted.length?'本次先看到这里。':'写下一条，留待日后翻阅。')}</p>{sorted.length>0&&<button className="text-button" onClick={()=>setOmitted([])}>{t('重新翻阅')}</button>}</div>}
 </div>;
}
