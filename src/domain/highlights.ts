import type { Highlight, NoteRecord } from './models';

export function addHighlight(record: NoteRecord, start: number, end: number): Highlight[] {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > record.body.length) throw new Error('请先选中正文中的一段话。');
  const selected = record.body.slice(start, end);
  const text = selected.trim();
  start += selected.length - selected.trimStart().length;
  end = start + text.length;
  if (!text || text.length > 4000 || record.highlights.length >= 200) throw new Error('请选中 1–4000 个字符；每条记录最多保留 200 处重点。');
  if (record.highlights.some((highlight) => !highlight.stale && highlight.start === start && highlight.end === end)) return record.highlights;
  return [...record.highlights, { id: crypto.randomUUID(), start, end, text, createdAt: new Date().toISOString(), stale: false }];
}

export function reanchorHighlights(before: string, after: string, highlights: Highlight[]): Highlight[] {
  if (before === after || !highlights.length) return highlights;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  const delta = newEnd - oldEnd;
  return highlights.map((highlight) => {
    if (highlight.stale) return highlight;
    const next = highlight.end <= start ? highlight : highlight.start >= oldEnd ? { ...highlight, start: highlight.start + delta, end: highlight.end + delta } : { ...highlight, stale: true };
    return !next.stale && after.slice(next.start, next.end) !== next.text ? { ...next, stale: true } : next;
  });
}

export function liveHighlights(record: NoteRecord): Highlight[] {
  return record.highlights.filter((highlight) => !highlight.stale && record.body.slice(highlight.start, highlight.end) === highlight.text);
}

// Textarea selections use LF and UTF-16 offsets; stored Windows text may use CRLF.
export function sourceOffset(body: string, domOffset: number): number {
  let source = 0, dom = 0;
  while (source < body.length && dom < domOffset) {
    source += body[source] === '\r' && body[source + 1] === '\n' ? 2 : 1;
    dom++;
  }
  return source;
}

