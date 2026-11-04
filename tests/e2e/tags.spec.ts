import {findNotes} from './helpers';
import {test,expect} from '@playwright/test';
import {editorAction,addInlineTag} from './helpers';

async function write(page:import('@playwright/test').Page,body:string,tags:string){
  await page.getByRole('button',{name:'写一条',exact:true}).click();
  const names=tags.split(/[,，]/).filter(Boolean);
  await page.getByLabel('记录正文',{exact:true}).fill(body+(names.length?'\n'+names.join(' '):''));
  for(const name of names)await addInlineTag(page,name);
  await page.getByRole('button',{name:'保存记录',exact:true}).click();
  await expect(page.locator('.save-state')).toHaveText('已保存在本机');
}

test('点击标签精确聚合同标签记录，关键词可继续缩小结果，刷新后标签仍在',async({page})=>{
  await page.goto('/');
  await write(page,'旅行日记：和小林一起看海。','旅行，小林');
  await write(page,'旅行清单：带上相机。','旅行');
  await write(page,'这篇只在正文提到旅行，不带标签。','');
  await page.getByRole('button',{name:'返回记录列表',exact:true}).click();
  await page.getByRole('button',{name:'查看标签：旅行',exact:true}).first().click();
  await expect(page.locator('.active-tag')).toContainText('旅行');
  await expect(page.locator('.record-card')).toHaveCount(2);
  const turn=await findNotes(page,'相机');await expect(turn.locator('.inquiry-match')).toHaveCount(1);await expect(turn).toContainText('#旅行');await page.getByRole('button',{name:'关闭聊天',exact:true}).click();
  await page.getByRole('button',{name:'退出标签筛选',exact:true}).click();await expect(page.locator('.active-tag')).toHaveCount(0);
  await page.reload();await page.locator('.timeline-filter > summary').click();
  await page.getByLabel('按标签查看记录',{exact:true}).selectOption({label:'小林 (1)'});
  await expect(page.locator('.record-card')).toHaveCount(1);await expect(page.locator('.record-card')).toContainText('看海');
});

test('标签编辑不会自动保存，离开可继续写或放弃；被删除记录不出现在标签结果',async({page})=>{
  await page.goto('/');await write(page,'周末走了很远。','旅行');
  const body=page.getByLabel('记录正文',{exact:true});await body.press('Control+End');await page.keyboard.insertText(' 散步');await addInlineTag(page,'散步');
  await expect(page.locator('.save-state')).toContainText('尚未保存');
  await page.getByRole('button',{name:'查看标签：散步',exact:true}).click();
  await expect(page.locator('.save-bubble')).toBeVisible();await page.getByRole('button',{name:'继续写',exact:true}).click();
  await expect(body).toContainText('散步');await expect(body).not.toContainText('#');
  await page.getByRole('button',{name:'返回记录列表',exact:true}).click();await page.getByRole('button',{name:'丢弃',exact:true}).click();
  await expect(page.getByRole('button',{name:'查看标签：散步',exact:true})).toHaveCount(0);
  await page.locator('.record-card').first().click();await editorAction(page,'删除当前记录');
  await page.getByRole('button',{name:'确认删除',exact:true}).click();
  await expect(page.locator('.record-card')).toHaveCount(0);await page.locator('.timeline-filter > summary').click();
  await expect(page.getByLabel('按标签查看记录').locator('option')).toHaveCount(1);
});

test('英文窄窗口能选择标签且不溢出',async({page})=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await write(page,'Small notes about design.','Design');
  await page.evaluate(()=>localStorage.setItem('dafeiyu-language','en'));await page.reload();
  await page.locator('.timeline-filter > summary').click();await expect(page.getByLabel('Filter notes by tag')).toBeVisible();
  await page.getByLabel('Filter notes by tag').selectOption({label:'Design (1)'});
  await expect(page.locator('.record-card')).toHaveCount(1);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
