import {expect} from '@playwright/test';
import type { Page,Locator } from '@playwright/test';
export async function downloadedArchive(page:Page,path:string){const {readFile}=await import('node:fs/promises');const bytes=await readFile(path);return page.evaluate(async bytes=>{const moduleUrl='/src/domain/stream-backup.ts';const {readBackupBlob}=await import(moduleUrl);return readBackupBlob(new Blob([new Uint8Array(bytes)]));},[...bytes]);}
export async function more(page: Page) { const details = page.locator('.sidebar-more'); if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await details.locator('summary').click(); }
export async function go(page: Page, name: string) { if(name==='重点'){await go(page,'回顾');await page.getByRole('tab',{name:'重点',exact:true}).click();return;} if(name==='找回记录'){await page.keyboard.press('Control+k');return;} if (name === '回收站') await more(page); await page.getByRole('navigation').getByRole('button', { name: ({ '全部记录': '随记', '找回记录': '回顾', '任务清单':'日程' } as Record<string, string>)[name] ?? name }).click(); }
export const nav = (page: Page, name: string) => ({ click: () => go(page, name) });
export async function editorAction(page: Page, name: string) { name=name==='导出当前记录为 Markdown'?'导出 Markdown':name;const details = page.locator('.editor-tools'); if (!(await details.evaluate((element: HTMLDetailsElement) => element.open))) await details.locator('summary').click(); await page.getByRole('button', { name, exact: true }).click(); }
export async function expectNote(locator:Locator,expected:string|RegExp){
  await expect(async()=>{
    const actual=await locator.evaluate(element=>{
      if(element instanceof HTMLTextAreaElement)return element.value;
      const text=(node:Node):string=>node.nodeType===Node.TEXT_NODE?node.textContent??'':node instanceof HTMLBRElement?node.classList.contains('ProseMirror-trailingBreak')?'':'\n':[...node.childNodes].map(text).join('');
      return [...element.querySelectorAll('p,h1,h2,h3,pre')].map(text).join('\n');
    });
    if(typeof expected==='string')expect(actual).toBe(expected.replace(/\r\n?/g,'\n'));else expect(actual).toMatch(expected);
  }).toPass({timeout:5000});
}
export async function selectionAction(page:Page,name:string){
  const menu=page.getByRole('toolbar',{name:'选中文字样式'});await expect(menu).toBeVisible();
  if(!await menu.getByRole('button',{name,exact:true}).isVisible())await menu.getByRole('button',{name:'更多文字操作',exact:true}).click();
  await menu.getByRole('button',{name,exact:true}).click();
}
export async function selectionState(locator:Locator){return locator.evaluate(element=>{const selection=getSelection();return {text:selection?.toString(),anchor:selection?.anchorOffset,focus:selection?.focusOffset,scroll:element.closest('.editor-content')?.scrollTop??element.scrollTop};});}
export async function selectText(page:Page,text:string){
  const body=page.getByLabel('记录正文',{exact:true});await body.focus();
  await body.evaluate((element,text)=>{
    const walker=document.createTreeWalker(element,NodeFilter.SHOW_TEXT);let node:Node|null;
    while(node=walker.nextNode()){const index=(node.textContent??'').indexOf(text);if(index<0)continue;
      const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+text.length);const selection=getSelection();selection?.removeAllRanges();selection?.addRange(range);document.dispatchEvent(new Event('selectionchange'));return;
    }throw Error('Text to select was not found');
  },text);
  await expect(page.getByRole('toolbar',{name:'选中文字样式'})).toBeVisible();
  expect(await page.evaluate(()=>getSelection()?.toString())).toBe(text);
}
export async function addInlineTag(page:Page,text:string){await selectText(page,text);await selectionAction(page,'关联标签');}

export async function findNotes(page:Page,text:string){await page.keyboard.press('Control+k');const panel=page.getByRole('region',{name:'笺间对话',exact:true});await panel.getByRole('tab',{name:'找记录',exact:true}).click();await panel.getByLabel('询问已保存的笔记',{exact:true}).fill(text);await panel.getByRole('button',{name:'提交询问',exact:true}).click();return panel.locator('.inquiry-turn').last();}
export async function openFound(page:Page,text:string){const turn=await findNotes(page,text);await turn.getByRole('button',{name:'查看原文',exact:true}).first().click();await page.getByRole('region',{name:'原文预览'}).getByRole('button',{name:'打开记录',exact:true}).click();}

