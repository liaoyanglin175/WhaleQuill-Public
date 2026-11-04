import {findNotes,openFound} from './helpers';
import {expectNote,selectionState} from './helpers';
import {test,expect} from '@playwright/test';
import type {Page} from '@playwright/test';
import {createRecord} from '../../src/domain/models';
import {go,editorAction} from './helpers';

async function seed(page:Page){
  const old=new Date(Date.now()-12*86400000).toISOString();
  const records=[
    {...createRecord(),title:'河边的傍晚',body:'散步回来，晚风很舒服。\n记得下次带上相机。',createdAt:old,updatedAt:old},
    {...createRecord(),title:'云同步方案',body:'先不做云同步，把本地记录和完整导出做好。\n原因：希望隐私和数据能由自己掌握。',createdAt:old,updatedAt:old},
    {...createRecord(),title:'周末的小计划',body:'去公园走走。\n给家里添一束鲜花。'},
    {...createRecord(),title:'读书摘录',body:'今天读到一句话：认真生活，也给自己留下空白。'},
  ];
  await page.goto('/');await expect(page.getByLabel('随手记',{exact:true})).toBeVisible();
  await page.evaluate(async records=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');records.forEach(record=>tx.objectStore('records').put(record));tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();localStorage.setItem('dafeiyu-memory-cues-v1',JSON.stringify({day:new Date().toLocaleDateString('sv-SE'),frequency:'daily',selected:'record:'+records[0].id}));},records);
  await page.reload();await expect(page.locator('.daily-memory .memory-card')).toHaveCount(1);return records;
}
async function ask(page:Page,text:string){await page.getByLabel('询问已保存的笔记',{exact:true}).fill(text);await page.getByRole('button',{name:'提交询问',exact:true}).click();}
const inquiry=(page:Page)=>page.getByRole('region',{name:'笺间对话',exact:true});

test('首页首屏有一条旧事和两列近期卡片，回看不重复，收起后仍能访问全部记录',async({page})=>{
  await page.setViewportSize({width:1360,height:900});const records=await seed(page);
  await expect(page.locator('.card-layout .record-card')).toHaveCount(3);
  await expect(page.locator(`.card-layout [data-record-id="${records[0].id}"]`)).toHaveCount(0);
  const cards=page.locator('.card-layout .record-card'),a=(await cards.nth(0).boundingBox())!,b=(await cards.nth(1).boundingBox())!;
  expect(a.y).toBe(b.y);expect(b.x).toBeGreaterThan(a.x+a.width);expect(a.y+a.height).toBeLessThan(900);
  expect((await cards.nth(0).locator('time').boundingBox())!.y).toBe((await cards.nth(1).locator('time').boundingBox())!.y);
  expect((await page.locator('.quick-capture').boundingBox())!.height).toBeLessThan(155);
  await page.locator('.daily-memory .memory-reason .icon-button').click();await expect(cards).toHaveCount(4);
  const turn=await findNotes(page,'河边');await expect(turn.locator('.inquiry-match')).toHaveCount(1);await openFound(page,'河边');await expectNote(page.getByLabel('记录正文',{exact:true}),records[0].body);
});

test('浮窗询问与原文预览不提交草稿，关闭保留编辑选区和滚动',async({page})=>{
  await seed(page);await page.getByRole('button',{name:'写一条',exact:true}).click();
  const body=page.getByLabel('记录正文',{exact:true}),text=Array.from({length:90},(_,i)=>`第${i}行，还未保存的想法。`).join('\n');await body.fill(text);await body.press('Control+End');await body.press('Shift+Home');
  const before=await selectionState(body);
  await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await ask(page,'之前为什么不把资料放到网上？');await expect(inquiry(page).locator('.inquiry-match')).toHaveCount(1);
  await inquiry(page).getByRole('button',{name:'查看原文',exact:true}).click();await expect(page.getByRole('region',{name:'原文预览'})).toContainText('原因：希望隐私和数据能由自己掌握。');
  await inquiry(page).getByRole('button',{name:'关闭聊天'}).click();await expectNote(body,text);await expect(body).toBeFocused();
  expect(await selectionState(body)).toEqual(before);
  await expect(page.locator('.save-state')).toContainText('尚未保存');await go(page,'随记');await page.getByRole('dialog').getByRole('button',{name:'丢弃',exact:true}).click();await expect(page.locator('.app-footer')).toContainText('4 条已保存记录');
});

test('当前记录范围只查已保存版本，查询中的CtrlS不提交，输入法回车不误提问',async({page})=>{
  const records=await seed(page);await page.locator(`.record-card[data-record-id="${records[1].id}"]`).click();const body=page.getByLabel('记录正文',{exact:true});await body.fill(records[1].body+'\n草稿秘密航线');
  await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await page.getByLabel('查找范围',{exact:true}).selectOption('current');await ask(page,'草稿秘密航线');await expect(inquiry(page)).toContainText('暂未找到相关记录，换条线索试试。');
  const query=page.getByLabel('询问已保存的笔记',{exact:true});await query.fill('云同步');await query.press('Control+s');await expect(page.locator('.save-state')).toContainText('尚未保存');
  await query.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true});await expect(inquiry(page).locator('.inquiry-turn')).toHaveCount(1);await page.getByRole('button',{name:'提交询问',exact:true}).click();await expect(inquiry(page).locator('.inquiry-turn').last().locator('.inquiry-match')).toHaveCount(1);
  await inquiry(page).getByRole('button',{name:'关闭聊天'}).click();await go(page,'随记');await page.getByRole('dialog').getByRole('button',{name:'丢弃',exact:true}).click();await page.locator(`.record-card[data-record-id="${records[1].id}"]`).click();await expectNote(body,records[1].body);
});

test('打开完整来源遵守角色保存气泡，取消保留浮窗，丢弃后精确定位原文',async({page})=>{
  const records=await seed(page);await page.getByLabel('随手记',{exact:true}).fill('不能误保存的临时输入');await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await ask(page,'云同步');await inquiry(page).getByRole('button',{name:'查看原文'}).click();await inquiry(page).getByRole('button',{name:'打开记录'}).click();
  await expect(page.locator('.save-bubble')).toBeVisible();await expect(inquiry(page)).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'继续写',exact:true}).click();await expect(inquiry(page)).toBeVisible();await expect(page.getByLabel('随手记',{exact:true})).toHaveValue('不能误保存的临时输入');
  const quote=await inquiry(page).locator('.inquiry-source-text mark').innerText();await inquiry(page).getByRole('button',{name:'打开记录'}).click();await page.getByRole('dialog').getByRole('button',{name:'丢弃',exact:true}).click();await expect(inquiry(page)).toHaveCount(0);
  const body=page.getByLabel('记录正文',{exact:true});await expectNote(body,records[1].body);expect(await body.evaluate(()=>getSelection()?.toString()??'')).toBe(quote);
  await expect(page.locator('.app-footer')).toContainText('4 条已保存记录');
});

test('浮窗可固定侧栏并让出编辑空间，设置与任务预览优先，角色菜单可唤起',async({page})=>{
  await page.setViewportSize({width:1360,height:900});await seed(page);await page.getByRole('button',{name:'写一条',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true});await body.fill('待办：检查来源');
  await page.locator('.companion-character').click({button:'right'});await page.getByRole('menuitem',{name:'笺间对话',exact:true}).click();await expect(inquiry(page)).toBeVisible();await inquiry(page).getByRole('button',{name:'固定为侧栏'}).click();
  const main=(await page.locator('.main-area').boundingBox())!,panel=(await inquiry(page).boundingBox())!;expect(main.x+main.width).toBeLessThanOrEqual(panel.x+1);await expectNote(body,'待办：检查来源');
  await page.getByRole('button',{name:'设置',exact:true}).click();await expect(inquiry(page)).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(inquiry(page)).toBeVisible();
  await inquiry(page).getByRole('button',{name:'切换为浮窗'}).click();await inquiry(page).getByRole('button',{name:'关闭聊天'}).click();await editorAction(page,'创建任务');await expect(page.getByRole('button',{name:'打开笺间对话',exact:true})).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('button',{name:'打开笺间对话',exact:true})).toBeVisible();
});

test('手机浮窗和英文控件可用，关闭后问题保留，空范围明确显示',async({page})=>{
  await page.setViewportSize({width:390,height:844});await seed(page);await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'English',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Open Quill conversation',exact:true}).click();await page.getByLabel('Ask your saved notes',{exact:true}).fill('cloud sync');await page.getByRole('button',{name:'Ask',exact:true}).click();await expect(page.locator('.inquiry-match')).toHaveCount(1);await expect(page.locator('.note-inquiry')).toContainText('Saved notes only');
  const box=(await page.locator('.note-inquiry').boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.y).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);expect(box.y+box.height).toBeLessThanOrEqual(844);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'Close chat'}).click();await page.getByRole('button',{name:'Open Quill conversation',exact:true}).click();await expect(page.locator('.inquiry-turn')).toHaveCount(1);await expect(page.getByLabel('Search in',{exact:true}).locator('option[value=current]')).toBeDisabled();
});

test('只有标题的记录也能预览来源，移入回收站后浮窗清除旧来源',async({page})=>{
  await seed(page);await page.getByRole('button',{name:'写一条',exact:true}).click();await page.getByLabel('记录标题',{exact:true}).fill('只有标题的回忆');await page.getByRole('button',{name:'保存记录',exact:true}).click();
  await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await ask(page,'只有标题的回忆');await inquiry(page).getByRole('button',{name:'查看原文',exact:true}).click();await expect(page.getByRole('region',{name:'原文预览'})).toContainText('这条记录只有标题。');
  await editorAction(page,'删除当前记录');await expect(inquiry(page)).toHaveCount(0);await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();await expect(inquiry(page)).toBeVisible();await expect(inquiry(page).locator('.inquiry-match')).toHaveCount(0);await expect(inquiry(page)).toContainText('暂未找到相关记录，换条线索试试。');await expect(page.getByRole('region',{name:'原文预览'})).toHaveCount(0);
});

test('角落入口让出保存按钮，空库提示与Esc关闭正常',async({page})=>{
  for(const viewport of [{width:1360,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);await page.goto('/');await page.getByLabel('随手记',{exact:true}).focus();await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await expect(inquiry(page)).toContainText('先记下一条，再来翻阅。');await expect(page.getByRole('button',{name:'提交询问',exact:true})).toBeDisabled();await page.getByLabel('询问已保存的笔记',{exact:true}).press('Escape');await expect(inquiry(page)).toHaveCount(0);await expect(page.getByLabel('随手记',{exact:true})).toBeFocused();
    await page.getByRole('button',{name:'写一条',exact:true}).click();await page.getByLabel('记录正文',{exact:true}).fill('保存按钮必须一直可点击');
    const save=(await page.getByRole('button',{name:'保存记录',exact:true}).boundingBox())!,entry=(await page.getByRole('button',{name:'打开笺间对话',exact:true}).boundingBox())!;expect(save.x+save.width<=entry.x||save.x>=entry.x+entry.width||save.y+save.height<=entry.y||save.y>=entry.y+entry.height).toBe(true);
    await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();const panel=(await inquiry(page).boundingBox())!;expect(save.x+save.width<=panel.x||save.x>=panel.x+panel.width||save.y+save.height<=panel.y||save.y>=panel.y+panel.height).toBe(true);
    await page.getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.locator('.save-state')).toContainText('已保存在本机');await inquiry(page).getByRole('button',{name:'关闭聊天'}).click();
    // Clear this isolated browser fixture before exercising the second viewport.
    await editorAction(page,'删除当前记录');await page.getByRole('dialog').getByRole('button',{name:'确认删除',exact:true}).click();
  }
});
