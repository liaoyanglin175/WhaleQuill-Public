import {test,expect} from '@playwright/test';
import {addInlineTag,selectText,selectionAction} from './helpers';

async function start(page:import('@playwright/test').Page,text='今天要记英语单词 English words。'){
  await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();
  const body=page.getByLabel('记录正文',{exact:true});await body.fill(text);return body;
}
test('斜体、真实字体与预设色板可见，保存后保持',async({page})=>{
  const body=await start(page);await selectText(page,'English words');await selectionAction(page,'斜体');
  await expect(body.locator('em')).toHaveCSS('font-style','italic');expect(await body.evaluate(element=>getComputedStyle(element).fontSynthesis)).toContain('style');
  await selectionAction(page,'更多文字操作');const menu=page.getByRole('toolbar',{name:'选中文字样式'});
  await expect(menu.locator('input[type=color]')).toHaveCount(0);await expect(menu.getByLabel('字体',{exact:true}).locator('option')).toHaveCount(5);
  await menu.getByLabel('字体',{exact:true}).selectOption('DFY Wen Kai');await menu.getByRole('button',{name:'字色：蓝',exact:true}).click();await menu.getByRole('button',{name:'底色：浅黄',exact:true}).click();
  await expect(body.locator('span[style*="color"]').first()).toHaveCSS('color','rgb(49, 94, 171)');await expect(body.locator('mark')).toBeVisible();
  await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.reload();await page.locator('.record-card').first().click();
  await expect(page.locator('.rich-body em')).toContainText('English words');await expect(page.locator('.rich-body')).toContainText('今天要记英语单词');await expect(page.locator('.save-state')).toHaveText('已保存在本机');
});
test('拖动样式面板保留原选区，越界校正且可复位',async({page})=>{
  const body=await start(page);await selectText(page,'英语单词');const menu=page.getByRole('toolbar',{name:'选中文字样式'}),handle=menu.getByRole('button',{name:'拖动样式面板'});
  const before=(await menu.boundingBox())!,grip=(await handle.boundingBox())!;await page.mouse.move(grip.x+10,grip.y+10);await page.mouse.down();await page.mouse.move(before.x+300,before.y+140,{steps:8});await page.mouse.up();
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe('英语单词');const after=(await menu.boundingBox())!;expect(Math.abs(after.x-before.x)).toBeGreaterThan(80);
  await selectionAction(page,'粗体');await expect(body.locator('strong')).toHaveText('英语单词');await selectionAction(page,'更多文字操作');await menu.getByRole('button',{name:'回到选区旁'}).click();await expect(menu).toHaveAttribute('data-manual','false');
});
test('选区#标签一次撤销与重做，保存后聚合对应记录',async({page})=>{
  const body=await start(page);await addInlineTag(page,'英语单词');await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#英语单词');await expect(body.locator('.inline-tag')).toHaveCount(0);await expect(page.locator('.save-state')).toContainText('尚未保存');await expect(page.getByRole('button',{name:'整理（可选）',exact:true})).toHaveCount(0);
  await body.press('Control+z');await expect(page.locator('.editor-content>.record-tags')).toHaveCount(0);await expect(body).not.toContainText('#');
  await body.press('Control+y');await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#英语单词');await expect(body.locator('.inline-tag')).toHaveCount(0);await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.reload();
  await page.getByRole('button',{name:'查看标签：英语单词',exact:true}).first().click();await expect(page.locator('.active-tag')).toContainText('英语单词');await expect(page.locator('.record-card')).toHaveCount(1);
});
test('正文修改与清除格式不改变关联，取消标签可撤销',async({page})=>{
  const body=await start(page,'英语单词');await addInlineTag(page,'英语单词');await selectionAction(page,'清除格式');await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#英语单词');await expect(body.locator('.inline-tag')).toHaveCount(0);
  await body.press('Control+Home');await body.press('Delete');await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#英语单词');await page.getByRole('button',{name:'管理标签：英语单词',exact:true}).click();await page.getByRole('button',{name:'取消此标签',exact:true}).click();await expect(page.locator('.editor-content .record-tags')).toHaveCount(0);
  await body.press('Control+z');await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#英语单词');await expect(body.locator('.inline-tag')).toHaveCount(0);
});
test('失焦可见时继续播放，隐藏时暂停且恢复不补播旧互动',async({page})=>{
  await page.goto('/');const video=page.locator('.character-video');await expect(video).toHaveAttribute('data-loaded','true');
  await page.evaluate(()=>{Object.defineProperty(document,'hasFocus',{value:()=>false,configurable:true});window.dispatchEvent(new Event('blur'));});await expect(video).toHaveAttribute('data-paused','false');
  const before=Number(await video.getAttribute('data-time')??0);await expect.poll(async()=>Number(await video.getAttribute('data-time')??0)).toBeGreaterThan(before);
  await page.locator('.companion-character').click();await page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>true,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(video).toHaveAttribute('data-paused','true');
  const paused=await video.locator('video').evaluateAll(elements=>elements.map(element=>(element as HTMLVideoElement).currentTime));await page.waitForTimeout(300);expect(await video.locator('video').evaluateAll(elements=>elements.map(element=>(element as HTMLVideoElement).currentTime))).toEqual(paused);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{get:()=>false,configurable:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(video).toHaveAttribute('data-action','idle');await expect(video).toHaveAttribute('data-paused','false');
});
test('只停笔而不离开编辑框，也能在约十秒后做原地动作',async({page})=>{
  await page.addInitScript(()=>{Math.random=()=>.4;});await page.clock.install();await page.goto('/');await page.getByLabel('随手记',{exact:true}).focus();await page.clock.fastForward(11200);await expect(page.locator('.character-video')).toHaveAttribute('data-requested','look');
});
test('点击动作不连续重复，记录回应默认本地且联网授权关闭',async({page})=>{
  await start(page,'今天要记英语单词。');await page.getByRole('button',{name:'保存记录',exact:true}).click();
  const actions:string[]=[];for(let i=0;i<3;i++){await page.locator('.companion-character').click();const requested=await page.locator('.character-video').getAttribute('data-requested');expect(actions).not.toContain(requested);actions.push(requested!);}
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'伙伴',exact:true}).click();await expect(page.getByRole('checkbox',{name:'结合当前已保存记录回应'})).toBeChecked();await expect(page.getByRole('checkbox',{name:'允许联网生成互动回应'})).not.toBeChecked();
});
test('五款字体离线资源均可加载，窄窗口保存与选区面板可达',async({page})=>{
  test.setTimeout(60000);await page.setViewportSize({width:390,height:640});const body=await start(page);
  const families=['DFY Han Sans','DFY Han Serif','DFY Wen Kai','DFY Fang Song','DFY Mono'];
  const loaded=await page.evaluate(async families=>{for(const family of families)await document.fonts.load(`16px "${family}"`,'中文English');return families.map(family=>document.fonts.check(`16px "${family}"`,'中文English'));},families);expect(loaded).toEqual([true,true,true,true,true]);
  expect((await page.locator('.sidebar').boundingBox())!.height).toBeLessThan(155);const save=(await page.getByRole('button',{name:'保存记录',exact:true}).boundingBox())!;expect(save.y+save.height).toBeLessThanOrEqual(640);
  await selectText(page,'英语单词');await selectionAction(page,'更多文字操作');const menu=(await page.getByRole('toolbar',{name:'选中文字样式'}).boundingBox())!;expect(menu.x).toBeGreaterThanOrEqual(0);expect(menu.y+menu.height).toBeLessThanOrEqual(640);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(body).toBeVisible();
});
