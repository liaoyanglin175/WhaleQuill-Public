import { useI18n } from '../i18n';
import { ChevronRight, FilePenLine } from 'lucide-react';
import type { NoteRecord } from '../domain/models';
import { recordTitle } from '../domain/models';
import { groupRecordsByDate, recordPreview } from '../domain/record-view';
import {RecordTags} from './RecordTags';

export function RecordGroups({records,activeId,onOpen,onTag,compact=false,cards=false}:{records:NoteRecord[];activeId?:string|null;onOpen:(id:string)=>void;onTag?:(tag:string)=>void;compact?:boolean;cards?:boolean}) {
  const {locale,t}=useI18n();
  return <div className={`record-groups ${compact?'compact':''} ${cards?'card-layout':''}`}>
    {groupRecordsByDate(records).map(group=><section key={group.key} className="date-group" aria-label={t('{0}的记录',t(group.label))}>
      <h3 className="date-group-heading">{t(group.label)}<span>{group.records.length}</span></h3>
      <div className="date-group-items">{group.records.map(record=><article className="record-entry" key={record.id}>
        <button data-record-id={record.id} className={`record-card ${activeId===record.id?'selected':''}`} aria-current={activeId===record.id?'true':undefined} onClick={()=>onOpen(record.id)}>
          <div className="card-topline"><time dateTime={record.createdAt}>{cards?new Date(record.createdAt).toLocaleDateString(locale,{month:'short',day:'numeric'}):null}{cards?' · ':null}{new Date(record.createdAt).toLocaleTimeString(locale,{hour:'2-digit',minute:'2-digit'})}</time>{!!record.highlights.length&&<span className="highlight-count">{record.highlights.length}{t(' 处重点')}</span>}</div>
          {(!cards||!record.body.trim()||recordTitle({...record,title:'未命名记录'})!==record.title)&&<h2>{recordTitle(record)==='未命名记录'?t('未命名记录'):recordTitle(record)}</h2>}
          <p>{cards?Array.from(record.body.trim().slice(0,560)).slice(0,280).join('')||recordPreview(record):recordPreview(record)}</p>
        </button>
        {onTag&&<RecordTags tags={record.tags} onTag={onTag}/>}
      </article>)}</div>
    </section>)}
  </div>;
}

export function DraftRecords({ records, activeId, onOpen, searching = false }: { records: NoteRecord[]; activeId?: string | null; onOpen: (id: string) => void; searching?: boolean }) {
  const { t, locale } = useI18n();
  if (!records.length) return null;
  return <details className="draft-records" open={records.some((record) => record.id === activeId) || searching || undefined}><summary><FilePenLine size={14} /><span>{t("旧版空白记录")}</span><small>{records.length}</small><ChevronRight size={14} /></summary><div className="draft-items">{records.map((record) => <button key={record.id} className={`record-card draft-card ${activeId === record.id ? 'selected' : ''}`} onClick={() => onOpen(record.id)}><span>{t("空白记录")}</span><time dateTime={record.updatedAt}>{new Date(record.updatedAt).toLocaleDateString(locale, { month: '2-digit', day: '2-digit' })}</time></button>)}</div></details>;
}
