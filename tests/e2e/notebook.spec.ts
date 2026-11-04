import {findNotes} from './helpers';
import {expectNote} from './helpers';
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createRecord, encodeArchive } from '../../src/domain/models';
import type { NoteRecord } from '../../src/domain/models';
import { editorAction, go, more, addInlineTag } from './helpers';

async function writeRecord(page: Page, title = '论文实验复盘') {
  await page.getByRole('button', { name: '写一条' }).click();
  await page.getByLabel('记录标题', { exact: true }).fill(title);
  await page.getByLabel('记录正文', { exact: true }).fill('今天完成了基线实验。\n下一步检查对照组，保留原始结果。\n研究 论文');
  await addInlineTag(page,'研究');await addInlineTag(page,'论文');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(page.locator('.save-state')).toContainText('已保存在本机');
}
async function importFixture(page: Page, records: NoteRecord[]) {
  await page.goto('/'); await page.getByLabel('选择备份文件').setInputFiles({ name: 'fixture.json', mimeType: 'application/json', buffer: Buffer.from(encodeArchive({ records, tasks: [] })) });
  await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await expect(page.getByRole('status')).toContainText('备份已导入');
}
test('记录刷新恢复、中文搜索、关联任务与完成状态', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/'); await writeRecord(page); await page.reload(); await page.locator('.record-card').click();
  await expectNote(page.getByLabel('记录正文', { exact: true }),/基线实验/);
  let found=await findNotes(page,'对照组');await expect(found.locator('.inquiry-match')).toHaveCount(1);
  found=await findNotes(page,'完全不存在的内容');await expect(found.locator('.inquiry-match')).toHaveCount(0);
  await page.getByRole('button',{name:'关闭聊天',exact:true}).click();await editorAction(page,'创建任务');await page.getByRole('button',{name:'确认添加任务',exact:true}).click();
  await go(page, '任务清单'); await expect(page.locator('.source-link')).toHaveText('论文实验复盘');
  await page.getByRole('button', { name: '完成任务：论文实验复盘', exact: true }).click(); await page.reload(); await go(page, '任务清单');
  await page.getByRole('button', { name: '展开已完成 · 1' }).click(); await expect(page.getByRole('button', { name: '标为未完成：论文实验复盘', exact: true })).toBeVisible(); expect(errors).toEqual([]);
});
test('备份能恢复记录和任务来源，删除来源不删除任务', async ({ page }, testInfo) => {
  await page.goto('/'); await writeRecord(page, '备份往返检查');await page.getByLabel('记录正文',{exact:true}).press('Control+End'); await editorAction(page, '创建任务');await page.getByRole('button',{name:'确认添加任务',exact:true}).click();
  await more(page); const downloading = page.waitForEvent('download'); await page.getByRole('button', { name: '完整备份', exact: true }).click();
  const path = testInfo.outputPath('backup.json'); await (await downloading).saveAs(path);
  await editorAction(page, '删除当前记录'); await page.getByRole('dialog').getByRole('button', { name: '确认删除' }).click();
  await go(page, '任务清单'); await expect(page.locator('.task-row')).toHaveCount(1); await expect(page.locator('.source-link')).toHaveCount(0);
  await go(page, '全部记录'); await page.getByLabel('选择备份文件').setInputFiles(path);
  await expect(page.getByRole('dialog')).toContainText('包含 1 条记录、1 个任务'); await page.getByRole('dialog').getByRole('button', { name: '确认导入' }).click();
  await go(page, '任务清单'); await page.getByLabel('搜索记录和任务').fill('备份'); await expect(page.locator('.source-link')).toHaveText('备份往返检查'); await page.locator('.source-link').click(); await expect(page.locator('.global-note-search')).toBeVisible();
});
test('未保存修改离开前由大肥鱼确认，损坏备份不改数据', async ({ page }) => {
  await page.goto('/'); await writeRecord(page); await page.getByLabel('记录正文', { exact: true }).fill('尚未保存的内容'); await go(page, '任务清单');
  await expect(page.getByRole('dialog')).toContainText('这一页，要保存吗'); await expect(page.locator('.companion-dock .save-bubble')).toBeVisible(); await expect(page.locator('dialog[open]')).toHaveCount(0);
  await page.getByRole('dialog').getByRole('button', { name: '继续写', exact: true }).click();
  await page.getByLabel('选择备份文件').setInputFiles({ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(page.getByRole('alert')).toContainText('无法读取 JSON'); await expectNote(page.getByLabel('记录正文', { exact: true }),'尚未保存的内容');
});
test('窄屏可编辑、保存并返回列表，没有横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await writeRecord(page, '小屏记录');
  await page.getByRole('button', { name: '返回记录列表' }).click(); await expect(page.locator('.record-card')).toContainText('小屏记录');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('旧分类记录在同一时间线显示并可编辑，列表与侧栏只保留实用筛选', async ({ page }) => {
  const records = (['work', 'diary', 'note'] as const).map((type, index) => ({
    ...createRecord(type), title: `已有记录 ${index + 1}`, body: `已有内容 ${index + 1}`, tags: ['示例'],
  }));
  await importFixture(page, records);
  const filter = page.locator('.timeline-filter');
  const cards = page.locator('.record-card');
  const assertFilters = async () => {
    await filter.locator(':scope > summary').click();
    await expect(filter.getByLabel('记录日期')).toBeVisible();
    await expect(filter.getByLabel('有重点')).toBeVisible();
    await expect(filter.getByLabel('按标签查看记录')).toBeVisible();
    await expect(filter.getByText('全部类型', { exact: true })).toHaveCount(0);
    await expect(filter.getByText('旧分类', { exact: true })).toHaveCount(0);
  };
  await assertFilters();
  await cards.filter({ hasText: records[0].title }).click();
  await expect(cards).toHaveCount(3);
  await assertFilters();
  const body = page.getByLabel('记录正文', { exact: true });
  await expectNote(body, records[0].body);
  await body.fill('更新后的内容');
  await page.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(cards.filter({ hasText: records[0].title })).toContainText('更新后的内容');
});
test('统一时间线不展示分类卡片，旧空白记录仍可继续编辑', async ({ page }) => {
  await importFixture(page, [{ ...createRecord('work'), title: '工作进展', body: '实验' }, { ...createRecord('diary'), title: '生活小事', body: '散步' }, ...Array.from({ length: 3 }, () => createRecord())]);
  await expect(page.locator('.collection-card')).toHaveCount(0); await expect(page.locator('.record-card:visible')).toHaveCount(2);
  await expect(page.locator('.timeline-filter')).not.toHaveAttribute('open', '');
  await page.locator('.draft-records summary').click(); await page.locator('.draft-card').first().click();
  await expect(page.getByLabel('记录标题', { exact: true })).toHaveValue(''); await page.getByLabel('记录正文', { exact: true }).fill('继续旧空白记录');
  await page.getByRole('button', { name: '保存记录', exact: true }).click(); await page.getByRole('button', { name: '返回记录列表' }).click();
  await expect(page.locator('.record-card:visible')).toHaveCount(3);
});
