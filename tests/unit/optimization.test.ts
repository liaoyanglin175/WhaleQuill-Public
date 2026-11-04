import { describe, expect, it } from 'vitest';
import { createRecord, createTask, decodeArchive, encodeCompleteArchive, fullSnapshotSchema } from '../../src/domain/models';
import { recallRecords } from '../../src/domain/recall';
import { extractTaskCandidates, markdownDocument, markdownFilename } from '../../src/domain/task-extraction';

describe('完整备份格式', () => {
  it('保留删除状态与指向回收站记录的原始任务来源', () => {
    const record = { ...createRecord('work'), deletedAt: '2026-10-26T01:00:00Z' };
    const task = { ...createTask('验证导出', null, record.id), deletedAt: null };
    const snapshot = { records: [record], tasks: [task] };
    const archive = decodeArchive(encodeCompleteArchive(snapshot));
    expect(archive.version).toBe(3);
    if (archive.version === 3) expect(archive.snapshot).toEqual(snapshot);
  });
  it('拒绝重复 ID、悬空来源与不合法删除时间', () => {
    const record = { ...createRecord(), deletedAt: null };
    expect(() => fullSnapshotSchema.parse({ records: [record, record], tasks: [] })).toThrow();
    expect(() => fullSnapshotSchema.parse({ records: [], tasks: [{ ...createTask('悬空', null, record.id), deletedAt: null }] })).toThrow();
    expect(() => fullSnapshotSchema.parse({ records: [{ ...record, deletedAt: 'yesterday' }], tasks: [] })).toThrow();
  });
});

describe('带出处的本地原文找回', () => {
  const decision = { ...createRecord('work'), title: '同步方案决策', body: '今天决定不做云同步，先把本地自动保存做好。\n原因：用户更在意离线隐私。\n下周任务：验证导出。' };
  it('问题可定位决策及原因，引用与源文范围严格一致', () => {
    const results = recallRecords([decision, { ...createRecord(), title: '散步', body: '今天去公园。' }], '我之前为什么决定不做云同步？');
    expect(results.map((result) => result.record.id)).toEqual([decision.id]);
    expect(results[0].quotes.some((quote) => quote.text.includes('原因：用户更在意离线隐私'))).toBe(true);
    for (const quote of results[0].quotes) expect(decision.body.slice(quote.start, quote.end)).toBe(quote.text);
  });
  it('没有依据时返回空结果，不用通用短语勉强匹配', () => {
    expect(recallRecords([decision], '我之前为什么决定去火星？')).toEqual([]);
    expect(recallRecords([decision], '为什么？')).toEqual([]);
    expect(recallRecords([{ ...createRecord(), body: '这件事情我不做。' }], '为什么不做云同步？')).toEqual([]);
  });
  it('多行、空行及 CRLF 的引用位置可以准确定位', () => {
    const record = { ...decision, body: '\r\n项目 Alpha 复盘。\r\n原因：Alpha 数据尚未确认。' };
    const result = recallRecords([record], 'Alpha 的原因')[0];
    expect(result).toBeDefined();
    result.quotes.forEach((quote) => expect(record.body.slice(quote.start, quote.end)).toBe(quote.text));
  });
  it('不把同一篇记录中另一个决定的原因拼接到当前结果', () => {
    const record = { ...decision, body: '今天决定不做云同步。\n先保留本地方案。\n\n另一个项目暂缓上线。\n原因：另一个项目预算不足。' };
    const result = recallRecords([record], '为什么不做云同步？')[0];
    expect(result.quotes.some((quote) => quote.text.includes('预算不足'))).toBe(false);
  });
});

describe('正文待办与内容导出', () => {
  it('只提取明确待办，排除已完成项、普通叙述和重复待办', () => {
    const body = '今天完成实验。\n- [ ] 核对数据\n- [x] 已完成的工作\n下周任务：验证导出\n下一步: 整理对照组\n- [ ] 核对数据';
    expect(extractTaskCandidates(body)).toEqual([{ title: '核对数据', line: 2 }, { title: '验证导出', line: 4 }, { title: '整理对照组', line: 5 }]);
  });
  it('Markdown 导出保留正文与标签，文件名移除 Windows 非法字符', () => {
    expect(markdownDocument('测试', '## 原文\n- [ ] 保留内容', ['研究'])).toBe('# 测试\n\n标签：研究\n\n## 原文\n- [ ] 保留内容\n');
    expect(markdownFilename('项目: A/B?')).toBe('项目_ A_B_.md');
    expect(markdownFilename('CON')).toBe('_CON.md');
  });
});
