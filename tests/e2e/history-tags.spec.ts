import {test,expect,type Page} from '@playwright/test';
import {createRecord,encodeArchive,type NoteRecord} from '../../src/domain/models';
import {recallNotes,recallNow} from '../fixtures/recall-scenarios';
import {expectNote} from './helpers';

async function seed(page:Page,records:NoteRecord[]){
 await page.goto('/');await page.getByLabel('选择备份文件').setInputFiles({name:'synthetic.json',mimeType:'application/json',buffer:Buffer.from(encodeArchive({records,tasks:[]}))});await page.getByRole('button',{name:'确认导入',exact:true}).click();await expect(page.locator('.app-footer')).toContainText(`${records.length} 条已保存记录`);
}
async function stored(page:Page,id:string){return page.evaluate(id=>new Promise<NoteRecord>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,r=db.transaction('records').objectStore('records').get(id);r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);};}),id);}
async function manage(page:Page,tag:string){await page.getByRole('button',{name:`管理标签：${tag}`,exact:true}).click();return page.getByRole('dialog',{name:`管理标签：${tag}`,exact:true});}

test('旧标签取消和更名可撤销，只改本条且手动保存，纯文本原稿不被改写',async({page})=>{
 const record={...createRecord(),title:'旧标签原稿',body:'旧版\r\n原稿\r\n末行',tags:['旅行','学习']},peer={...createRecord(),title:'另一条旅行',body:'同一个标签。',tags:['旅行']};
 await seed(page,[record,peer]);await page.locator('.record-card').filter({hasText:record.title}).click();const body=page.getByLabel('记录正文',{exact:true});await expect(body).toHaveAttribute('data-editor-ready','true');
 let menu=await manage(page,'旅行');await expect(menu).toContainText('仅修改本条记录');await menu.getByLabel('标签名称').fill('周末');await menu.getByRole('button',{name:'更名',exact:true}).click();
 await expect(page.locator('.save-state')).toContainText('尚未保存');expect((await stored(page,record.id)).tags).toEqual(['旅行','学习']);await expectNote(body,record.body);
 await body.press('Control+z');await expect(page.locator('.save-state')).toHaveText('已保存在本机');await expect(page.getByRole('button',{name:'管理标签：旅行',exact:true})).toBeVisible();
 await body.press('Control+y');await page.getByRole('button',{name:'保存记录',exact:true}).click();const saved=await stored(page,record.id);expect(saved.tags).toEqual(['周末','学习']);expect(saved.body).toBe(record.body);expect(saved.document).toBeNull();expect((await stored(page,peer.id)).tags).toEqual(['旅行']);
 menu=await manage(page,'周末');await menu.getByRole('button',{name:'取消此标签',exact:true}).click();await expect(page.getByRole('button',{name:'管理标签：周末',exact:true})).toHaveCount(0);await body.press('Control+z');await expect(page.getByRole('button',{name:'管理标签：周末',exact:true})).toBeVisible();await expect(page.locator('.save-state')).toHaveText('已保存在本机');
});

test('内联标签同名多处一起更名和取消，一次撤销保留原文、格式与重点',async({page})=>{
 const record={...createRecord(),title:'两处关联',body:'#英语单词，继续#英语单词。',tags:['英语单词']};const memoryId=crypto.randomUUID();
 record.highlights=[{id:memoryId,start:0,end:5,text:'#英语单词',createdAt:record.createdAt,stale:false}];
 record.document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'#英语单词',marks:[{type:'tag',attrs:{id:crypto.randomUUID()}},{type:'bold'},{type:'memory',attrs:{id:memoryId,createdAt:record.createdAt}}]},{type:'text',text:'，继续'},{type:'text',text:'#英语单词',marks:[{type:'tag',attrs:{id:crypto.randomUUID()}},{type:'italic'}]},{type:'text',text:'。'}]}]};
 await seed(page,[record]);await page.getByRole('button',{name:'打开记录',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true});await expect(body).toHaveAttribute('data-editor-ready','true');
 let menu=await manage(page,'英语单词');await menu.getByLabel('标签名称').fill('English');await menu.getByRole('button',{name:'更名',exact:true}).click();await expectNote(body,record.body);await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#English');
 await body.press('Control+z');await expectNote(body,record.body);await expect(body.locator('strong')).toContainText('#英语单词');await expect(body.locator('em')).toContainText('#英语单词');await expect(page.locator('.editor-highlights li.stale')).toHaveCount(0);
 await body.press('Control+y');menu=await manage(page,'English');await menu.getByRole('button',{name:'取消此标签',exact:true}).click();await expectNote(body,record.body);await expect(body.locator('.inline-tag')).toHaveCount(0);
 await body.press('Control+z');await expectNote(body,record.body);await expect(page.locator('.editor-content>.record-tags .tag-link')).toHaveText('#English');await page.getByRole('button',{name:'保存记录',exact:true}).click();const saved=await stored(page,record.id);expect(saved.tags).toEqual(['English']);expect(JSON.stringify(saved.document)).not.toContain('legacyTags');
});

test('换种说法结合时间和人物找到原文，标签与周五约束不会被忽略',async({page})=>{
 await page.clock.install({time:recallNow});await seed(page,recallNotes);await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();const panel=page.getByRole('region',{name:'笺间对话',exact:true});
 async function ask(text:string){await panel.getByLabel('询问已保存的笔记').fill(text);await panel.getByRole('button',{name:'提交询问',exact:true}).click();return panel.locator('.inquiry-turn').last();}
 let turn=await ask('上周出去散心的那次');await expect(turn.locator('.inquiry-match')).toHaveCount(1);await expect(turn).toContainText('海边散步');await expect(turn).toContainText('2026-10-19');await expect(turn).toContainText('2026-10-25');await turn.getByRole('button',{name:'查看原文',exact:true}).click();await expect(panel.getByRole('region',{name:'原文预览'})).toContainText('和小林去海边散步');await panel.getByRole('button',{name:'返回查找结果',exact:true}).click();
 turn=await ask('上周和李雷散心');await expect(turn.locator('.inquiry-match')).toHaveCount(0);await expect(turn).toContainText('暂未找到相关记录，换条线索试试。');turn=await ask('上周五 #项目');await expect(turn.locator('.inquiry-match')).toHaveCount(1);await expect(turn).toContainText('给阿宁发送报价');
});

test('主题回顾在回顾页保留筛选，原文预览与明确讨论共享同一来源',async({page})=>{
 await page.clock.install({time:recallNow});await seed(page,recallNotes);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'回顾'}).click();const hub=page.getByRole('region',{name:'回顾记录',exact:true});await hub.getByRole('tab',{name:'主题',exact:true}).click();
 await hub.getByLabel('回顾线索').fill('云同步');await hub.getByLabel('回顾标签').selectOption('项目');await hub.locator('.history-review-form').getByRole('button',{name:'回顾',exact:true}).click();
 await expect(hub.locator('.history-timeline h3')).toHaveText(['暂缓云同步','预算调整']);await expect(hub.getByRole('region',{name:'原文脉络'})).toContainText('200元');await expect(hub.getByRole('region',{name:'原文脉络'})).toContainText('500元');
 await hub.locator('.history-timeline li').first().getByRole('button',{name:'查看原文 [1]',exact:true}).click();const panel=page.getByRole('region',{name:'笺间对话',exact:true});await expect(panel.getByRole('region',{name:'原文预览'})).toContainText('预算只有200元');await panel.getByRole('button',{name:'返回回顾',exact:true}).click();await expect(panel).toHaveCount(0);await expect(hub.locator('.history-timeline li')).toHaveCount(2);await expect(hub.getByLabel('回顾线索')).toHaveValue('云同步');
 await hub.getByRole('button',{name:'和大肥鱼聊聊这段经历',exact:true}).click();await expect(panel.locator('.ai-review-scope')).toContainText('#项目');await panel.getByRole('button',{name:'发送前预览',exact:true}).click();await expect(panel.locator('.ai-source')).toHaveCount(2);await expect(panel.locator('.ai-send-preview')).not.toContainText('给小林发送报价');await expect(panel.getByRole('button',{name:'发送并思考',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'关闭聊天',exact:true}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'随记'}).click();await page.locator('.record-card').filter({hasText:'预算调整'}).click();await page.getByLabel('记录正文',{exact:true}).fill('云同步已进入试验阶段。');await page.getByRole('button',{name:'保存记录',exact:true}).click();await page.getByRole('button',{name:'打开笺间对话',exact:true}).click();await expect(panel.locator('.ai-review-scope')).toContainText('回顾来源已变化');await expect(panel.getByRole('button',{name:'发送前预览',exact:true})).toBeDisabled();
 await panel.getByRole('button',{name:'关闭聊天',exact:true}).click();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'回顾'}).click();await expect(hub.locator('.history-review-content')).toContainText('来源已变化');await expect(hub.locator('.history-overview')).toContainText('云同步已进入试验阶段');await expect(hub.locator('.history-overview')).not.toContainText('500元');
});

for(const [width,height] of [[1088,720],[907,600]])test(`等效缩放可用尺寸 ${width}x${height}：菜单可达，长文与输入法组词不会误保存`,async({page})=>{
 await page.setViewportSize({width,height});await page.goto('/');await page.getByRole('button',{name:'写一条',exact:true}).click();const body=page.getByLabel('记录正文',{exact:true});await expect(body).toHaveAttribute('data-editor-ready','true');await body.focus();const cdp=await page.context().newCDPSession(page);
 await cdp.send('Input.imeSetComposition',{text:'中文输入',selectionStart:0,selectionEnd:4});await page.keyboard.press('Control+s');await expect(page.locator('.app-footer')).toContainText('0 条已保存记录');await cdp.send('Input.insertText',{text:'中文输入'});
 const long='中文输入\n'+Array.from({length:120},(_,index)=>`第${index}行：这是保留原话的长文本。`).join('\n');await body.fill(long);await page.getByRole('button',{name:'保存记录',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('已保存在本机');await body.press('Control+End');await page.keyboard.insertText('末尾');await expectNote(body,long+'末尾');const save=(await page.getByRole('button',{name:'保存记录',exact:true}).boundingBox())!;expect(save.y+save.height).toBeLessThanOrEqual(height);
});
