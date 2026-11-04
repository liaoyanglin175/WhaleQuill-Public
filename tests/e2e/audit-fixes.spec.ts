import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {createTask,createRecord} from '../../src/domain/models';

async function openSaved(page:Page){
 await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();
 const body=page.getByLabel('记录正文',{exact:true});await body.fill('应该保留的原稿。');await page.getByRole('button',{name:'保存记录',exact:true}).click();
 await expect(page.locator('.save-state')).toHaveText('已保存在本机');return body;
}

test('角色气泡丢弃会恢复画面，后续保存不能带回丢弃内容',async({page})=>{
 const body=await openSaved(page);await body.fill('这段修改应该丢弃。');
 await page.locator('.companion-character').click({button:'right'});await page.getByRole('menuitem',{name:'保存记录',exact:true}).click();
 await page.locator('.save-bubble').getByRole('button',{name:'丢弃',exact:true}).click();await expect(body).toHaveText('应该保留的原稿。');
 await body.press('Control+End');await body.press('X');await page.getByRole('button',{name:'保存记录',exact:true}).click();
 await page.reload();await page.locator('.record-card').first().click();await expect(page.getByLabel('记录正文',{exact:true})).toHaveText('应该保留的原稿。X');
});

test('宽侧栏缩窄后可移动并保留宽窗口偏好',async({page})=>{
 await page.setViewportSize({width:1360,height:900});await openSaved(page);await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();
 await page.getByRole('button',{name:'固定为侧栏',exact:true}).click();await expect(page.locator('.note-inquiry')).toHaveClass(/is-docked/);
 await page.setViewportSize({width:780,height:620});const grip=page.getByRole('button',{name:'移动对话浮窗',exact:true});await expect(grip).toBeVisible();
 const before=(await page.locator('.note-inquiry').boundingBox())!;await grip.focus();await page.keyboard.press('ArrowLeft');
 await expect.poll(async()=>(await page.locator('.note-inquiry').boundingBox())!.x).toBeLessThan(before.x);
 await page.setViewportSize({width:1360,height:900});await expect(page.locator('.note-inquiry')).toHaveClass(/is-docked/);
 await page.getByRole('button',{name:'切换为浮窗',exact:true}).click();await expect(grip).toBeVisible();
});

test('拖动入口不能盖住保存，缩窗与刷新后仍可直接保存',async({page})=>{
 await page.setViewportSize({width:780,height:620});await openSaved(page);
 const launcher=page.getByRole('button',{name:'打开笺间对话',exact:true}),save=page.getByRole('button',{name:'保存记录',exact:true}),a=(await launcher.boundingBox())!,b=(await save.boundingBox())!;
 await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:10});await page.mouse.up();
 const unobstructed=()=>save.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!hit&&e.contains(hit);});
 await expect.poll(unobstructed).toBe(true);await page.setViewportSize({width:780,height:500});await expect.poll(unobstructed).toBe(true);await page.reload();await expect.poll(unobstructed).toBe(true);
});

test('同日截止按时分排序，时间到达后自动更新逾期分组',async({page})=>{
 await page.clock.install({time:new Date(2026,10,1,12)});await page.goto('/');await expect(page.locator('.version')).toHaveText(/0\.2\./);
 const tasks=[{...createTask('先截止','2026-11-01'),dueTime:'09:00',createdAt:'2026-10-31T00:00:00Z'},{...createTask('后截止','2026-11-01'),dueTime:'12:01'}];
 await page.evaluate(tasks=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction('tasks','readwrite');for(const task of tasks)tx.objectStore('tasks').put(task);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);}),tasks);
 await page.reload();await page.getByRole('navigation').getByRole('button',{name:/日程/}).click();
 await expect(page.locator('.task-edit-name')).toHaveText(['先截止','后截止']);await expect(page.locator('.planner-group').filter({has:page.getByRole('heading',{name:/逾期/})}).locator('.task-row')).toHaveCount(1);
 await page.clock.fastForward(61_000);await expect(page.locator('.planner-group').filter({has:page.getByRole('heading',{name:/逾期/})}).locator('.task-row')).toHaveCount(2);
});

test('英文窄首页筛选完整可达，便签勾选命中区至少24像素',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('dafeiyu-language','en'));await page.setViewportSize({width:390,height:844});await page.goto('/');await expect(page.locator('.version')).toHaveText(/0\.2\./);
 const records=[1,2].map(i=>({...createRecord(),title:'Layout '+i,body:'A small note '+i,tags:['A fairly long linked tag','Another tag']})),task=createTask('Check the task note',null);
 await page.evaluate(({records,task})=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction(['records','tasks'],'readwrite');for(const record of records)tx.objectStore('records').put(record);tx.objectStore('tasks').put(task);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);}),{records,task});
 await page.reload();await page.locator('.timeline-filter > summary').click();const filter=page.getByLabel('Filter notes by tag',{exact:true});await expect(filter).toBeVisible();
 const box=(await filter.boundingBox())!;expect(box.x+box.width).toBeLessThanOrEqual(390);await filter.selectOption({index:1});await expect(page.locator('.active-tag')).toBeVisible();
 await page.goto('/?view=task-strip');await page.setViewportSize({width:280,height:150});const check=page.getByRole('checkbox');await expect(check).toBeVisible();const target=(await check.boundingBox())!;expect(target.width).toBeGreaterThanOrEqual(24);expect(target.height).toBeGreaterThanOrEqual(24);
});
