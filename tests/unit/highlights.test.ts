import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { createRecord, decodeArchive, encodeCompleteArchive, recordSchema } from '../../src/domain/models';
import { addHighlight, liveHighlights, reanchorHighlights, sourceOffset } from '../../src/domain/highlights';
import { BrowserRepository } from '../../src/storage/browser';

describe('划重点与可追溯回顾', () => {
  it('重复句子按选区定位，Windows 换行和表情保持 UTF-16 原文位置', () => {
    const record = { ...createRecord(), body: '😀开头\r\n同一句重点\r\n同一句重点' };
    const dom = record.body.replace(/\r\n/g, '\n'); const start = sourceOffset(record.body, dom.lastIndexOf('同一句重点'));
    const highlights = addHighlight(record, start, start + '同一句重点'.length);
    expect(highlights[0].start).toBe(record.body.lastIndexOf('同一句重点'));
    expect(recordSchema.parse({ ...record, highlights }).highlights).toEqual(highlights);
    expect(addHighlight({ ...record, highlights }, start, start + 5)).toHaveLength(1);
  });
  it('在前后添加文字会跟随原文，改动重点本身会标记待核对，不误引另一处相同句子', () => {
    const body = '前言\n重要决定\n后记\n重要决定';
    const record = { ...createRecord(), body }; const highlights = addHighlight(record, 3, 7);
    const next = '新增一行\n' + body;
    const moved = reanchorHighlights(body, next, highlights);
    expect(next.slice(moved[0].start, moved[0].end)).toBe('重要决定');
    const edited = next.replace('重要决定', '新的决定');
    const stale = { ...record, body: edited, highlights: reanchorHighlights(next, edited, moved) };
    expect(stale.highlights[0].stale).toBe(true); expect(liveHighlights(stale)).toHaveLength(0);
    expect(recordSchema.parse(stale).highlights[0].text).toBe('重要决定');
  });
  it('拒绝越界和伪造引用，同时兼容没有重点字段的旧记录', () => {
    const record = { ...createRecord(), body: '原文' };
    expect(() => addHighlight(record, -1, 2)).toThrow();
    const highlights = addHighlight(record, 0, 2);
    expect(() => recordSchema.parse({ ...record, highlights: [{ ...highlights[0], text: '杜撰' }] })).toThrow('重点与原文');
    const { highlights: omitted, ...legacy } = record;
    expect(recordSchema.parse(legacy).highlights).toEqual([]);
  });
  it('重点随保存、回收、完整备份与恢复保留；v2 仍能导入', async () => {
    const repo = new BrowserRepository('memory-' + crypto.randomUUID());
    const record = { ...createRecord(), body: '离线导出优先' }; record.highlights = addHighlight(record, 0, record.body.length);
    await repo.saveRecord(record); await repo.deleteRecord(record.id);
    const archive = decodeArchive(encodeCompleteArchive(await repo.exportSnapshot())); expect(archive.version).toBe(3);
    if (archive.version === 1) throw new Error('expected snapshot');
    const restored = new BrowserRepository('memory-restored-' + crypto.randomUUID()); await restored.mergeSnapshot(archive.snapshot);
    expect((await restored.load()).records).toHaveLength(0);
    await restored.restore('record', record.id); expect((await restored.load()).records[0].highlights).toEqual(record.highlights);
    const old = JSON.parse(encodeCompleteArchive({ records: [{ ...record, deletedAt: null }], tasks: [] })); old.version = 2; delete old.snapshot.records[0].highlights;
    const decoded = decodeArchive(JSON.stringify(old)); if (decoded.version !== 1) expect(decoded.snapshot.records[0].highlights).toEqual([]);
  });
});
