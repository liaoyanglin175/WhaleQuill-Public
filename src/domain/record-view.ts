import type { NoteRecord } from './models';

export type TimelineRefinements = { days: 'all' | '7' | '30' | '90'; highlighted: boolean };
export const defaultTimelineRefinements: TimelineRefinements = { days: 'all', highlighted: false };
export type RecordGroup = { key: string; label: string; records: NoteRecord[] };

function mostRecent(a: NoteRecord, b: NoteRecord): number {
  return Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id);
}

export function isBlankDraft(record: NoteRecord): boolean {
  return (!record.title.trim() || record.title.trim() === '未命名记录') && !record.body.trim() && record.tags.length === 0 && record.highlights.length === 0;
}

export function partitionRecords(records: NoteRecord[]) {
  const sorted = [...records].sort(mostRecent);
  return { written: sorted.filter((record) => !isBlankDraft(record)), drafts: sorted.filter(isBlankDraft) };
}

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function matchesTimeline(record: NoteRecord, filters: TimelineRefinements, now = new Date()): boolean {
  if (filters.highlighted && !record.highlights.some(highlight => !highlight.stale)) return false;
  if (filters.days === 'all') return true;
  const age = calendarDay(now) - calendarDay(new Date(record.createdAt));
  return age >= 0 && age < Number(filters.days);
}

export function groupRecordsByDate(records: NoteRecord[], now = new Date()): RecordGroup[] {
  const groups = new Map<string, RecordGroup>();
  for (const record of [...records].sort(mostRecent)) {
    const date = new Date(record.createdAt);
    const age = calendarDay(now) - calendarDay(date);
    const key = age === 0 ? 'today' : age === 1 ? 'yesterday' : `${date.getFullYear()}-${date.getMonth() + 1}`;
    const label = age === 0 ? '今天' : age === 1 ? '昨天' : `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
    const group = groups.get(key) ?? { key, label, records: [] };
    group.records.push(record);
    groups.set(key, group);
  }
  return [...groups.values()];
}

export function recordPreview(record: NoteRecord): string {
  return Array.from(record.body.trim().split(/\r?\n/, 1)[0].replace(/^[#>*-]+\s*/, '').slice(0,560)).slice(0,280).join('') || '仅标题记录';
}
