import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createPublicService} from '../../server/publications.mjs';
async function start(databasePath=':memory:'){
 const server=createPublicService({databasePath});server.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${server.address().port}`;
 const request=async(route,method='GET',body,token,revision)=>{const response=await fetch(base+route,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`} :{}),...(revision?{'If-Match':String(revision)}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 const register=async name=>(await request('/api/register','POST',{username:name,password:'local-test-password'})).data;
 const close=()=>new Promise(resolve=>server.close(resolve));return {server,base,request,register,close};
}
test('发布要求登录，账号密码校验和请求来源检查有效，私密字段不会被接收',async()=>{
 const s=await start();try{const content={title:'想法',body:'只有主动发布的正文'};assert.equal((await s.request('/api/posts','POST',content)).status,401);const a=await s.register('author_a');assert.ok(a.token);assert.equal((await s.request('/api/login','POST',{username:'author_a',password:'wrong-password'})).status,401);assert.equal((await s.request('/api/login','POST',{username:'author_a',password:'local-test-password'})).status,201);assert.equal((await s.request('/api/posts','POST',{...content,privateNotes:['不该上传'],highlights:[]},a.token)).status,400);assert.equal((await s.request('/api/posts')).data.length,0);assert.equal((await fetch(s.base+'/api/posts',{headers:{Origin:'https://unknown.example'}})).status,403);}finally{await s.close();}
});
test('发布副本剥离私人记忆标记，作者更新有版本校验，撤回后公开页面与API都不可见',async()=>{
 const s=await start();try{const a=await s.register('author_b'),b=await s.register('visitor_b');const document={type:'doc',content:[{type:'paragraph',attrs:{id:randomUUID()},content:[{type:'text',text:'留下这条想法',marks:[{type:'bold'},{type:'memory',attrs:{id:randomUUID(),createdAt:new Date().toISOString()}}]}]}]};const r=await s.request('/api/posts','POST',{title:'我的想法',body:'留下这条想法',document},a.token);assert.equal(r.status,201);assert.equal(JSON.stringify(r.data.document).includes('memory'),false);assert.equal(JSON.stringify(r.data.document).includes('createdAt'),false);assert.equal(r.data.revision,1);assert.equal((await s.request('/api/posts/'+r.data.id,'PUT',{title:'越权',body:'不能覆盖'},b.token,1)).status,403);assert.equal((await s.request('/api/posts/'+r.data.id,'DELETE',undefined,b.token)).status,403);const update=await s.request('/api/posts/'+r.data.id,'PUT',{title:'新版想法',body:'明确更新后的内容'},a.token,1);assert.equal(update.data.revision,2);assert.equal((await s.request('/api/posts/'+r.data.id,'PUT',{title:'旧版本',body:'旧写入'},a.token,1)).status,409);assert.equal((await s.request('/api/posts/'+r.data.id,'DELETE',undefined,a.token)).status,200);assert.equal((await s.request('/api/posts/'+r.data.id)).status,404);assert.equal((await fetch(s.base+'/p/'+r.data.id)).status,404);assert.equal((await s.request('/api/posts')).data.length,0);assert.equal((await s.request('/api/posts?mine=1','GET',undefined,a.token)).data[0].visible,false);}finally{await s.close();}
});
test('公开页面按文本渲染用户输入，拒绝危险链接和不一致正文',async()=>{
 const s=await start();try{const a=await s.register('author_c'),r=await s.request('/api/posts','POST',{title:'<script>标题</script>',body:'<img src=x onerror=alert(1)>'},a.token);assert.equal(r.status,201);const page=await fetch(s.base+'/p/'+r.data.id),html=await page.text();assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<img src=x'));assert.ok(page.headers.get('content-security-policy').includes("default-src 'none'"));const document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'链接',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]};assert.equal((await s.request('/api/posts','POST',{title:'危险',body:'链接',document},a.token)).status,400);delete document.content[0].content[0].marks;assert.equal((await s.request('/api/posts','POST',{title:'不一致',body:'其他内容',document},a.token)).status,400);}finally{await s.close();}
});
test('账号屏蔽仅影响自己的广场，举报可记录，退出使会话失效',async()=>{
 const s=await start();try{const a=await s.register('author_d'),b=await s.register('reader_d'),post=(await s.request('/api/posts','POST',{title:'公共想法',body:'留下一条想法'},a.token)).data;assert.equal((await s.request('/api/reports','POST',{postId:post.id,reason:'other'},b.token)).status,200);assert.equal((await s.request('/api/blocks','POST',{authorId:a.user.id},b.token)).status,200);assert.equal((await s.request('/api/posts','GET',undefined,b.token)).data.length,0);assert.equal((await s.request('/api/posts')).data.length,1);await s.request('/api/logout','POST',undefined,b.token);assert.equal((await s.request('/api/posts','POST',{title:'已退出',body:'不应发布'},b.token)).status,401);}finally{await s.close();}
});
test('服务重启后公开版本与作者账号保留',async()=>{
 const directory=await mkdtemp(path.join(tmpdir(),'dafeiyu-public-test-')),databasePath=path.join(directory,'public.db');let s=await start(databasePath);const user=await s.register('persistent_author'),post=(await s.request('/api/posts','POST',{title:'重启之前',body:'这份明确发布的内容需要保留'},user.token)).data;await s.close();s=await start(databasePath);try{assert.equal((await s.request('/api/posts/'+post.id)).data.body,'这份明确发布的内容需要保留');const login=await s.request('/api/login','POST',{username:'persistent_author',password:'local-test-password'});assert.equal(login.status,201);assert.equal((await s.request('/api/posts?mine=1','GET',undefined,login.data.token)).data[0].id,post.id);}finally{await s.close();}
});

test('内联标签公开时只保留真实字样和样式，五款字体从本机加载',async()=>{
 const s=await start();try{
  const account=await s.register('font_author'),privateId=randomUUID();
  const document={type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'#英语',marks:[{type:'tag',attrs:{id:privateId}},{type:'italic'},{type:'textStyle',attrs:{fontFamily:'DFY Wen Kai'}}]}]}]};
  const post=await s.request('/api/posts','POST',{title:'字样',body:'#英语',document},account.token);assert.equal(post.status,201);assert.ok(!JSON.stringify(post.data).includes(privateId));assert.ok(!JSON.stringify(post.data.document).includes('"tag"'));assert.equal(post.data.body,'#英语');
  const response=await fetch(s.base+'/p/'+post.data.id),html=await response.text();assert.ok(html.includes('DFY Wen Kai'));assert.ok(html.includes('/fonts.css'));assert.ok(response.headers.get('content-security-policy').includes("font-src 'self'"));
  for(const font of ['han-sans','han-serif','wenkai','fangsong','mono']){const file=await fetch(s.base+'/fonts/'+font+'.woff2');assert.equal(file.status,200);assert.equal(file.headers.get('content-type'),'font/woff2');assert.equal(Buffer.from(await file.arrayBuffer()).subarray(0,4).toString(),'wOF2');}
  assert.equal((await fetch(s.base+'/fonts/not-allowed.woff2')).status,404);
 }finally{await s.close();}
});
