import {downloadedArchive} from './helpers';
import { test, expect } from '@playwright/test';

import { go, more } from './helpers';
const phrase = '先保证离线导出完整，再讨论云同步。';
async function writeAndMark(page: import('@playwright/test').Page) {
  await page.goto('/'); await page.getByRole('button', { name: '写一条' }).click();
  const body = page.getByLabel('记录正文', { exact: true }); await body.fill(phrase + '\n原因：数据能带走最重要。');
  await body.press('Control+Home'); await body.press('Shift+End');
  await expect(page.getByRole('button', { name: '记住这句', exact: true })).toBeEnabled(); await page.getByRole('button', { name: '记住这句', exact: true }).click();
  return body;
}
test('重点随手动保存后进入回顾，无需关键词即可找到时间和原文', async ({ page }) => {
  const body = await writeAndMark(page); await expect(page.locator('.record-card')).toHaveCount(0);
  await page.getByRole('button', { name: '保存记录', exact: true }).click(); await page.getByRole('button', { name: '返回记录列表' }).click();
  await expect(page.locator('.memory-card')).toHaveCount(1); await expect(page.locator('.memory-card')).toContainText(phrase);
  await expect(page.locator('.memory-dates')).toContainText('记录于'); await expect(page.locator('.memory-dates')).toContainText('划重点于');
  await page.getByRole('button', { name: '打开记录', exact: true }).click();
  expect(await body.evaluate(()=>getSelection()?.toString()??'')).toBe(phrase);
  await page.reload(); await go(page, '重点'); await expect(page.locator('.memory-card')).toHaveCount(1);
});
test('取消未保存的重点不留记录，也不进入回顾', async ({ page }) => {
  await writeAndMark(page); await go(page, '回顾'); await page.getByRole('dialog').getByRole('button', { name: '丢弃' }).click();await go(page,'重点');
  await expect(page.locator('.memory-card')).toHaveCount(0); await page.reload(); await go(page, '重点'); await expect(page.locator('.memory-card')).toHaveCount(0);
});
test('重点外的编辑保持定位，修改重点本身后提示核对，首页停止引用旧话', async ({ page }) => {
  const body = await writeAndMark(page); await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await body.press('Control+Home'); await body.type('新增前言\n'); await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await go(page, '重点'); await page.getByRole('button', { name: '打开记录', exact: true }).click();
  expect(await body.evaluate(()=>getSelection()?.toString()??'')).toBe(phrase);
  await body.fill('新增前言\n改变计划，先做别的事。\n原因：数据能带走最重要。'); await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await go(page, '重点'); await expect(page.locator('.memory-card')).toContainText('原文已修改'); await expect(page.getByRole('button', { name: '打开记录', exact: true })).toHaveCount(0);
  await go(page, '随记'); await expect(page.locator('.memory-card')).toHaveCount(0);
});
test('重点进入 v4 完整备份，在空白空间恢复后可再次定位', async ({ page, browser }, testInfo) => {
  await writeAndMark(page); await page.getByRole('button', { name: '保存记录', exact: true }).click(); await more(page);
  const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '完整备份', exact: true }).click(); const path = testInfo.outputPath('memory.json'); await (await downloading).saveAs(path);
  const archive = await downloadedArchive(page,path); expect(archive.version).toBe(8); expect(archive.snapshot.records[0].highlights[0].text).toBe(phrase);
  const context = await browser.newContext({ baseURL: process.env.E2E_ORIGIN??'http://127.0.0.1:1422' });
  try { await context.addInitScript(() => localStorage.setItem('dafeiyu-language', 'zh')); const fresh = await context.newPage(); await fresh.goto('/'); await fresh.getByLabel('选择备份文件').setInputFiles(path); await fresh.getByRole('dialog').getByRole('button', { name: '确认导入' }).click(); await go(fresh, '重点'); await fresh.getByRole('button', { name: '打开记录', exact: true }).click(); expect(await fresh.getByLabel('记录正文', { exact: true }).evaluate(()=>getSelection()?.toString()??'')).toBe(phrase); } finally { await context.close(); }
});
test('首页回顾可关闭并跨刷新保留，窄屏入口可用且不溢出', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await writeAndMark(page); await page.getByRole('button', { name: '保存记录', exact: true }).click(); await page.getByRole('button', { name: '返回记录列表' }).click();
  await expect(page.locator('.memory-card')).toHaveCount(1); await page.locator('.memory-options>summary').click();await page.getByRole('button', { name: '关闭首页回顾' }).click(); await page.reload(); await expect(page.locator('.memory-card')).toHaveCount(0);
  await page.getByRole('button', { name: '开启首页回顾' }).click(); await expect(page.locator('.memory-card')).toHaveCount(1);
  await go(page, '重点'); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.memory-card').screenshot({ path: testInfo.outputPath('mobile-memory.png') });
});


