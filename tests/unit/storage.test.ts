import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserRepository } from '../../src/storage/browser';
import { createRecord, createTask } from '../../src/domain/models';

afterEach(() => vi.restoreAllMocks());
const repository = () => new BrowserRepository(`test-${crypto.randomUUID()}`);

describe('本地记录与任务存储', () => {
  it('重新打开同一个数据库后仍保留编辑结果与完成状态', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const first = new BrowserRepository(name);
    const record = createRecord('work');
    await first.saveRecord(record);
    await first.saveRecord({ ...record, title: '实验复盘', body: '第一次实验完成' });
    const task = { ...createTask('整理结果', '2026-10-26', record.id), status: 'done' as const };
    await first.saveTask(task);
    const committed=(await first.load()).tasks;
    const reloaded = await new BrowserRepository(name).load();
    expect(reloaded.records[0].title).toBe('实验复盘');
    expect(reloaded.tasks).toEqual(committed);expect(reloaded.tasks[0].status).toBe('done');expect(reloaded.tasks[0].completedAt).not.toBeNull();
  });
  it('删除记录保留任务并解除关联', async () => {
    const repo = repository();
    const record = createRecord();
    const task = createTask('继续推进', null, record.id);
    await repo.saveRecord(record);
    await repo.saveTask(task);
    await repo.deleteRecord(record.id);
    const state = await repo.load();
    expect(state.records).toHaveLength(0);
    expect(state.tasks).toEqual([{ ...task, sourceRecordId: null }]);
  });
  it('拒绝悬空任务并保持数据库不变', async () => {
    const repo = repository();
    await expect(repo.saveTask(createTask('悬空任务', null, crypto.randomUUID()))).rejects.toThrow('来源记录');
    expect((await repo.load()).tasks).toEqual([]);
  });
  it('回收站跨实例保留内容，按任意顺序恢复任务与记录均找回来源', async () => {
    const name = `test-${crypto.randomUUID()}`;
    const repo = new BrowserRepository(name);
    const record = { ...createRecord(), title: '可找回的笔记' };
    const task = createTask('关联待办', null, record.id);
    await repo.saveRecord(record); await repo.saveTask(task);
    await repo.deleteTask(task.id); await repo.deleteRecord(record.id);
    const reopened = new BrowserRepository(name);
    expect(await reopened.loadTrash()).toHaveLength(2);
    await reopened.restore('task', task.id);
    expect((await reopened.load()).tasks[0].sourceRecordId).toBeNull();
    await reopened.restore('record', record.id);
    const restored=await reopened.load();expect(restored.records).toEqual([record]);expect(restored.tasks).toEqual([{...task,updatedAt:expect.any(String)}]);
    await expect(reopened.restore('record', record.id)).rejects.toThrow('未覆盖');
  });
  it('删除后编辑任务不会被恢复操作覆盖，也拒绝旧编辑器复活回收站内容', async () => {
    const repo = repository();
    const record = createRecord(); const task = createTask('原任务', null, record.id);
    await repo.saveRecord(record); await repo.saveTask(task); await repo.deleteRecord(record.id);
    await expect(repo.saveRecord({ ...record, title: '过期编辑器' })).rejects.toThrow('回收站');
    await repo.saveTask({ ...(await repo.load()).tasks[0], title: '已重新安排' });
    await repo.restore('record', record.id);
    expect((await repo.load()).tasks[0]).toMatchObject({ title: '已重新安排', sourceRecordId: null });
  });
  it('导入只覆盖同 ID，保留原有其他条目', async () => {
    const repo = repository();
    const original = createRecord();
    const retained = createRecord();
    await repo.saveRecord(original);
    await repo.saveRecord(retained);
    await repo.mergeWorkspace({ records: [{ ...original, title: '备份中的标题' }], tasks: [] });
    const state = await repo.load();
    expect(state.records).toHaveLength(2);
    expect(state.records.find((record) => record.id === original.id)?.title).toBe('备份中的标题');
    expect(state.records.find((record) => record.id === retained.id)).toEqual(retained);
  });
  it('导入中途失败时回滚已写入的记录', async () => {
    const repo = repository();
    const record = createRecord();
    await repo.saveRecord(record);
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { title?: string }).title === '模拟故障') throw new DOMException('模拟写入失败', 'DataError');
      return originalPut.call(this, value, key);
    });
    const task = createTask('模拟故障', null, record.id);
    await expect(repo.mergeWorkspace({ records: [{ ...record, title: '不应留下的修改' }], tasks: [task] })).rejects.toThrow('模拟写入失败');
    const state = await repo.load();
    expect(state.records).toEqual([record]);
    expect(state.tasks).toEqual([]);
  });
  it('完整备份在全新数据库恢复回收站、状态与原始来源，恢复记录后关联可找回', async () => {
    const original = repository();
    const record = { ...createRecord('work'), title: '在回收站的来源' };
    const task = createTask('保留关联', '2026-11-01', record.id);
    const deletedTask = createTask('已删除任务', null, record.id);
    await original.saveRecord(record); await original.saveTask(task); await original.saveTask(deletedTask);
    await original.deleteTask(deletedTask.id); await original.deleteRecord(record.id);
    const snapshot = await original.exportSnapshot();
    expect(snapshot.tasks.find((item) => item.id === task.id)?.sourceRecordId).toBe(record.id);
    const fresh = repository();
    await fresh.mergeSnapshot(snapshot);
    expect(await fresh.loadTrash()).toHaveLength(2);
    expect((await fresh.load()).tasks[0].sourceRecordId).toBeNull();
    await fresh.restore('record', record.id); await fresh.restore('task', deletedTask.id);
    const state = await fresh.load();
    expect(state.records).toEqual([record]);
    expect(state.tasks).toContainEqual(task); expect(state.tasks).toContainEqual({...deletedTask,updatedAt:expect.any(String)});
  });
  it('完整备份导入失败时连同删除状态一起回滚', async () => {
    const repo = repository(); const record = createRecord();
    await repo.saveRecord(record); await repo.deleteRecord(record.id);
    const before = await repo.exportSnapshot();
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if ((value as { title?: string }).title === '完整备份写入故障') throw new DOMException('完整备份写入故障', 'DataError');
      return originalPut.call(this, value, key);
    });
    await expect(repo.mergeSnapshot({ records: [{ ...record, title: '不得保留', deletedAt: null }], tasks: [{ ...createTask('完整备份写入故障', null, record.id), deletedAt: null }] })).rejects.toThrow('完整备份写入故障');
    expect(await repo.exportSnapshot()).toEqual(before);
  });
});
