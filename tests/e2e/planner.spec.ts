import {test,expect} from '@playwright/test';
import {go} from './helpers';
import {createRecord,createTask,encodeArchive,taskSchema} from '../../src/domain/models';
import {nextPlannerDay} from '../../src/domain/planner';

async function stored(page:import('@playwright/test').Page){return page.evaluate(()=>new Promise<any[]>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>{const db=request.result,query=db.transaction('tasks').objectStore('tasks').getAll();query.onsuccess=()=>{db.close();resolve(query.result);};query.onerror=()=>reject(query.error);};}));}
test('日程常驻且公开入口一致暂停，写作不请求公开服务',async({page})=>{
 const requests:string[]=[];page.on('request',request=>{if(/\/api\/(posts|me|login|register)|:4318/.test(request.url()))requests.push(request.url());});await page.goto('/');await expect(page.getByRole('navigation').getByRole('button',{name:/日程/})).toBeVisible();await expect(page.getByRole('button',{name:'灵感广场',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'写一条',exact:true}).click();await page.getByLabel('记录正文',{exact:true}).fill('只留在本机的想法。');await page.locator('.editor-tools summary').click();await expect(page.getByRole('button',{name:'发布到广场',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'导出 Markdown',exact:true})).toBeVisible();expect(requests).toEqual([]);
});
test('无日期待办可直接创建，重要与删除收进更多菜单，完成可恢复',async({page})=>{
 await page.goto('/');await go(page,'日程');await page.getByLabel('新任务名称').fill('整理想法');await page.getByRole('button',{name:'添加任务',exact:true}).click();await expect(page.locator('.task-row')).toHaveCount(1);await expect(page.locator('.section-intro')).toHaveCount(0);
 await page.getByLabel('事项操作：整理想法',{exact:true}).click();await page.getByRole('button',{name:'标为重要',exact:true}).click();await expect(page.locator('.planner-important')).toHaveText('重要');
 await page.getByRole('button',{name:'完成任务：整理想法',exact:true}).click();await page.getByRole('button',{name:'展开已完成 · 1',exact:true}).click();await expect(page.locator('.task-row')).toHaveClass(/completed/);await expect(page.locator('.planner-cleanup-hint')).toContainText('次日');
 const [saved]=await stored(page);expect(saved.completedAt).not.toBeNull();expect(saved.cleanupOn).toBe(nextPlannerDay());await page.getByRole('button',{name:'标为未完成：整理想法',exact:true}).click();expect((await stored(page))[0].completedAt).toBeNull();
});
test('行程可设置时间地点备注，编辑后重启保留，往期折叠',async({page})=>{
 await page.goto('/');await go(page,'日程');await page.getByRole('tab',{name:'行程',exact:true}).click();await page.getByLabel('行程名称',{exact:true}).fill('去图书馆');await page.getByLabel('全天',{exact:true}).uncheck();await page.getByLabel('开始时间',{exact:true}).fill('14:00');await page.getByLabel('结束时间（可选）').fill('16:00');await page.getByText('地点与更多信息',{exact:true}).click();await page.getByLabel('地点（可选）').fill('市图书馆');await page.getByLabel('备注（可选）').fill('带上借阅卡');await page.getByRole('button',{name:'添加行程',exact:true}).click();
 await expect(page.locator('.event-row')).toContainText('14:00–16:00');await expect(page.locator('.event-row')).toContainText('市图书馆');await expect(page.locator('.event-row .task-checkbox')).toHaveCount(0);
 await page.getByRole('button',{name:'编辑行程：去图书馆',exact:true}).click();const edit=page.getByRole('dialog',{name:'编辑行程'});expect((await edit.getByLabel('全天',{exact:true}).boundingBox())!.width).toBeLessThanOrEqual(24);await edit.getByLabel('行程名称',{exact:true}).fill('去借书');await page.getByRole('button',{name:'保存行程',exact:true}).click();await page.reload();await go(page,'日程');await expect(page.getByRole('tab',{name:'行程',exact:true})).toHaveAttribute('aria-selected','true');await expect(page.locator('.event-row')).toContainText('去借书');
});
test('行程拒绝结束早于开始，跨日行程进入便签但不进入完成列表',async({page})=>{
 await page.goto('/');await go(page,'日程');await page.getByRole('tab',{name:'行程',exact:true}).click();await page.getByLabel('行程名称',{exact:true}).fill('夜间出行');await page.getByLabel('全天',{exact:true}).uncheck();await page.getByLabel('开始时间',{exact:true}).fill('23:00');await page.getByLabel('结束时间（可选）').fill('01:00');await page.getByRole('button',{name:'添加行程',exact:true}).click();await expect(page.getByRole('alert')).toContainText('结束时间不能早于开始时间');
 await page.getByText('地点与更多信息',{exact:true}).click();await page.getByLabel('结束日期（可选）').fill(nextPlannerDay());await page.getByRole('button',{name:'添加行程',exact:true}).click();await expect(page.locator('.event-row')).toContainText('夜间出行');
 await page.goto('/?view=task-strip');await expect(page.getByText('今日行程',{exact:true})).toBeVisible();await expect(page.locator('.strip-event')).toContainText('夜间出行');await expect(page.getByRole('checkbox')).toHaveCount(0);
});
test('跨日只清理已完成待办，恢复为未完成且不再自动清理',async({page})=>{
 const done=taskSchema.parse({...createTask('应清理'),status:'done',completedAt:new Date(2020,0,1).toISOString(),cleanupOn:'2020-01-02'}),todo=createTask('未完成保留');const note={...createRecord(),title:'原稿保留',body:'我的原稿仍在。'};
 await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'planner.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:[note],tasks:[{...done,sourceRecordId:note.id},todo]}))});await page.getByRole('button',{name:'确认导入',exact:true}).click();await go(page,'日程');await expect(page.locator('.task-row')).toHaveCount(1);await expect(page.locator('.task-row')).toContainText('未完成保留');
 await go(page,'回收站');await expect(page.locator('.trash-row')).toContainText('应清理');await page.getByRole('button',{name:'恢复任务：应清理',exact:true}).click();await go(page,'日程');await expect(page.locator('.task-row')).toHaveCount(2);await page.reload();await go(page,'日程');await expect(page.locator('.task-row')).toHaveCount(2);await go(page,'随记');await expect(page.locator('.record-card,.memory-card')).toContainText('原稿保留');
});
test('旧备份已完成任务获得过渡，关闭清理保留事项，草稿在视图间保留',async({page})=>{
 const legacy={...createTask('旧完成'),status:'done' as const};await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'old.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:[],tasks:[legacy]}))});await page.getByRole('button',{name:'确认导入',exact:true}).click();await go(page,'日程');const [saved]=await stored(page);expect(saved.completedAt).toBeNull();expect(saved.cleanupOn).toBe(nextPlannerDay());
 await page.getByLabel('新任务名称').fill('还没添加');await page.getByRole('tab',{name:'行程',exact:true}).click();await page.getByLabel('行程名称',{exact:true}).fill('行程草稿');await go(page,'随记');await go(page,'日程');await expect(page.getByLabel('行程名称',{exact:true})).toHaveValue('行程草稿');await page.getByRole('tab',{name:'待办',exact:true}).click();await expect(page.getByLabel('新任务名称')).toHaveValue('还没添加');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('次日清理已完成待办').uncheck();await page.getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.planner-done')).toHaveCount(0);expect((await stored(page)).some(task=>task.id===legacy.id)).toBe(true);
});
test('关闭首页回顾不影响主动翻阅，短记录不重复，回顾标题与正文对齐',async({page})=>{
 const note={...createRecord(),title:'短短一句',body:'短短一句',createdAt:new Date(Date.now()-86400000*3).toISOString()};await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'recall.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:[note],tasks:[]}))});await page.getByRole('button',{name:'确认导入',exact:true}).click();await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByLabel('首页回顾频率').selectOption('off');await page.getByRole('button',{name:'关闭',exact:true}).click();await go(page,'回顾');await expect(page.locator('.recall-feature')).toBeVisible();await expect(page.locator('.recall-feature').getByText('短短一句',{exact:true})).toHaveCount(1);
 const header=(await page.locator('.page-header').boundingBox())!,card=(await page.locator('.recall-feature').boundingBox())!,tabs=(await page.locator('.recall-bar').boundingBox())!;expect(Math.abs(header.x-card.x)).toBeLessThanOrEqual(2);expect(Math.abs(tabs.x-card.x)).toBeLessThanOrEqual(2);
 await page.getByRole('button',{name:'查找其他记录',exact:true}).click();await expect(page.getByRole('region',{name:'笺间对话',exact:true})).toBeVisible();
});
test('中文组词不误添加，中英窄窗口不横向溢出',async({page})=>{
 await page.goto('/');await go(page,'日程');const input=page.getByLabel('新任务名称');await input.fill('组词中');await input.dispatchEvent('compositionstart');await input.press('Enter');expect(await stored(page)).toHaveLength(0);await input.dispatchEvent('compositionend');await input.press('Enter');await expect(page.locator('.task-row')).toHaveCount(1);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('button',{name:'Close',exact:true}).click();await page.setViewportSize({width:390,height:844});await expect(page.getByRole('heading',{name:'Planner',exact:true})).toBeVisible();await page.getByRole('tab',{name:'Schedule',exact:true}).click();await expect(page.getByRole('button',{name:'Add event'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('窄窗口切换回顾视图后伙伴自动避让新显示的列表',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('dafeiyu-companion-v3',JSON.stringify({visible:true,wandering:false,position:null,size:56})));
 const notes=Array.from({length:4},(_,index)=>({...createRecord(),title:`往事 ${index}`,body:`值得留下的一段经历 ${index}`,createdAt:new Date(Date.now()-(index+2)*86400000).toISOString()}));
 await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'memories.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records:notes,tasks:[]}))});await page.getByRole('button',{name:'确认导入',exact:true}).click();await go(page,'回顾');await page.getByRole('tab',{name:'主题',exact:true}).click();await page.setViewportSize({width:390,height:844});await page.getByRole('tab',{name:'旧事',exact:true}).click();
 await expect.poll(()=>page.evaluate(()=>{const pet=document.querySelector('.companion-character')!.getBoundingClientRect();return [...document.querySelectorAll('.recall-history-row,.recall-feature')].some(element=>{const rect=element.getBoundingClientRect();return rect.width>0&&pet.left<rect.right&&pet.right>rect.left&&pet.top<rect.bottom&&pet.bottom>rect.top;});})).toBe(false);
});
