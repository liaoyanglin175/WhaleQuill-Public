import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRecord } from '../../src/domain/models';
import { EditorSession } from '../../src/domain/editor-session';
import { addHighlight } from '../../src/domain/highlights';
afterEach(() => vi.useRealTimers());
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };

describe('手动保存与输入竞争', () => {
  it('等待已在进行的保存，不会把保存期间的新输入一并提交',async()=>{
    const gate=deferred(),persist=vi.fn().mockImplementation(()=>gate.promise),session=new EditorSession(createRecord(),true,persist);session.update({body:'点击保存时的内容'});void session.save();session.update({body:'后来的输入仍待决定'});const waiting=session.waitForPendingSave();gate.resolve();await waiting;expect(persist).toHaveBeenCalledTimes(1);expect(persist.mock.calls[0][0].body).toBe('点击保存时的内容');expect(session.getSnapshot().dirty).toBe(true);session.dispose();
  });
  it('排版记忆字段顺序经过校验变化后，显式保存仍正确成为已保存', async () => {
    const session=new EditorSession(createRecord(),true,vi.fn().mockResolvedValue(undefined));
    session.update({body:'原话',document:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'原话'}]}]},highlights:[{id:crypto.randomUUID(),start:0,end:2,createdAt:new Date().toISOString(),text:'原话',stale:false}]});
    expect(await session.save()).toBe(true);expect(session.getSnapshot()).toMatchObject({dirty:false,status:'saved'});session.dispose();
  });
  it('正文被清空但仍有待核对重点时，不视为可静默丢弃的空白', async () => {
    const persist = vi.fn();
    const session = new EditorSession(createRecord(), true, persist);
    session.update({ body: '重要决定' });
    session.update({ highlights: addHighlight(session.getSnapshot().record, 0, 4) });
    session.update({ body: '' });
    expect(session.getSnapshot()).toMatchObject({ dirty: true, record: { highlights: [expect.objectContaining({ text: '重要决定', stale: true })] } });
    expect(await session.save()).toBe(true);
    expect(persist.mock.calls[0][0].highlights[0].text).toBe('重要决定');
    session.dispose();
  });
  it('输入、划重点和等待都不落库，也不写恢复副本', async () => {
    vi.useFakeTimers();
    const persist = vi.fn(), recovery = vi.fn();
    const session = new EditorSession(createRecord(), true, persist, recovery);
    session.update({ body: '只是试写，还没决定保存' });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(persist).not.toHaveBeenCalled(); expect(recovery).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ dirty: true, status: 'pending' });
    await session.discard(); expect(persist).not.toHaveBeenCalled();
    expect(session.getSnapshot().record.body).toBe(''); session.dispose();
  });
  it('空白新建与只改分类不产生正式记录', async () => {
    const persist = vi.fn(); const session = new EditorSession(createRecord(), true, persist);
    session.update({ recordType: 'work' }); expect(await session.save()).toBe(true);
    expect(persist).not.toHaveBeenCalled(); session.dispose();
  });
  it('只保存点击时的版本，慢写入期间的新输入仍未保存', async () => {
    vi.useFakeTimers(); const gate = deferred();
    const persist = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
    const session = new EditorSession(createRecord(), true, persist);
    session.update({ body: '第一段' }); const saving = session.save();
    await Promise.resolve(); session.update({ body: '第一段，之后的新输入' });
    gate.resolve(); expect(await saving).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ dirty: true, record: { body: '第一段，之后的新输入' } });
    await vi.advanceTimersByTimeAsync(120_000); expect(persist).toHaveBeenCalledTimes(1);
    expect(persist.mock.calls[0][0].body).toBe('第一段');
    expect(await session.save()).toBe(true); expect(persist.mock.calls[1][0].body).toBe('第一段，之后的新输入');
    session.dispose();
  });
  it('连续两次显式保存串行提交各自版本，不顺带保存第三次输入', async () => {
    const gate = deferred(); const persist = vi.fn().mockImplementationOnce(() => gate.promise).mockResolvedValue(undefined);
    const session = new EditorSession(createRecord(), true, persist);
    session.update({ body: 'A' }); const first = session.save();
    session.update({ body: 'AB' }); const second = session.save();
    session.update({ body: 'ABC' }); gate.resolve(); await first; await second;
    expect(persist.mock.calls.map(([record]) => record.body)).toEqual(['A', 'AB']);
    expect(session.getSnapshot()).toMatchObject({ dirty: true, record: { body: 'ABC' } });
    await session.discard(); expect(session.getSnapshot().record.body).toBe('AB'); session.dispose();
  });
  it('失败不丢输入、不创建恢复副本，重试后才能成为已保存', async () => {
    const persist = vi.fn().mockRejectedValueOnce(new Error('磁盘不可用')).mockResolvedValue(undefined), recovery = vi.fn();
    const session = new EditorSession(createRecord(), true, persist, recovery);
    session.update({ body: '失败后不能清空' }); expect(await session.save()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ dirty: true, status: 'error', record: { body: '失败后不能清空' } });
    expect(recovery).not.toHaveBeenCalled(); expect(await session.save()).toBe(true);
    expect(session.getSnapshot().status).toBe('saved'); session.dispose();
  });
  it('放弃修改等待已明确提交的写入，然后回到最后保存版本', async () => {
    const gate = deferred(); const persist = vi.fn(() => gate.promise);
    const session = new EditorSession({ ...createRecord(), title: '已有记录', body: '原文' }, false, persist);
    session.update({ body: '已明确点过保存' }); void session.save(); session.update({ body: '应放弃的后续输入' });
    const discarding = session.discard(); gate.resolve(); await discarding;
    expect(persist).toHaveBeenCalledTimes(1); expect(session.getSnapshot()).toMatchObject({ dirty: false, record: { body: '已明确点过保存' } }); session.dispose();
  });
  it('输入法选字期间不提交，结束选字后仍须主动保存', async () => {
    vi.useFakeTimers(); const persist = vi.fn(); const session = new EditorSession(createRecord(), true, persist);
    session.setComposing(true); session.update({ body: '中文' }); expect(await session.save()).toBe(false);
    session.setComposing(false); await vi.advanceTimersByTimeAsync(10_000); expect(persist).not.toHaveBeenCalled();
    expect(await session.save()).toBe(true); expect(persist).toHaveBeenCalledTimes(1); session.dispose();
  });
  it('discard publishes a new editor reset and restores the entire saved document',async()=>{
    const original={...createRecord(),title:'原稿',body:'原文',tags:['保留']},persist=vi.fn();
    const session=new EditorSession(original,false,persist);
    session.update({body:'丢弃内容',tags:['丢弃']});const before=session.getSnapshot().resetVersion;
    expect(await session.discard()).toBe(true);expect(session.getSnapshot()).toMatchObject({resetVersion:before+1,dirty:false,record:original});
    expect(persist).not.toHaveBeenCalled();session.dispose();
  });
  it('旧版恢复内容打开后等待用户决定，不恢复自动保存', async () => {
    vi.useFakeTimers(); const initial = createRecord(), persist = vi.fn();
    const session = new EditorSession(initial, true, persist, vi.fn(), { ...initial, body: '旧版未保存内容' });
    await vi.advanceTimersByTimeAsync(60_000); expect(persist).not.toHaveBeenCalled();
    expect(await session.save()).toBe(true); expect(persist).toHaveBeenCalledTimes(1); session.dispose();
  });
});
