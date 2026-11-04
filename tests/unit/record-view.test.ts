import { describe, expect, it } from 'vitest';
import { createRecord,recordTitle,matchesQuery } from '../../src/domain/models';
import { groupRecordsByDate, isBlankDraft, partitionRecords,recordPreview } from '../../src/domain/record-view';

describe('记录浏览分组', () => {
  it('百万字原稿只生成有界预览，emoji完整且不改变正文',()=>{const record={...createRecord(),body:'🐟'.repeat(500000)},body=record.body;expect(recordTitle(record)).toBe('🐟'.repeat(60));expect(recordPreview(record)).toBe('🐟'.repeat(280));expect(matchesQuery(record,'  ')).toBe(true);expect(record.body).toBe(body);});
  it('只折叠没有正文、标签或自定义标题的空白记录', () => {
    const blank = createRecord();
    expect(isBlankDraft(blank)).toBe(true);
    expect(isBlankDraft({ ...blank, body: '未命名，但有实际内容' })).toBe(false);
    expect(isBlankDraft({ ...blank, title: '稍后补充内容' })).toBe(false);
    expect(isBlankDraft({ ...blank, tags: ['待整理'] })).toBe(false);
    const partitioned = partitionRecords([blank, { ...createRecord(), body: '真实内容' }]);
    expect(partitioned.drafts).toHaveLength(1);
    expect(partitioned.written).toHaveLength(1);
  });

  it('按本地日历分成今天、昨天和更早月份，并保持倒序', () => {
    const record = createRecord();
    const today = { ...record, id: crypto.randomUUID(), createdAt: new Date(2026, 9, 25, 8).toISOString() };
    const yesterday = { ...record, id: crypto.randomUUID(), createdAt: new Date(2026, 9, 24, 23, 59).toISOString() };
    const older = { ...record, id: crypto.randomUUID(), createdAt: new Date(2026, 8, 15, 12).toISOString() };
    const groups = groupRecordsByDate([older, yesterday, today], new Date(2026, 9, 25, 12));
    expect(groups.map((group) => group.label)).toEqual(['今天', '昨天', '2026 年 9 月']);
    expect(groups.flatMap((group) => group.records)).toEqual([today, yesterday, older]);
  });

  it('月初的昨天仍属于昨天，整理展示时不修改输入顺序或数据', () => {
    const previous = { ...createRecord(), createdAt: new Date(2026, 8, 30, 22).toISOString() };
    const current = { ...createRecord(), createdAt: new Date(2026, 9, 1, 8).toISOString() };
    const records = [previous, current];
    const before = structuredClone(records);
    expect(groupRecordsByDate(records, new Date(2026, 9, 1, 9)).map((group) => group.label)).toEqual(['今天', '昨天']);
    partitionRecords(records);
    expect(records).toEqual(before);
  });

  it('导入含不同时区偏移的时间戳时按实际时间排序', () => {
    const later = { ...createRecord(), title: '实际较晚', createdAt: '2026-10-25T10:00:00Z' };
    const earlier = { ...createRecord(), title: '实际较早', createdAt: '2026-10-25T17:00:00+08:00' };
    expect(partitionRecords([earlier, later]).written).toEqual([later, earlier]);
    expect(groupRecordsByDate([earlier, later]).flatMap((group) => group.records)).toEqual([later, earlier]);
  });
});
