import {useMemo,useState} from 'react';
import {createPortal} from 'react-dom';
import type {NoteRecord} from '../domain/models';
import {recordTitle} from '../domain/models';
import {collectTags} from '../domain/tags';
import {historyReview,reviewSources,type ReviewFilter,type ReviewEntry} from '../domain/history-review';
import type {MemoryPeriod,MemorySource} from '../domain/memory-context';
import {useI18n} from '../i18n';
import RecallClues from './RecallClues';

export default function HistoryReview({host,records,onSource,onDiscuss}:{host?:HTMLElement|null;records:NoteRecord[];onSource:(entry:ReviewEntry)=>void;onDiscuss:(question:string,sources:MemorySource[],label:string)=>void}){
 const {t,locale,language}=useI18n();const [query,setQuery]=useState(''),[tag,setTag]=useState(''),[period,setPeriod]=useState<MemoryPeriod>('all');
 const [submitted,setSubmitted]=useState<ReviewFilter|null>(null),[initialSignature,setInitialSignature]=useState('');
 const result=useMemo(()=>submitted?historyReview(records,submitted):null,[records,submitted]);
 const tags=useMemo(()=>collectTags(records),[records]);
 const date=(value:string)=>new Date(value).toLocaleDateString(locale);
 function run(){const filter={query:query.trim(),tag:tag||null,period,now:Date.now()};setSubmitted(filter);setInitialSignature(historyReview(records,filter).signature);}
 const first=result?.entries[0],last=result?.entries.at(-1);
 if(host===null)return null;
 const content=<div className="history-review">
  <form className="history-review-form" onSubmit={event=>{event.preventDefault();run();}}>
   <label className="sr-only" htmlFor="review-topic">{t('回顾线索')}</label><input id="review-topic" value={query} maxLength={200} placeholder={t('想回看哪件事？线索可选')} onChange={event=>setQuery(event.target.value)}/>
   <div><select aria-label={t('回顾标签')} value={tag} onChange={event=>setTag(event.target.value)}><option value="">{t('全部标签')}</option>{tags.map(item=><option key={item.name} value={item.name}>{item.name}</option>)}</select><select aria-label={t('回顾记录范围')} value={period} onChange={event=>setPeriod(event.target.value as MemoryPeriod)}><option value="all">{t('全部已保存记录')}</option><option value="week">{t('最近7天')}</option><option value="month">{t('最近30天')}</option></select><button className="button primary" disabled={!records.length}>{t('回顾')}</button></div>
  </form>
  <div className="history-review-content">
   {!submitted&&<p className="inquiry-hint">{t('选一个主题，或回看一段时间里的记录。')}</p>}
   {submitted&&<RecallClues question={submitted.query} now={submitted.now} tags={records.flatMap(record=>record.tags)}/>}
   {result&&initialSignature!==result.signature&&<p className="inquiry-hint" role="status">{t('来源已变化，已按最新保存的记录更新。')}</p>}
   {result&&!result.error&&!result.total&&<p className="inquiry-hint">{t('这次没有找到相关记录。试试另一个时间或线索。')}</p>}
   {result&&first&&last&&<>
    <div className="history-overview" role="region" aria-label={t('原文脉络')}><h3>{t('原文脉络')}</h3><p>{t('找到 {0} 条相关记录',result.total)}</p>
     <button onClick={()=>onSource(first)}><span>{t('最早 · {0}',date(first.record.createdAt))} [{first.reference}]</span><q>{first.quote.text||recordTitle(first.record)}</q></button>
     {last!==first&&<button onClick={()=>onSource(last)}><span>{t('最近 · {0}',date(last.record.createdAt))} [{last.reference}]</span><q>{last.quote.text||recordTitle(last.record)}</q></button>}
    </div>
    {result.total>result.entries.length&&<p className="inquiry-hint">{t('当前展示最早和最近的 {0} 条，共 {1} 条。',result.entries.length,result.total)}</p>}
    <ol className="history-timeline" aria-label={t('主题记录时间线')}>{result.entries.map(entry=><li key={entry.record.id}><time dateTime={entry.record.createdAt}>{t('记录于 ')}{date(entry.record.createdAt)}</time><h3>{recordTitle(entry.record)}</h3>{entry.quote.text&&<blockquote>{entry.quote.text}</blockquote>}<button className="text-button" onClick={()=>onSource(entry)}>{t('查看原文')} [{entry.reference}]</button></li>)}</ol>
    <button className="button secondary review-discuss" onClick={()=>{
      const label=submitted?.tag?`#${submitted.tag}`:submitted?.query||t('这段时间');
      const question=language==='en'?`Help me review “${label}” using only these excerpts. What is explicitly recorded at different times? Distinguish quotes from interpretation.`:`沿着「${label}」，帮我回顾这些原文里记录的经过和变化，区分原话与归纳。`;
      onDiscuss(question,reviewSources(result.entries),label);
    }}>{t('和大肥鱼聊聊这段经历')}</button><p className="inquiry-hint">{t('继续讨论前会预览最多5条原文，不会自动发送。')}</p>
   </>}
  </div>
 </div>;
 return host?createPortal(content,host):content;
}
