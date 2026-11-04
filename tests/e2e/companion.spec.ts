import {expectNote} from './helpers';
import { test,expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const companion=(page:Page)=>page.getByRole('complementary',{name:'小肥鱼陪伴'});
const character=(page:Page)=>companion(page).locator('.companion-character');
async function menu(page:Page){await character(page).click({button:'right'});}
test('固定小巧大肥鱼连续动画，摸头戳脸有短回应',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');await expect(character(page).locator('.character-video')).toHaveAttribute('data-loaded','true');
 const box=(await character(page).boundingBox())!;expect(box.width).toBe(56);expect(box.height).toBe(56);await expect(companion(page)).toHaveAttribute('data-character','lanxi');
 await character(page).click({position:{x:28,y:9}});await expect(companion(page)).toHaveAttribute('data-mood','happy');await expect(companion(page).locator('.companion-bubble')).toBeVisible();expect((await companion(page).locator('.companion-bubble').textContent())!.length).toBeGreaterThan(1);
 await character(page).click({position:{x:28,y:25}});await expect(companion(page)).toHaveAttribute('data-mood','pout');await expect(companion(page)).toHaveAttribute('data-mood','idle');expect(errors).toEqual([]);
});
test('休息后不会被旧表情定时器唤醒，隐藏与再次显示正常',async({page})=>{
 await page.goto('/');await character(page).click({position:{x:28,y:9}});await menu(page);await page.getByRole('menuitem',{name:'休息',exact:true}).click();await expect(companion(page)).toHaveAttribute('data-mood','sleep');await page.waitForTimeout(1800);await expect(companion(page)).toHaveAttribute('data-mood','sleep');
 await character(page).focus();await page.keyboard.press('Space');await expect(companion(page)).toHaveAttribute('data-mood','happy');await menu(page);await page.getByRole('menuitem',{name:'隐藏角色'}).click();await expect(page.getByRole('button',{name:'显示大肥鱼',exact:true})).toBeVisible();await page.reload();await page.getByRole('button',{name:'显示大肥鱼',exact:true}).click();await expect(character(page)).toBeVisible();
});
test('拖动会固定位置，不误触保存，刷新和缩屏均保持在窗口内',async({page})=>{
 await page.goto('/');const before=(await character(page).boundingBox())!;await page.mouse.move(before.x+28,before.y+28);await page.mouse.down();await page.mouse.move(before.x+220,before.y-160,{steps:8});await page.mouse.up();await expect(page.locator('.save-bubble')).toHaveCount(0);const after=(await character(page).boundingBox())!;expect(after.x).toBeGreaterThan(before.x+150);await page.reload();await expect.poll(async()=>(await character(page).boundingBox())!.x).toBeCloseTo(after.x,0);await page.setViewportSize({width:390,height:844});await expect.poll(async()=>{const box=(await character(page).boundingBox())!;return box.x>=0&&box.y>=0&&box.x+box.width<=390&&box.y+box.height<=844;}).toBe(true);
});
test('手机触摸和方向键可移动，记录保存区域不被角色挡住',async({browser})=>{
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});await context.addInitScript(()=>localStorage.setItem('dafeiyu-language','zh'));
 try{const page=await context.newPage();await page.goto('/');const box=(await character(page).boundingBox())!;await page.touchscreen.tap(box.x+28,box.y+9);await expect(companion(page)).toHaveAttribute('data-mood','happy');await character(page).focus();await page.keyboard.press('ArrowRight');await page.getByRole('button',{name:'写一条'}).click();await page.getByLabel('记录正文',{exact:true}).fill('小角色也能陪着写。');const body=(await page.getByLabel('记录正文',{exact:true}).boundingBox())!,pet=(await character(page).boundingBox())!;expect(pet.x+pet.width<=body.x||pet.x>=body.x+body.width||pet.y+pet.height<=body.y||pet.y>=body.y+body.height).toBe(true);await page.getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.locator('.save-state')).toContainText('已保存在本机');}finally{await context.close();}
});
test('普通触摸只回应，明确请求保存才在身边询问，取消与显式保存均保留内容',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'写一条'}).click();const body=page.getByLabel('记录正文',{exact:true});await body.fill('尚未保存的想法');await character(page).click({position:{x:28,y:9}});await expect(companion(page).locator('.save-bubble')).toHaveCount(0);await menu(page);await page.getByRole('menuitem',{name:'保存记录',exact:true}).click();await expect(companion(page).locator('.save-bubble')).toBeVisible();await expect(page.locator('dialog[open]')).toHaveCount(0);await expect(page.getByRole('dialog')).toContainText('这一页，要保存吗？');await page.getByRole('dialog').getByRole('button',{name:'继续写',exact:true}).click();await expectNote(body,'尚未保存的想法');await page.keyboard.press('Control+s');await expect(page.locator('.save-state')).toContainText('已保存在本机');
});
test('减少动态效果会停止走动，输入时始终安静',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.clock.install();await page.goto('/');const initial=(await character(page).boundingBox())!;await page.clock.fastForward(60_000);await expect(companion(page)).toHaveAttribute('data-walking','false');expect((await character(page).boundingBox())!.x).toBe(initial.x);await page.getByLabel('随手记',{exact:true}).fill('仍然需要我自己保存');await page.clock.fastForward(30_000);await expect(companion(page)).toHaveAttribute('data-walking','false');await expect(page.locator('.record-card')).toHaveCount(0);
});
