import {test,expect} from '@playwright/test';
import {createRecord} from '../../src/domain/models';
import {go} from './helpers';

test('回收站显示期限，缩短前预览数量，取消保留，确认只清除到期内容',async({page})=>{
 await page.goto('/');await expect(page.locator('.version')).toHaveText(/0\.2\./);
 const now=Date.now(),old={...createRecord(),title:'即将到期的旧内容',body:'应在确认后永久清除',deletedAt:new Date(now-10*86400000).toISOString()},recent={...createRecord(),title:'刚删除的内容',body:'应继续保留',deletedAt:new Date(now).toISOString()};
 await page.evaluate(({old,recent,now})=>new Promise<void>((resolve,reject)=>{const request=indexedDB.open('dafeiyu-notebook-v1');request.onsuccess=()=>{const db=request.result,tx=db.transaction(['records','trashPolicy','trashStarts'],'readwrite');tx.objectStore('records').put(old);tx.objectStore('records').put(recent);tx.objectStore('trashPolicy').put({id:'policy',days:30,enabledAt:new Date(now-60*86400000).toISOString()});tx.objectStore('trashStarts').put({id:'record:'+old.id,startedAt:old.deletedAt});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>reject(tx.error);};request.onerror=()=>reject(request.error);}),{old,recent,now});
 await page.reload();await go(page,'回收站');await expect(page.locator('.trash-row')).toHaveCount(2);await expect(page.locator('.section-intro')).toContainText('保留30天');await expect(page.locator('.trash-row').filter({hasText:old.title})).toContainText('清除');
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('tab',{name:'数据',exact:true}).click();const retention=page.getByLabel('回收站保留期限',{exact:true});await expect(retention).toHaveValue('30');
 await retention.selectOption('7');await expect(page.locator('.trash-retention-confirm')).toContainText('永久清除1条');await page.locator('.trash-retention-confirm').getByRole('button',{name:'取消',exact:true}).click();await expect(retention).toHaveValue('30');
 await retention.selectOption('7');await page.getByRole('button',{name:'确认清理并修改',exact:true}).click();await expect(retention).toHaveValue('7');await page.getByRole('dialog').getByRole('button',{name:'关闭',exact:true}).click();await expect(page.locator('.trash-row')).toHaveCount(1);await expect(page.locator('.trash-row')).toContainText(recent.title);
 await page.reload();await go(page,'回收站');await expect(page.locator('.trash-row')).toHaveCount(1);await page.getByRole('button',{name:'恢复记录：'+recent.title,exact:true}).click();await expect(page.locator('.trash-row')).toHaveCount(0);
});

test('英文保留设置可关闭，页面说明不再声称自动清理',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('dafeiyu-language','en'));await page.goto('/');await page.getByRole('button',{name:'Settings',exact:true}).click();await page.getByRole('tab',{name:'Data',exact:true}).click();
 await page.getByLabel('Trash retention',{exact:true}).selectOption('off');await expect(page.getByLabel('Trash retention',{exact:true})).toHaveValue('off');await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.locator('.sidebar-more summary').click();await page.getByRole('navigation').getByRole('button',{name:/Trash/}).click();await expect(page.locator('.section-intro')).toContainText('Automatic cleanup is off');
});
