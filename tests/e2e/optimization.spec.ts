import {downloadedArchive} from './helpers';
import {findNotes,openFound} from './helpers';
import {expectNote} from './helpers';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createRecord, createTask, encodeArchive } from '../../src/domain/models';

const decision = () => ({ ...createRecord('work'), title: '同步方案决策', body: '今天决定不做云同步，先把本地自动保存做好。\n原因：用户更在意离线隐私。\n下周任务：验证导出\n- [ ] 整理对照数据', tags: ['项目'] });
import { nav, editorAction, more } from './helpers';

async function seed(page: Page) {
  const record = decision();
  await page.goto('/');
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(encodeArchive({ records: [record], tasks: [] })) });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await expect(page.locator('.record-card')).toHaveCount(1);
  return record;
}

test('字号更清楚，专注模式增加编辑空间且保留未保存输入和快捷保存', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 844 });
  await seed(page); await page.locator('.record-card').click();
  const body = page.getByLabel('记录正文', { exact: true });
  expect(await body.evaluate((element) => getComputedStyle(element).fontSize)).toBe('16px');
  const before = (await body.boundingBox())!;
  await body.fill('专注模式里不能丢失的内容。');
  await editorAction(page,'进入专注编辑');
  await expect(page.locator('.sidebar')).toBeHidden();
  await expect(page.locator('.record-list')).toBeHidden();
  await expect(page.locator('.companion-dock')).toBeHidden();
  await expect(page.locator('.save-state')).toBeVisible();
  await expectNote(body,'专注模式里不能丢失的内容。');
  const after = (await body.boundingBox())!;
  expect(after.width * after.height).toBeGreaterThan(before.width * before.height * 1.4);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-state')).toContainText('已保存在本机');
  await page.keyboard.press('Control+k');
  await expect(page.getByLabel('询问已保存的笔记')).toBeFocused();await page.getByRole('button',{name:'关闭聊天',exact:true}).click();
  await editorAction(page,'进入专注编辑');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sidebar')).toBeVisible();
  await page.reload(); await page.locator('.record-card').click();
  await expectNote(body,'专注模式里不能丢失的内容。');
});

test('正文待办预览确认后创建，取消不创建，任务保留正确来源', async ({ page }) => {
  await seed(page); await page.locator('.record-card').click();
  await editorAction(page, '创建任务');
  await expect(page.getByRole('dialog').locator('.task-candidate')).toHaveCount(2);
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await nav(page, '任务清单').click(); await expect(page.locator('.task-row')).toHaveCount(0);
  await nav(page, '全部记录').click(); await page.locator('.record-card').click();
  await editorAction(page, '创建任务');
  await page.getByRole('dialog').locator('.task-candidate').filter({ hasText: '验证导出' }).click();
  await expect(page.getByLabel('任务名称', { exact: true })).toHaveValue('验证导出');
  await page.getByRole('dialog').getByRole('button', { name: '确认添加任务', exact: true }).click();
  await nav(page, '任务清单').click();
  await expect(page.locator('.task-description h3')).toHaveText('验证导出');
  await expect(page.locator('.source-link')).toHaveText('同步方案决策');
});

test('单篇 Markdown 导出包含最后修改的正文和标签', async ({ page }, testInfo) => {
  await seed(page); await page.locator('.record-card').click();
  const body = page.getByLabel('记录正文', { exact: true });
  await body.fill('## 最后修改\n- [ ] 仍需验证的事情');
  const downloading = page.waitForEvent('download');
  await editorAction(page, '导出当前记录为 Markdown');
  const download = await downloading;
  const path = testInfo.outputPath('record.md'); await download.saveAs(path);
  expect(await readFile(path, 'utf8')).toBe('# 同步方案决策\n\n标签：项目\n\n## 最后修改\n- [ ] 仍需验证的事情\n');
});

test('完整备份下载后可在空白空间恢复回收站与原始任务关系', async ({ page, browser }, testInfo) => {
  const record = decision(); const task = createTask('继续验证', null, record.id); const removed = createTask('已删除待办', null, record.id);
  await page.goto('/');
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(encodeArchive({ records: [record], tasks: [task, removed] })) });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await page.locator('.record-card').click(); await editorAction(page, '删除当前记录');
  await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  await nav(page, '任务清单').click();
  await page.getByLabel('事项操作：已删除待办',{exact:true}).click();await page.getByRole('button', { name: '删除任务：已删除待办' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '删除任务', exact: true }).click();
  await nav(page, '全部记录').click();
  await more(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '完整备份', exact: true }).click();
  const download = await downloading; const path = testInfo.outputPath('complete.json'); await download.saveAs(path);
  const archive = await downloadedArchive(page,path);
  expect(archive.version).toBe(8); expect(archive.snapshot.records[0].deletedAt).toBeTruthy();
  expect(archive.snapshot.tasks.find((item: { id: string }) => item.id === task.id).sourceRecordId).toBe(record.id);
  const context = await browser.newContext({ baseURL: process.env.E2E_ORIGIN??'http://127.0.0.1:1422' });
  try {
    await context.addInitScript(() => localStorage.setItem('dafeiyu-language', 'zh')); const fresh = await context.newPage(); await fresh.goto('/');
    await fresh.getByLabel('选择备份文件').setInputFiles(path);
    await expect(fresh.getByRole('dialog')).toContainText('回收站 2 项');
    await fresh.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
    await nav(fresh, '回收站').click(); await expect(fresh.locator('.trash-row')).toHaveCount(2);
    await fresh.getByRole('button', { name: '恢复记录：同步方案决策' }).click();
    await fresh.getByRole('button', { name: '恢复任务：已删除待办' }).click();
    await nav(fresh, '任务清单').click(); await expect(fresh.locator('.source-link')).toHaveCount(2);
    await expect(fresh.locator('.source-link').first()).toHaveText('同步方案决策');
  } finally { await context.close(); }
});

test('统一查找展示真实原因，预览与原文定位保留；无依据时明确未找到',async({page})=>{
  const record=await seed(page);const turn=await findNotes(page,'我之前为什么决定不做云同步？');await expect(turn.locator('.inquiry-match')).toHaveCount(1);await expect(turn.locator('blockquote')).toContainText('原因：用户更在意离线隐私。');await turn.getByRole('button',{name:'查看原文',exact:true}).click();await expect(page.getByRole('region',{name:'原文预览'}).locator('mark')).toHaveText('原因：用户更在意离线隐私。');await page.getByRole('region',{name:'原文预览'}).getByRole('button',{name:'打开记录',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true});await expectNote(body,record.body);expect(await body.evaluate(()=>getSelection()?.toString()??'')).toBe('原因：用户更在意离线隐私。');const missing=await findNotes(page,'我为什么决定去火星？');await expect(missing).toContainText('暂未找到相关记录，换条线索试试。');await expect(missing.locator('.inquiry-match')).toHaveCount(0);
});

test('角色回应保存，隐藏后业务操作不会强行展开', async ({ page }) => {
  await seed(page); await page.locator('.record-card').click();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.companion-bubble')).toContainText('这一页，替你收好了。');
  await page.getByRole('button', { name: '设置', exact: true }).click();await page.getByRole('tab',{name:'伙伴',exact:true}).click();
  await page.getByRole('checkbox', { name: '显示角色', exact: true }).uncheck();
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.getByRole('button', { name: '显示大肥鱼', exact: true })).toBeVisible();
  await expect(page.locator('.companion-dock')).toHaveCount(0);
});

test('Windows 换行导入原文经统一预览后仍准确定位',async({page})=>{
  const record={...decision(),body:'第一行无关内容。\r\n今天决定不做云同步。\r\n原因：用户更在意离线隐私。'};await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'windows-lines.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:[record],tasks:[]}))});await page.getByRole('dialog').getByRole('button',{name:'确认导入'}).click();await openFound(page,'为什么不做云同步？');expect(await page.getByLabel('记录正文',{exact:true}).evaluate(()=>getSelection()?.toString()??'')).toBe('原因：用户更在意离线隐私。');
});

