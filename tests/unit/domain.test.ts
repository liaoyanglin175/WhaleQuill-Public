import { describe, expect, it } from 'vitest';
import { createRecord, createTask, decodeArchive, encodeArchive, matchesQuery } from '../../src/domain/models';

describe('备份格式与来源关联', () => {
  it('往返保留中文正文、标签、类型、任务和来源', () => {
    const record = { ...createRecord('diary'), title: '今天的小事', body: '喝茶，读书。\n- 明天继续', tags: ['生活', '读书'] };
    const task = createTask('继续阅读', '2026-10-26', record.id);
    const workspace = { records: [record], tasks: [task] };
    const decoded = decodeArchive(encodeArchive(workspace));
    expect(decoded.version).toBe(1);
    if (decoded.version === 1) expect(decoded.workspace).toEqual(workspace);
  });
  it('拒绝损坏 JSON 和不支持的版本', () => {
    expect(() => decodeArchive('{坏了')).toThrow('JSON');
    const archive = JSON.parse(encodeArchive({ records: [], tasks: [] }));
    archive.version = 2;
    expect(() => decodeArchive(JSON.stringify(archive))).toThrow('备份格式不正确');
  });
  it('拒绝重复 ID 和悬空的来源关联', () => {
    const record = createRecord();
    const archive = JSON.parse(encodeArchive({ records: [record], tasks: [] }));
    archive.workspace.records.push(record);
    expect(() => decodeArchive(JSON.stringify(archive))).toThrow('重复 ID');
    archive.workspace.records = [];
    archive.workspace.tasks = [createTask('不存在的来源', null, record.id)];
    expect(() => decodeArchive(JSON.stringify(archive))).toThrow('来源记录不存在');
  });
  it('拒绝日历上不存在的截止日期', () => {
    expect(() => createTask('不合法日期', '2026-02-30')).toThrow();
  });
});

describe('关键词筛选', () => {
  const record = { ...createRecord('work'), title: '论文实验 ＡＢＣ', body: '本周复盘实验结果', tags: ['研究'] };
  it('支持中文正文、标签与全角大小写归一化', () => {
    expect(matchesQuery(record, '复盘 研究')).toBe(true);
    expect(matchesQuery(record, 'abc')).toBe(true);
    expect(matchesQuery(record, '未发生的事')).toBe(false);
  });
});
