import {test,expect} from '@playwright/test';
import {createTask} from '../../src/domain/models';
import type {Task} from '../../src/domain/models';

async function seed(page:import('@playwright/test').Page,tasks:Task[]){
 await page.goto('/?view=task-strip');await expect(page.getByRole('main',{name:'鲸笺便签'})).toBeVisible();await expect(page.locator('.strip-empty')).toHaveText('暂时没有待办。');
 await page.evaluate(tasks=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('tasks','readwrite');for(const task of tasks)tx.objectStore('tasks').put(task);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};}),tasks);
 await page.reload();await expect(page.locator('.strip-count')).toHaveText(String(tasks.filter(task=>task.status==='todo').length));
}
test('待办勾选保留原行、删除线和撤销，重新打开后已完成折叠',async({page})=>{
 await page.setViewportSize({width:304,height:288});const task=createTask('整理今天的想法',null),next=createTask('确认报价','2026-11-02');await seed(page,[task,next]);
 const before=await page.locator('.strip-task-title').allTextContents();
 await page.getByRole('checkbox',{name:'完成任务：整理今天的想法'}).click();await expect(page.locator('.strip-count')).toHaveText('1');
 expect(await page.locator('.strip-task-title').allTextContents()).toEqual(before);await expect(page.locator('.is-done .strip-task-title')).toHaveCSS('text-decoration-line','line-through');
 await page.getByRole('checkbox',{name:'标为未完成：整理今天的想法'}).click();await expect(page.locator('.strip-count')).toHaveText('2');
 await page.getByRole('checkbox',{name:'完成任务：整理今天的想法'}).click();await page.reload();await expect(page.locator('.strip-rows .strip-task')).toHaveCount(1);
 await page.getByRole('button',{name:'已完成 · 1',exact:true}).click();await expect(page.getByRole('checkbox',{name:'标为未完成：整理今天的想法'})).toBeChecked();
});
test('长清单在小便签内滚动，长标题不撑宽，空状态与英文可用',async({page})=>{
 await page.setViewportSize({width:304,height:288});const tasks=Array.from({length:9},(_,index)=>createTask(index===0?'非常长的待办内容'.repeat(20):`任务 ${index}`,null));await seed(page,tasks);
 expect(await page.locator('.strip-content').evaluate(el=>el.scrollHeight>el.clientHeight)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>localStorage.setItem('dafeiyu-language','en'));await page.reload();await expect(page.getByRole('main',{name:'WhaleQuill task note'})).toBeVisible();await expect(page.getByRole('button',{name:'Back to WhaleQuill'})).toBeVisible();
});
test('便签不加载笔记编辑器或角色视频，全部完成仍可撤销',async({page})=>{
 const requests:string[]=[];page.on('request',request=>requests.push(request.url()));await seed(page,[createTask('最后一项',null)]);
 await page.getByRole('checkbox',{name:'完成任务：最后一项'}).click();await expect(page.getByText('都完成了。',{exact:true})).toBeVisible();await expect(page.getByRole('checkbox',{name:'标为未完成：最后一项'})).toBeChecked();
 expect(requests.some(url=>/RichEditor|FishCompanion|\.webm/.test(url))).toBe(false);await expect(page.locator('video,.rich-body,.note-inquiry')).toHaveCount(0);
});
