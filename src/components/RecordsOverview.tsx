import { useI18n } from '../i18n';
import { useMemo, useState } from 'react';
import { List, Maximize2, NotebookPen, Sparkles } from 'lucide-react';
import type { NoteRecord, Task } from '../domain/models';
import { partitionRecords } from '../domain/record-view';
import { DraftRecords, RecordGroups } from './RecordCollection';
import { ActiveTag } from './RecordTags';
import MemoryCues from './MemoryCues';
import TimeStarMap from './TimeStarMap';
import type { StarPosition } from './TimeStarMap';
import { defaultTimelineFilters, TimelineFilterChips, timelineFilterCount, TimelineFilters } from './TimelineFilters';
import type { TimelineFilterState } from './TimelineFilters';

export default function RecordsOverview({ records, allRecords, tasks, filters, query, busy, onFilters, onOpen, onRecall, availableTags, onTag, draftBody, draftError, saving, onDraftChange, onSaveDraft, onExpand, onComposing, starView, onStarView, starPosition, onStarPosition, blocked }: {
  records: NoteRecord[]; allRecords: NoteRecord[]; tasks: Task[]; filters: TimelineFilterState; query: string; busy: boolean;
  onFilters: (filters: TimelineFilterState) => void; onOpen: (id: string) => void;
  onRecall: (record: NoteRecord, selection?: { start: number; end: number }) => void;
  draftBody: string; draftError: string; saving: boolean; onDraftChange: (body: string) => void;
  onSaveDraft: () => void; onExpand: () => void; onComposing: (composing: boolean) => void;
  availableTags: { name: string; count: number }[]; onTag: (tag: string | null) => void;
  starView: boolean; onStarView: (value: boolean) => void;
  starPosition: StarPosition | null; onStarPosition: (position: StarPosition) => void; blocked: boolean;
}) {
  const { t } = useI18n();
  const [featuredId,setFeaturedId]=useState<string|null>(null);
  const [writing, setWriting] = useState(false);
  const { written, drafts } = useMemo(() => partitionRecords(records), [records]);
  const filtered = !!query || timelineFilterCount(filters) > 0;
  const recent = starView || filtered ? written : written.filter(record => record.id !== featuredId);
  return <section className="records-overview" data-star-view={starView} aria-label={t("记录总览")}>

    <div className="quick-capture"><label className="sr-only" htmlFor="quick-note">{t("随手记")}</label><textarea id="quick-note" value={draftBody} placeholder={t("此刻所想，随手记下。")} onChange={(event) => onDraftChange(event.target.value)} onFocus={() => setWriting(true)} onBlur={() => setWriting(false)} onCompositionStart={() => onComposing(true)} onCompositionEnd={() => onComposing(false)} spellCheck={false} /><div className="capture-footer"><span>{saving ? t("正在保存…") : draftBody.trim() ? t("尚未保存") : t("")}</span><div><button className="icon-button" aria-label={t("展开编辑")} title={t("展开编辑与划重点")} disabled={busy || saving} onClick={onExpand}><Maximize2 size={16} /></button><button data-floating-avoid className="button primary" disabled={busy || saving || !draftBody.trim()} onClick={onSaveDraft}>{saving ? t("正在保存…") : t("保存记录")}</button></div></div></div>
    {draftError && <p className="save-error" role="alert">{t(draftError)}</p>}
    {!starView && !filtered && <MemoryCues records={allRecords} onOpen={onRecall} onFeaturedChange={setFeaturedId} />}
    <div className="overview-recent-toolbar">
      <h2>{t(query ? '搜索结果' : !starView && featuredId && !filtered ? '其他记录' : '记录时间线')}<span aria-live="polite">{recent.length}</span></h2>
      <div className="timeline-actions">
        <div className="timeline-view-switch" role="group" aria-label={t('时间线视图')}>
          <button type="button" aria-pressed={!starView} onClick={() => onStarView(false)}><List size={14} />{t('列表')}</button>
          <button type="button" aria-pressed={starView} onClick={() => onStarView(true)}><Sparkles size={14} />{t('星图')}</button>
        </div>
        <TimelineFilters value={filters} tags={availableTags} onChange={onFilters} busy={busy} />
      </div>
    </div>
    <ActiveTag value={filters.tag} onClear={() => onFilters({ ...filters, tag: null })} disabled={busy} />
    <TimelineFilterChips value={filters} onClear={() => onFilters(defaultTimelineFilters)} busy={busy} />
    {starView
      ? <TimeStarMap key={`${filters.days}|${filters.highlighted}|${filters.tag}|${query}`} records={written} tasks={tasks} position={starPosition} onPosition={onStarPosition} onOpen={onOpen} busy={busy || blocked} writing={writing || saving} filtered={filtered} />
      : written.length ? <RecordGroups records={recent} onOpen={onOpen} onTag={onTag} cards />
      : <div className="overview-empty"><NotebookPen size={23} /><div><h3>{t(filtered ? '没有找到匹配的内容' : '你的记录，会慢慢汇成时间线')}</h3><p>{t(filtered ? '试试其他线索，或调整筛选。' : '先自由写下，想整理时再加标签。')}</p></div></div>}
    <DraftRecords records={drafts} onOpen={onOpen} searching={Boolean(query.trim())} />
  </section>;
}
