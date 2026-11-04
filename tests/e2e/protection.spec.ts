import {expectNote} from './helpers';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createRecord, encodeArchive } from '../../src/domain/models';
import { editorAction, go, more } from './helpers';
const body = (page: Page) => page.getByLabel('记录正文', { exact: true });
async function start(page: Page) { await page.goto('/'); await page.getByRole('button', { name: '写一条' }).click(); await page.getByLabel('记录标题', { exact: true }).fill('数据保护检查'); await body(page).fill('最初内容'); await page.getByRole('button', { name: '保存记录', exact: true }).click(); await expect(page.locator('.save-state')).toContainText('已保存在本机'); }
async function savedBody(page: Page) { return page.evaluate(async () => { const request = indexedDB.open('dafeiyu-notebook-v1'); const db = await new Promise<IDBDatabase>((resolve) => { request.onsuccess = () => resolve(request.result); }); const tx = db.transaction('records'); const read = tx.objectStore('records').getAll(); const records = await new Promise<{ body: string }[]>((resolve) => { read.onsuccess = () => resolve(read.result); }); db.close(); return records.map((record) => record.body); }); }

test('首页无标题分类即可记录，等待不保存；手动收好后才进入时间线', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('随手记', { exact: true }).fill('这是还没归类的心情和工作想法');
  await page.waitForTimeout(1300); expect(await savedBody(page)).toEqual([]);
  expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('dafeiyu-recovery')))).toEqual([]);
  await expect(page.locator('.record-card')).toHaveCount(0); await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.record-card')).toContainText('这是还没归类的心情和工作想法'); await expect(page.getByLabel('随手记', { exact: true })).toHaveValue('');
  await page.reload(); await page.locator('.record-card').click(); await expectNote(body(page),'这是还没归类的心情和工作想法');
});
test('离开确认支持 Esc、继续编辑和保存并离开，无原生 confirm 依赖', async ({ page }) => {
  await start(page); await page.evaluate(() => { window.confirm = (() => Promise.resolve(false)) as unknown as typeof window.confirm; });
  await body(page).fill('尚未保存的新内容'); await go(page, '任务清单'); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0); await expectNote(body(page),'尚未保存的新内容');
  await go(page, '任务清单'); await page.getByRole('dialog').getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.tasks-panel')).toBeVisible(); await go(page, '全部记录'); await page.locator('.record-card').click(); await expectNote(body(page),'尚未保存的新内容');
});
test('搜索框焦点下 Ctrl+S 保存当前记录，拦截默认行为', async ({ page }) => {
  await start(page); await body(page).fill('窗口范围内保存'); await page.getByLabel('搜索记录和任务').focus(); await page.keyboard.press('Control+s');
  await expect(page.locator('.save-state')).toContainText('已保存在本机'); await page.reload(); await page.locator('.record-card').click(); await expectNote(body(page),'窗口范围内保存');
});
test('新建、返回、筛选和导入都先询问，不隐式保存正文', async ({ page }) => {
  await start(page); await body(page).fill('所有入口都应保留的编辑');
  const filterByDate = async () => {
    await page.locator('.timeline-filter > summary').click();
    await page.getByLabel('记录日期').selectOption('7');
  };
  for (const trigger of [() => page.getByRole('button', { name: '写一条' }).click(), () => page.getByRole('button', { name: '返回记录列表' }).click(), filterByDate]) {
    await trigger(); await expect(page.getByRole('dialog')).toContainText('这一页，要保存吗'); await page.getByRole('dialog').getByRole('button', { name: '继续写', exact: true }).click();
    expect(await savedBody(page)).toEqual(['最初内容']);
  }
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'empty.json', mimeType: 'application/json', buffer: Buffer.from(encodeArchive({ records: [], tasks: [] })) });
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click(); await expect(page.getByRole('dialog')).toContainText('导入这份备份');
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); await expectNote(body(page),'所有入口都应保留的编辑');
});
test('明确放弃修改后数据库保留原文；刷新也不出现新恢复草稿', async ({ page }) => {
  await start(page); await body(page).fill('误操作内容'); await page.waitForTimeout(1300); expect(await savedBody(page)).toEqual(['最初内容']);
  await go(page, '任务清单'); await page.getByRole('dialog').getByRole('button', { name: '丢弃' }).click(); await go(page, '全部记录'); await page.locator('.record-card').click(); await expectNote(body(page),'最初内容');
  await page.reload(); await expect(page.getByRole('region', { name: '未保存内容恢复' })).toHaveCount(0);
});
test('保存失败阻止离开并保留输入，修复后可重试', async ({ page }) => {
  await page.addInitScript(`(() => { const original = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...args) { if (window.failWrites && this.name === 'records') throw new DOMException('模拟磁盘写入失败', 'QuotaExceededError'); return original.apply(this,args); }; })()`);
  await start(page); await page.evaluate('window.failWrites = true'); await body(page).fill('失败后留在这里'); await go(page, '任务清单');
  await page.getByRole('dialog').getByRole('button', { name: '保存' }).click(); await expect(page.getByRole('dialog').getByRole('alert')).toContainText('没存好');
  await expectNote(body(page),'失败后留在这里'); await page.evaluate('window.failWrites = false'); await page.getByRole('dialog').getByRole('button', { name: '保存' }).click(); await expect(page.locator('.tasks-panel')).toBeVisible();
});
test('旧版恢复副本打开后仍需手动保存，取消不会写入新副本', async ({ page }) => {
  const record = { ...createRecord(), body: '旧版未保存的内容' };
  await page.addInitScript(({ record }) => localStorage.setItem(`dafeiyu-recovery-v1:browser:${record.id}`, JSON.stringify({ record, savedAt: new Date().toISOString() })), { record });
  await page.goto('/'); await page.getByRole('button', { name: '恢复编辑' }).click(); await page.waitForTimeout(1300); expect(await savedBody(page)).toEqual([]);
  await expectNote(body(page),record.body); await page.getByRole('button', { name: '保存记录', exact: true }).click(); await expect(page.locator('.save-state')).toContainText('已保存在本机');
  expect(await savedBody(page)).toEqual([record.body]); expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith('dafeiyu-recovery')))).toEqual([]);
});
test('删除只把已保存版本移入回收站，不顺带保存误改正文', async ({ page }) => {
  await start(page); await editorAction(page, '创建任务');await page.getByRole('button',{name:'确认添加任务',exact:true}).click(); await body(page).fill('未保存的误修改'); await editorAction(page, '删除当前记录');
  await expect(page.getByRole('dialog')).toContainText('本次未保存修改将放弃'); await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  await go(page, '回收站'); await expect(page.locator('.trash-row')).toContainText('数据保护检查'); await page.getByRole('button', { name: '恢复记录：数据保护检查' }).click();
  await go(page, '任务清单'); await expect(page.locator('.source-link')).toHaveText('数据保护检查'); await page.locator('.source-link').click(); await expectNote(body(page),'最初内容');
});
test('导出和任务预览不会隐式保存；完整备份明确选择已保存版本', async ({ page }, testInfo) => {
  await start(page); await body(page).fill('未保存的导出草稿\n- [ ] 下次验证');
  const exporting = page.waitForEvent('download'); await editorAction(page, '导出当前记录为 Markdown'); await (await exporting).saveAs(testInfo.outputPath('draft.md'));
  expect(await savedBody(page)).toEqual(['最初内容']); await editorAction(page, '创建任务');
  await expect(page.getByRole('dialog').getByRole('button', { name: '保存记录并添加任务' })).toBeVisible(); await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click(); expect(await savedBody(page)).toEqual(['最初内容']);
  await more(page); await page.getByRole('button', { name: '完整备份', exact: true }).click(); const downloading = page.waitForEvent('download'); await page.getByRole('dialog').getByRole('button', { name: '仅备份已保存内容' }).click();
  await (await downloading).saveAs(testInfo.outputPath('saved.json')); expect(await savedBody(page)).toEqual(['最初内容']); await expect(page.locator('.save-state')).toContainText('尚未保存');
});
