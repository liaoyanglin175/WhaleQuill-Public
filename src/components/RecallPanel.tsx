import {useState} from 'react';
import type {NoteRecord} from '../domain/models';
import {useI18n} from '../i18n';
import MemoryCues from './MemoryCues';
import HistoryReview from './HistoryReview';
import RecallMemories from './RecallMemories';
import {Search} from 'lucide-react';

export default function RecallPanel({records,onOpen,active}:{records:NoteRecord[];active:boolean;onOpen:(record:NoteRecord,selection?:{start:number;end:number})=>void}){
 const {t}=useI18n(),[tab,setTab]=useState<'old'|'highlights'|'themes'>('old'),[query,setQuery]=useState('');
 return <section hidden={!active} className="recall-panel recall-hub" aria-label={t('回顾记录')}>
  <header className="recall-bar"><div className="recall-tabs" role="tablist" aria-label={t('回顾方式')}>{(['old','highlights','themes'] as const).map(value=><button key={value} role="tab" aria-selected={tab===value} aria-controls={'recall-'+value} onClick={()=>setTab(value)}>{t({old:'旧事',highlights:'重点',themes:'主题'}[value])}</button>)}</div><button className="text-button recall-find" aria-label={t('查找其他记录')} onClick={()=>window.dispatchEvent(new Event('dafeiyu-find'))}><Search size={15}/>{t('找记录')}</button></header>
  <div id="recall-old" role="tabpanel" hidden={tab!=='old'}><RecallMemories records={records} onOpen={onOpen}/></div>
  <div id="recall-highlights" role="tabpanel" hidden={tab!=='highlights'}><label className="sr-only" htmlFor="highlight-filter">{t('筛选重点')}</label><input id="highlight-filter" value={query} onChange={event=>setQuery(event.target.value)} placeholder={t('找一句重点…')}/>{active&&tab==='highlights'&&<MemoryCues records={records} all query={query} onOpen={onOpen}/>}</div>
  <div id="recall-themes" role="tabpanel" hidden={tab!=='themes'}><HistoryReview records={records} onSource={entry=>window.dispatchEvent(new CustomEvent('dafeiyu-preview-source',{detail:{recordId:entry.record.id,quote:entry.quote}}))} onDiscuss={(text,sources,label)=>window.dispatchEvent(new CustomEvent('dafeiyu-review-discuss',{detail:{text,sources,label}}))}/></div>
 </section>;
}
