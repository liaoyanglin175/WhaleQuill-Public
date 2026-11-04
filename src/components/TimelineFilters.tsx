import { SlidersHorizontal, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { defaultTimelineRefinements } from '../domain/record-view';
import type { TimelineRefinements } from '../domain/record-view';
import { TagFilter } from './RecordTags';

export type TimelineFilterState = TimelineRefinements & { tag: string | null };
export const defaultTimelineFilters: TimelineFilterState = { ...defaultTimelineRefinements, tag: null };
export const timelineFilterCount = (value: TimelineFilterState) =>
  Number(value.days !== 'all') + Number(value.highlighted) + Number(!!value.tag);

const periods = [['all', '不限日期'], ['7', '最近 7 天'], ['30', '最近 30 天'], ['90', '最近 90 天']] as const;

export function TimelineFilters({ value, tags, onChange, busy, compact = false }: {
  value: TimelineFilterState;
  tags: { name: string; count: number }[];
  onChange: (next: TimelineFilterState) => void;
  busy: boolean;
  compact?: boolean;
}) {
  const { t } = useI18n();
  const count = timelineFilterCount(value);
  return <details className={`timeline-filter${compact ? ' list-filter-bar' : ''}`}>
    <summary><SlidersHorizontal size={14} />{count ? t('已筛选') : t(compact ? '筛选（可选）' : '筛选')}{count > 0 && <span className="timeline-filter-count">{count}</span>}</summary>
    <div className="timeline-filter-fields">
      <label className="timeline-date-filter">{t('记录日期')}
        <select value={value.days} disabled={busy} onChange={event => onChange({ ...value, days: event.target.value as TimelineRefinements['days'] })}>
          {periods.map(([key, label]) => <option value={key} key={key}>{t(label)}</option>)}
        </select>
      </label>
      <TagFilter tags={tags} value={value.tag} onChange={tag => onChange({ ...value, tag })} disabled={busy} />
      <label className="timeline-highlight-filter"><input type="checkbox" checked={value.highlighted} disabled={busy} onChange={event => onChange({ ...value, highlighted: event.target.checked })} />{t('有重点')}</label>
    </div>
  </details>;
}

export function TimelineFilterChips({ value, onClear, busy }: { value: TimelineFilterState; onClear: () => void; busy: boolean }) {
  const { t } = useI18n();
  const period = periods.find(([key]) => key === value.days);
  if (!timelineFilterCount(value)) return null;
  return <div className="timeline-filter-chips" aria-label={t('当前筛选')}>
    {value.days !== 'all' && period && <span>{t(period[1])}</span>}
    {value.highlighted && <span>{t('有重点')}</span>}
    <button type="button" className="text-button" onClick={onClear} disabled={busy}><X size={13} />{t('清除筛选')}</button>
  </div>;
}
