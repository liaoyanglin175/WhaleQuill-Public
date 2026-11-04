import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createRecord } from '../../src/domain/models';
import { readRecovery, writeRecovery } from '../../src/storage/recovery';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const values = new Map<string, string>();
beforeEach(() => {
  values.clear(); vi.mocked(invoke).mockReset();
  vi.stubGlobal('localStorage', {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('异常恢复副本', () => {
  it('保留暂时不符合保存校验的标题和标签，并隔离浏览器与桌面空间', async () => {
    const record = { ...createRecord(), title: '', tags: ['超过标签长度限制的文字'.repeat(8)] };
    writeRecovery('browser', record.id, record);
    expect((await readRecovery('browser'))[0].record).toEqual(record);
    vi.mocked(invoke).mockResolvedValue([]);
    expect(await readRecovery('desktop')).toEqual([]);
  });
  it('原生恢复读取接受带 UTC 偏移的时间，并在 WebView 存储不可用时工作', async () => {
    const entry = { record: createRecord(), savedAt: '2026-10-26T08:00:00+08:00' };
    vi.stubGlobal('localStorage', { get length() { throw new Error('WebView storage unavailable'); } });
    vi.mocked(invoke).mockResolvedValue([entry]);
    expect(await readRecovery('desktop')).toEqual([entry]);
    await writeRecovery('desktop', entry.record.id, entry.record);
    expect(invoke).toHaveBeenLastCalledWith('write_recovery', { id: entry.record.id, record: entry.record });
  });
  it('桌面恢复写入按顺序完成，保存后的清理不会被旧写入覆盖', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    vi.mocked(invoke).mockImplementationOnce(() => gate).mockResolvedValue(undefined);
    const record = createRecord();
    const first = writeRecovery('desktop', record.id, { ...record, body: 'A' });
    await Promise.resolve(); await Promise.resolve();
    const second = writeRecovery('desktop', record.id, { ...record, body: 'AB' });
    const clearing = writeRecovery('desktop', record.id, null);
    release(); await Promise.all([first, second, clearing]);
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('write_recovery', { id: record.id, record: null });
    expect(values.size).toBe(0);
  });
});
