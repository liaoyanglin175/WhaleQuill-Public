import { useI18n } from '../i18n';
import { NotebookPen, Plus } from 'lucide-react';
import type { NoteRecord } from '../domain/models';
import { partitionRecords } from '../domain/record-view';
import { DraftRecords, RecordGroups } from './RecordCollection';
import { ActiveTag } from './RecordTags';
import { defaultTimelineFilters, TimelineFilterChips, timelineFilterCount, TimelineFilters } from './TimelineFilters';
import type { TimelineFilterState } from './TimelineFilters';

export default function RecordList({ records, activeId, query, busy, filters, onFilters, onOpen, onCreate, availableTags, onTag }: {
  records: NoteRecord[]; activeId: string | null; query: string; busy: boolean; filters: TimelineFilterState;
  onFilters: (filters: TimelineFilterState) => void; onOpen: (id: string) => void; onCreate: () => void;
  availableTags: { name: string; count: number }[]; onTag: (tag: string | null) => void;
}) {
  const { t } = useI18n();
  const { written, drafts } = partitionRecords(records);
  const filtered = !!query || timelineFilterCount(filters) > 0;
  return <section className="record-list" aria-label={t("记录列表")}><div className="list-heading"><span>{query ? t("搜索结果") : t("记录时间线")}<small>{records.length}</small></span><button className="icon-button" aria-label={t("新建记录")} title={t("新建记录")} disabled={busy} onClick={onCreate}><Plus size={17} /></button></div>
    <TimelineFilters value={filters} tags={availableTags} onChange={onFilters} busy={busy} compact />
    <ActiveTag value={filters.tag} onClear={() => onFilters({ ...filters, tag: null })} disabled={busy} />
    <TimelineFilterChips value={filters} onClear={() => onFilters(defaultTimelineFilters)} busy={busy} />
    <div className="record-list-scroll"><RecordGroups records={written} activeId={activeId} onOpen={onOpen} onTag={onTag} compact /><DraftRecords records={drafts} activeId={activeId} onOpen={onOpen} searching={Boolean(query.trim())} />{records.length === 0 && <div className="list-empty"><NotebookPen size={26} /><p>{t(filtered ? '还没有找到匹配的记录' : '这里等着你的第一条记录')}</p><span>{t(filtered ? '试试其他线索，或调整筛选。' : '点击上方加号，写下第一条记录。')}</span></div>}</div>
  </section>;
}
