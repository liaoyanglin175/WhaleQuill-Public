import {downloadedArchive} from './helpers';
import {test,expect} from '@playwright/test';

import {createRecord,encodeArchive} from '../../src/domain/models';
import {plainDocument} from '../../src/domain/rich-document';
import {expectNote,go,more} from './helpers';

for(const formatted of [false,true])test(`打开${formatted?'已有排版':'旧纯文本'}记录不产生修改，离开与备份保留原稿`,async({page},info)=>{
  const text=formatted?'以前排过版的文字。':'第一行\r\n需要记住的原话。\r\n最后一行',record={...createRecord(),title:'以前的记录',body:text};
  if(formatted){record.document=plainDocument(text);record.document.content[0].attrs={id:crypto.randomUUID()};record.document.content[0].content![0].marks=[{type:'bold'}];}
  await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'original.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:[record],tasks:[]}))});
  await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.locator('.record-card')).toHaveCount(1);await page.locator('.record-card').click();
  await expect(page.locator('.rich-body')).toHaveAttribute('data-editor-ready','true');await expectNote(page.locator('.rich-body'),text);
  await expect(page.locator('.save-state')).toHaveText('已保存在本机');await page.waitForTimeout(350);await expect(page.locator('.save-state')).toHaveText('已保存在本机');
  await go(page,'回顾');await expect(page.locator('.save-bubble,dialog[open]')).toHaveCount(0);await more(page);
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'完整备份',exact:true}).click();const file=info.outputPath('unchanged.json');await(await downloading).saveAs(file);
  const original=(await downloadedArchive(page,file)).snapshot.records[0];expect(original.body).toBe(text);expect(original.document??null).toEqual(record.document??null);expect(original.updatedAt).toBe(record.updatedAt);
});

test('窄窗口顶部只留核心导航，文字选区浮层不挤正文并支持键盘收起',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();
  const body=page.getByLabel('记录正文',{exact:true});await body.fill('今天留下的一句话。\n明天还能想起来。');
  await expect(page.locator('.toolbar-actions>button')).toHaveCount(0);expect((await page.locator('.editor-toolbar').boundingBox())!.height).toBeLessThanOrEqual(56);
  const top=(await body.boundingBox())!.y;await body.press('Control+Home');await body.press('Shift+End');
  const menu=page.getByRole('toolbar',{name:'选中文字样式'});await expect(menu).toBeVisible();expect(await page.evaluate(()=>getSelection()?.toString())).toBe('今天留下的一句话。');
  await expect(menu.getByLabel('字体',{exact:true})).toHaveCount(0);await menu.getByRole('button',{name:'更多文字操作',exact:true}).click();await expect(menu.getByLabel('字体',{exact:true})).toBeVisible();
  expect(Math.abs((await body.boundingBox())!.y-top)).toBeLessThan(2);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.keyboard.press('Escape');await expect(menu.getByLabel('字体',{exact:true})).toHaveCount(0);await page.keyboard.press('Escape');await expect(menu).not.toBeVisible();
  await page.locator('.editor-tools summary').click();await expect(page.getByRole('button',{name:'发布到广场',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'创建任务',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.locator('.save-state')).toContainText('尚未保存');
});

test('固定角色连续播放和回到待机，触摸不保存，减少动态停帧',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('/');
 const video=page.locator('.character-video');await expect(video).toHaveAttribute('data-loaded','true');const first=await video.getAttribute('data-time');await expect.poll(()=>video.getAttribute('data-time')).not.toBe(first);
 await page.getByRole('button',{name:'写一条',exact:true}).click();await page.getByLabel('记录正文',{exact:true}).fill('还没决定要不要保存。');await page.locator('.companion-character').click({position:{x:28,y:9}});await expect(video).toHaveAttribute('data-action',/^(pat|wave|shy|laugh|bow|yawn)$/);await expect(page.locator('.save-bubble')).toHaveCount(0);
 await page.waitForTimeout(1800);await video.locator('video').evaluateAll(elements=>{for(const element of elements)if(getComputedStyle(element).opacity==='1')element.dispatchEvent(new Event('ended'));});await expect(video).toHaveAttribute('data-action','idle');await expect(video).toHaveAttribute('data-loaded','true');
 await go(page,'回顾');await expect(page.locator('.save-bubble')).toBeVisible();await page.getByRole('dialog').getByRole('button',{name:'继续写',exact:true}).click();await expectNote(page.getByLabel('记录正文',{exact:true}),'还没决定要不要保存。');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'伙伴',exact:true}).click();await page.getByRole('checkbox',{name:'减少动态',exact:true}).check();await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(video).toHaveAttribute('data-paused','true');
 const times=await video.locator('video').evaluateAll(elements=>elements.map(element=>(element as HTMLVideoElement).currentTime));await page.waitForTimeout(250);expect(await video.locator('video').evaluateAll(elements=>elements.map(element=>(element as HTMLVideoElement).currentTime))).toEqual(times);
 await page.reload();await expect(page.locator('.companion-dock')).toHaveAttribute('data-renderer','video');expect(errors).toEqual([]);
});



