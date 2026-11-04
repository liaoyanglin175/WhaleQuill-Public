import {expectNote,selectionAction} from './helpers';
import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {createRecord} from '../../src/domain/models';
import {go} from './helpers';

async function oldNotes(page:Page){
 const stamp=new Date(Date.now()-12*86_400_000).toISOString();
 const notes=['河边散步留下的想法','离线资料整理计划','想再读一次的书'].map(title=>({...createRecord(),title,body:`${title}。\n这是之前留给自己的记录。`,createdAt:stamp,updatedAt:stamp}));
 await page.goto('/');await expect(page.getByLabel('随手记',{exact:true})).toBeVisible();
 await page.evaluate(async notes=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');notes.forEach(note=>tx.objectStore('records').put(note));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();},notes);
 await page.reload();return notes;
}
test('普通旧记录每天默认一条，换一条与刷新保持选择，原文选区准确',async({page})=>{
 const notes=await oldNotes(page),card=page.locator('.daily-memory .memory-card');await expect(card).toHaveCount(1);const first=await card.locator('h3').innerText();await page.getByRole('button',{name:'换一条',exact:true}).click();await expect(card.locator('h3')).not.toHaveText(first);const second=await card.locator('h3').innerText();await page.reload();await expect(card.locator('h3')).toHaveText(second);await card.getByRole('button',{name:'打开记录'}).click();const body=page.getByLabel('记录正文',{exact:true});expect(await body.evaluate(()=>(getSelection()?.toString()??'').replace(/\n\n/g,'\n'))).toBe(notes.find(note=>note.title===second)!.body);await expect(page.locator('.record-card')).toHaveCount(3);
});
test('今天收起跨刷新保留，跨天出现未看过的旧记录',async({page})=>{
 await page.clock.install({time:new Date('2026-10-27T12:00:00+08:00')});await oldNotes(page);const first=await page.locator('.daily-memory h3').innerText();await page.locator('.daily-memory .memory-reason .icon-button').click();await page.reload();await expect(page.locator('.daily-memory .memory-card')).toHaveCount(0);await expect(page.getByRole('button',{name:'展开今日回顾'})).toBeVisible();await page.clock.setSystemTime(new Date('2026-10-28T12:00:00+08:00'));await page.clock.fastForward(60_100);await expect(page.locator('.daily-memory .memory-card')).toHaveCount(1);await expect(page.locator('.daily-memory h3')).not.toHaveText(first);
});
test('回顾频率在设置中可关闭与恢复，不改变正式记录',async({page})=>{
 await oldNotes(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('首页回顾频率',{exact:true}).selectOption('quiet');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await page.reload();await page.getByRole('button',{name:'设置',exact:true}).click();await expect(page.getByLabel('首页回顾频率',{exact:true})).toHaveValue('quiet');await page.getByLabel('首页回顾频率',{exact:true}).selectOption('off');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.daily-memory .memory-card')).toHaveCount(0);await page.getByRole('button',{name:'开启首页回顾'}).click();await expect(page.locator('.daily-memory .memory-card')).toHaveCount(1);await expect(page.locator('.record-card')).toHaveCount(2);await expect(page.locator('.app-footer')).toContainText('3 条已保存记录');
});
test('选中文字直接转任务，取消不提交，确认时明确保存来源',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true}),text='整理资料\n把这段话变成关联任务';await body.fill(text);await body.press('Control+End');await body.press('Shift+Home');await selectionAction(page,'转为任务');await expect(page.getByRole('textbox',{name:'任务名称'})).toHaveValue('把这段话变成关联任务');await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.locator('.record-card')).toHaveCount(0);await expect(page.locator('.save-state')).toContainText('尚未保存');await selectionAction(page,'转为任务');await page.getByRole('dialog').getByRole('button',{name:'保存记录并添加任务',exact:true}).click();await expect(page.locator('.save-state')).toContainText('已保存在本机');await go(page,'任务清单');await expect(page.getByRole('button',{name:'编辑任务：把这段话变成关联任务',exact:true})).toBeVisible();await page.locator('.source-link').click();await expectNote(body,text);
});
test('窄屏粘贴长文本和代码后，选择与继续输入不引起编辑区跳动',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true}),text='长文本与代码\n```js\n'+Array.from({length:220},(_,i)=>`const value${i} = "中文与 emoji 😀，保留所有原文";`).join('\n')+'\n```\n最后一段文字';await body.fill(text);await body.press('Control+End');const before=(await body.boundingBox())!;const scroll=await body.evaluate((input:HTMLElement)=>input.closest('.editor-content')!.scrollTop);await body.press('Shift+Home');await expect(page.getByRole('toolbar',{name:'选中文字样式'})).toBeVisible();const selected=(await body.boundingBox())!;expect(Math.abs(selected.y-before.y)).toBeLessThan(2);expect(Math.abs(await body.evaluate((input:HTMLElement)=>input.closest('.editor-content')!.scrollTop)-scroll)).toBeLessThan(3);await body.press('End');await page.keyboard.insertText('，继续记录');await expectNote(body,text+'，继续记录');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(page.locator('.record-card')).toHaveCount(0);await page.keyboard.press('Control+s');await expect(page.locator('.save-state')).toContainText('已保存在本机');await expectNote(body,text+'，继续记录');
});

