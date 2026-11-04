import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { createRecord, createTask, encodeArchive } from '../../src/domain/models';
import type { NoteRecord, Task } from '../../src/domain/models';

function note(title: string, daysAgo: number, changes: Partial<NoteRecord> = {}): NoteRecord {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setHours(10, 0, 0, 0);
  return { ...createRecord(), title, body: title + '。', createdAt: date.toISOString(), updatedAt: date.toISOString(), ...changes };
}

async function openStarHome(page: Page) {
  await page.goto('/');
  await page.evaluate(() => localStorage.removeItem('jingjian-timeline-view'));
  await page.reload();
  await expect(page.getByRole('region', { name: '时间星图' })).toBeVisible();
}

async function importSample(page: Page, records: NoteRecord[], tasks: Task[] = []) {
  await openStarHome(page);
  await page.getByLabel('选择备份文件').setInputFiles({
    name: 'star-map-fixture.json', mimeType: 'application/json', buffer: Buffer.from(encodeArchive({ records, tasks })),
  });
  await page.getByRole('button', { name: '确认导入', exact: true }).click();
  await expect(page.locator('.star-point').first()).toBeVisible();
}

test('星海默认流动，悬停与换片保持动画，光点可预览和返回', async ({ page }, info) => {
  await page.setViewportSize({ width: 1400, height: 880 });
  const quote = '湖面的雾还没散，第一班船已经靠岸。';
  const one = note('雾里的渡口', 0, { body: quote + '把这一刻留在相机里。', tags: ['周末散步', '摄影'] });
  const two = note('沿河试走', 4, { tags: ['周末散步'] });
  const task = { ...createTask('给相机充电'), sourceRecordId: one.id };
  await importSample(page, [one, two], [task]);
  const stage = page.getByRole('region', { name: '时间星图' });
  const stars = stage.locator('canvas').last();
  const frame = () => stars.evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await expect(stage).toHaveAttribute('data-moving', 'true');
  await expect(stage.getByRole('button', { name: /暂停漫游|继续漫游/ })).toHaveCount(0);
  const first = await frame();
  await expect.poll(frame).not.toBe(first);
  const point = stage.locator('.star-point[data-featured=true]');
  const previousLabel = await point.getAttribute('aria-label');
  const beforeSwitch = await frame();
  const next = page.getByRole('button', { name: '下一段回忆', exact: true });
  await next.click();
  await expect(point).not.toHaveAttribute('aria-label', previousLabel!);
  await expect(stage).toHaveAttribute('data-moving', 'true');
  await expect.poll(frame).not.toBe(beforeSwitch);
  if (!(await stage.locator('.star-point[data-featured=true]').getAttribute('aria-label'))?.includes('雾里的渡口')) await next.click();
  const star = page.getByRole('button', { name: /星点：雾里的渡口/ });
  await star.hover();
  await expect(page.getByRole('tooltip')).toHaveText(one.title);
  await expect(stage.locator('.star-excerpt')).toContainText(quote);
  await expect(stage).toHaveAttribute('data-moving', 'true');
  const hoveredFrame = await frame();
  await expect.poll(frame).not.toBe(hoveredFrame);
  await page.getByRole('button', { name: '线索', exact: true }).click();
  const clues = page.getByRole('complementary', { name: '线索' });
  await expect(clues).toContainText(task.title);
  await expect(clues).toContainText(two.title);
  await expect(stage).toHaveAttribute('data-moving', 'true');
  await page.getByRole('button', { name: '关闭线索', exact: true }).click();
  const toastClose = page.getByRole('button', { name: '关闭提示', exact: true });
  if (await toastClose.isVisible()) await toastClose.click();
  await page.screenshot({ path: info.outputPath('星海漫游.png') });
  await star.click();
  await expect(page.getByLabel('记录正文', { exact: true })).toContainText(quote);
  await page.getByRole('button', { name: '返回记录列表', exact: true }).click();
  await expect(star).toBeVisible();
  await expect(stage).toHaveAttribute('data-moving', 'true');
  await page.setViewportSize({ width: 780, height: 680 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: '列表', exact: true }).click();
  await page.reload();
  await expect(page.locator('.record-card').first()).toBeVisible();
});

test('日期和重点一起筛选，单条记录停留，清除筛选后显示旧记录', async ({ page }) => {
  const text = '回想今天的灯光。';
  const recent = note('岸边灯塔', 1, {
    body: text, highlights: [{ id: crypto.randomUUID(), start: 0, end: text.length, text, createdAt: new Date().toISOString(), stale: false }],
  });
  await importSample(page, [recent, note('旧工作记录', 50, { recordType: 'work' }), note('近来的片段', 3)]);
  await page.locator('.timeline-filter > summary').click();
  await page.getByLabel('记录日期').selectOption('7');
  await page.getByLabel('有重点', { exact: true }).check();
  await expect(page.getByRole('button', { name: /星点：岸边灯塔/ })).toBeVisible();
  await expect(page.getByRole('button', { name: '下一段回忆', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await expect(page.getByRole('button', { name: /星点：旧工作记录/ })).toBeVisible();
});

test('自动抽取不同记录，写作时背景持续流动，打开星点保护草稿', async ({ page }) => {
  await importSample(page, [note('最近的片段', 0), note('前几天的片段', 3), note('最早的片段', 5)]);
  const star = page.locator('.star-point[data-featured=true]');
  const first = await star.getAttribute('aria-label');
  await expect(star).not.toHaveAttribute('aria-label', first!, { timeout: 12000 });
  const capture = page.getByLabel('随手记', { exact: true });
  await capture.fill('这段先留在草稿。');
  await expect(page.getByRole('region', { name: '时间星图' })).toHaveAttribute('data-moving', 'true');
  await star.click();
  await page.getByRole('button', { name: /继续写|继续编辑/ }).click();
  await expect(capture).toHaveValue('这段先留在草稿。');
});

test('系统减少动态时可手动换片', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await importSample(page, [note('六月的湖面', 0), note('五月的树林', 3)]);
  const star = page.locator('.star-point[data-featured=true]');
  const first = await star.getAttribute('aria-label');
  await expect(page.getByRole('region', { name: '时间星图' })).toHaveAttribute('data-moving', 'false');
  await page.getByRole('button', { name: '下一段回忆', exact: true }).click();
  await expect(star).not.toHaveAttribute('aria-label', first!);
});

test('多个随机星点同时显示，换片保留点位，非主星点能打开对应记录', async ({ page }) => {
  await page.setViewportSize({ width: 1360, height: 880 });
  const records = Array.from({ length: 7 }, (_, index) => note(`片段 ${index + 1}`, index));
  await importSample(page, records);
  const stage = page.getByRole('region', { name: '时间星图' });
  const points = stage.locator('.star-point');
  await expect(points).toHaveCount(5);
  const labels = () => points.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  const firstSet = await labels();
  expect(new Set(firstSet).size).toBe(5);
  const featured = stage.locator('.star-point[data-featured=true]');
  const before = await featured.getAttribute('aria-label');
  await stage.getByRole('button', { name: '下一段回忆', exact: true }).click();
  await expect(featured).not.toHaveAttribute('aria-label', before!);
  expect(await labels()).toEqual(firstSet);
  const other = stage.locator('.star-point[data-featured=false]').last();
  const otherLabel = await other.getAttribute('aria-label');
  const expected = records.find(record => otherLabel?.startsWith(`星点：${record.title}，`))!;
  await other.hover();
  await expect(stage.getByRole('tooltip')).toHaveText(expected.title);
  await expect(featured).toHaveAttribute('aria-label', otherLabel!);
  await expect(stage.locator('.star-excerpt')).toHaveText(expected.body);
  await expect(stage).toHaveAttribute('data-moving', 'true');
  await stage.getByRole('button', { name: otherLabel!, exact: true }).click();
  await expect(page.getByLabel('记录正文', { exact: true })).toContainText(expected.body);
  await page.getByRole('button', { name: '返回记录列表', exact: true }).click();
  await expect(featured).toHaveAttribute('aria-label', otherLabel!);
  expect(await labels()).toEqual(firstSet);
});

test('空闲时轮换部分固定星位，悬停锁住主星并展示长记精简', async ({ page }) => {
  await page.clock.install();
  const opening = '原先想沿着河岸走到石桥，入口施工，只能绕过菜市场。';
  const action = '下次提前半小时到北岸拍照。';
  const body = opening + '那天远处的路灯很早就亮了，桥底有两只小船，坐在石阶上等了很久。市场收摊后街角安静下来，我在那附近多绕了几条巷子。' + action;
  await importSample(page, Array.from({ length: 9 }, (_, index) => note(`长随记 ${index + 1}`, index, { body, tags: ['摄影'] })));
  const stage = page.getByRole('region', { name: '时间星图' });
  const points = stage.locator('.star-point');
  const ids = () => points.evaluateAll(elements => elements.map(element => element.getAttribute('aria-label')));
  const original = await ids();
  const pick = stage.locator('.star-point[data-featured=false]').first();
  const label = await pick.getAttribute('aria-label');
  await pick.hover();
  await expect(stage.locator('.star-point[data-featured=true]')).toHaveAttribute('aria-label', label!);
  await expect(stage.locator('.star-excerpt')).toContainText(action);
  await expect(stage.getByRole('tooltip')).not.toContainText(opening);
  await page.clock.fastForward(17000);
  expect(await ids()).toEqual(original);
  await page.mouse.move(12, 12);
  await page.clock.fastForward(15600);
  await expect.poll(async () => (await ids()).filter(id => !original.includes(id)).length).toBe(2);
  await expect(points).toHaveCount(5);
  expect((await ids()).filter(id => original.includes(id))).toHaveLength(3);
});
