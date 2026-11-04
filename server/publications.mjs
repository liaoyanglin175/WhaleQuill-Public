import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
import {mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {z} from 'zod';
import {richDocumentSchema,documentText,publicDocument} from '../src/domain/rich-document.ts';

const account=z.object({username:z.string().regex(/^[a-zA-Z0-9_-]{3,32}$/),password:z.string().min(8).max(128)}).strict();
const publication=z.object({title:z.string().trim().min(1).max(200),body:z.string().min(1).max(20000).refine(value=>!!value.trim()),document:richDocumentSchema.nullable().default(null),sourceId:z.string().uuid().nullable().default(null)}).strict().refine(value=>!value.document||documentText(value.document)===value.body,'排版与正文不一致');
const digest=text=>createHash('sha256').update(text).digest('hex');
const escape=text=>String(text??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function render(node){let content=node.type==='text'?escape(node.text):(node.content??[]).map(render).join('');
  for(const mark of node.marks??[]){const tag={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'}[mark.type];if(tag)content=`<${tag}>${content}</${tag}>`;
    if(mark.type==='textStyle'){const a=mark.attrs??{},styles=[['color',a.color],['font-family',a.fontFamily],['font-size',a.fontSize],['background-color',a.backgroundColor]].filter(([,v])=>v).map(([k,v])=>`${k}:${v}`).join(';');content=`<span style="${escape(styles)}">${content}</span>`;}
    if(mark.type==='highlight')content=`<mark style="background-color:${escape(mark.attrs?.color??'#fff0b5')}">${content}</mark>`;
    if(mark.type==='link')content=`<a href="${escape(mark.attrs.href)}" rel="noopener noreferrer" target="_blank">${content}</a>`;
  }
  const tag={doc:'div',paragraph:'p',heading:node.attrs?.level===1?'h2':'h3',bulletList:'ul',orderedList:'ol',listItem:'li',blockquote:'blockquote',codeBlock:'pre'}[node.type];return node.type==='hardBreak'?'<br>':node.type==='horizontalRule'?'<hr>':tag?`<${tag}>${content}</${tag}>`:content;
}
function page(title,body){return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · 大肥鱼</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/fonts.css"></head><body><header><a href="/">大肥鱼 · 灵感广场</a><small>本机验收服务</small></header><main>${body}</main></body></html>`;}

export function createPublicService({databasePath='server/data/publications.db',allowedOrigins=['http://127.0.0.1:1420','tauri://localhost','http://tauri.localhost','https://tauri.localhost'],now=()=>Date.now()}={}){
  if(databasePath!==':memory:')mkdirSync(path.dirname(databasePath),{recursive:true});
  const db=new DatabaseSync(databasePath);db.exec(`PRAGMA foreign_keys=ON;PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,document_json TEXT NOT NULL,source_id TEXT,revision INTEGER NOT NULL,visible INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS revisions(post_id TEXT NOT NULL,revision INTEGER NOT NULL,content_json TEXT NOT NULL,PRIMARY KEY(post_id,revision));
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,post_id TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS blocks(user_id TEXT NOT NULL,blocked_user_id TEXT NOT NULL,PRIMARY KEY(user_id,blocked_user_id));`);
  const rates=new Map();
  const postSelect='SELECT p.*,u.username AS author FROM posts p JOIN users u ON u.id=p.owner_id';
  function dto(row){return row?{id:row.id,author:row.author,authorId:row.owner_id,title:row.title,body:row.body,document:JSON.parse(row.document_json),sourceId:row.source_id,revision:row.revision,visible:!!row.visible,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  function viewer(req){const token=/^Bearer ([\w-]{40,100})$/.exec(req.headers.authorization??'')?.[1];if(!token)return null;return db.prepare('SELECT u.id,u.username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>?').get(digest(token),now())??null;}
  async function json(req){let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>2_000_000)throw Object.assign(Error('内容过大'),{status:413});}try{return JSON.parse(text||'{}');}catch{throw Object.assign(Error('请求格式不正确'),{status:400});}}
  function bad(message,status=400){throw Object.assign(Error(message),{status});}
  const server=createServer(async(req,res)=>{
    const origin=req.headers.origin,ownOrigin=`http://${req.headers.host}`;
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    if(origin){if(!allowedOrigins.includes(origin)&&origin!==ownOrigin){res.writeHead(403);res.end();return;}res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');}
    res.setHeader('Access-Control-Allow-Headers','Content-Type,Authorization,If-Match');res.setHeader('Access-Control-Allow-Methods','GET,POST,PUT,DELETE,OPTIONS');
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));};
    try{
      if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
      const url=new URL(req.url,'http://localhost'),route=url.pathname,actor=viewer(req);
      if(req.method==='GET'&&/^\/fonts\/(han-sans|han-serif|wenkai|fangsong|mono)\.woff2$/.test(route)){res.writeHead(200,{'Content-Type':'font/woff2','Cache-Control':'public, max-age=86400'});res.end(readFileSync(new URL('../public'+route,import.meta.url)));return;}
      if(req.method==='GET'&&route==='/fonts.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(readFileSync(new URL('../src/fonts.css',import.meta.url)));return;}
      if(route==='/api/health'){send({ok:true,mode:'local-validation',testMode:process.env.PUBLIC_TEST_MODE==='1',instanceId:process.env.PUBLIC_INSTANCE_ID??null});return;}
      if(['/api/register','/api/login'].includes(route)&&req.method==='POST'){
        const ip=req.socket.remoteAddress??'local',key=route+ip,bucket=rates.get(key)??{start:now(),count:0};if(now()-bucket.start>60000){bucket.start=now();bucket.count=0;}if(++bucket.count>12)bad('尝试过于频繁，请稍后再试。',429);rates.set(key,bucket);
        const input=account.parse(await json(req));let user=db.prepare('SELECT * FROM users WHERE username=?').get(input.username);
        if(route==='/api/register'){if(user)bad('用户名已被使用。',409);const salt=randomBytes(16).toString('hex');user={id:randomUUID(),username:input.username,salt,password_hash:scryptSync(input.password,salt,64).toString('hex')};db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(user.id,user.username,user.salt,user.password_hash);}
        else{const hash=scryptSync(input.password,user?.salt??'missing-user-salt',64),expected=Buffer.from(user?.password_hash??'00'.repeat(64),'hex');if(!user||!timingSafeEqual(hash,expected))bad('用户名或密码不正确。',401);}
        const token=randomBytes(32).toString('base64url');db.prepare('DELETE FROM sessions WHERE expires<=?').run(now());db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token),user.id,now()+86400000);send({token,user:{id:user.id,username:user.username}},201);return;
      }
      if(route==='/api/logout'&&req.method==='POST'){const token=(req.headers.authorization??'').slice(7);db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token));send({ok:true});return;}
      if(route==='/api/posts'&&req.method==='GET'){
        if(url.searchParams.has('mine')&&!actor)bad('请先登录。',401);
        const rows=url.searchParams.has('mine')?db.prepare(postSelect+' WHERE p.owner_id=? ORDER BY p.updated_at DESC LIMIT 50').all(actor.id):actor?db.prepare(postSelect+' WHERE p.visible=1 AND p.owner_id NOT IN(SELECT blocked_user_id FROM blocks WHERE user_id=?) ORDER BY p.updated_at DESC LIMIT 50').all(actor.id):db.prepare(postSelect+' WHERE p.visible=1 ORDER BY p.updated_at DESC LIMIT 50').all();send(rows.map(dto));return;
      }
      const match=/^\/api\/posts\/([\da-f-]{36})$/.exec(route),id=match?.[1];
      if(id&&req.method==='GET'){const row=db.prepare(postSelect+' WHERE p.id=? AND p.visible=1').get(id);if(!row)bad('公开内容不存在或已撤回。',404);send(dto(row));return;}
      if((route==='/api/posts'&&req.method==='POST')||(id&&req.method==='PUT')){
        if(!actor)bad('发布前请先登录。',401);const input=publication.parse(await json(req));
        if(input.sourceId&&!db.prepare('SELECT id FROM posts WHERE id=? AND visible=1').get(input.sourceId))bad('引用的公开内容已撤回。');
        const old=id?db.prepare('SELECT * FROM posts WHERE id=?').get(id):null;if(id&&(!old||old.owner_id!==actor.id))bad('只有作者可以更新。',403);if(old&&req.headers['if-match']!==String(old.revision))bad('公开版本已变化，请刷新后重试。',409);
        const postId=id??randomUUID(),date=new Date(now()).toISOString(),revision=(old?.revision??0)+1,doc=publicDocument(input.document),body=input.body;
        db.exec('BEGIN');try{db.prepare('INSERT INTO posts VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,document_json=excluded.document_json,source_id=excluded.source_id,revision=excluded.revision,visible=1,updated_at=excluded.updated_at').run(postId,actor.id,input.title,body,JSON.stringify(doc),input.sourceId,revision,1,old?.created_at??date,date);db.prepare('INSERT INTO revisions VALUES(?,?,?)').run(postId,revision,JSON.stringify({title:input.title,body,document:doc,sourceId:input.sourceId}));db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
        send(dto(db.prepare(postSelect+' WHERE p.id=?').get(postId)),old?200:201);return;
      }
      if(id&&req.method==='DELETE'){if(!actor)bad('请先登录。',401);const old=db.prepare('SELECT owner_id FROM posts WHERE id=?').get(id);if(!old||old.owner_id!==actor.id)bad('只有作者可以撤回。',403);db.prepare('UPDATE posts SET visible=0,updated_at=? WHERE id=?').run(new Date(now()).toISOString(),id);send({ok:true});return;}
      if(route==='/api/reports'&&req.method==='POST'){if(!actor)bad('请先登录。',401);const input=z.object({postId:z.string().uuid(),reason:z.enum(['spam','abuse','other'])}).strict().parse(await json(req));if(!db.prepare('SELECT id FROM posts WHERE id=? AND visible=1').get(input.postId))bad('内容已撤回。',404);db.prepare('INSERT INTO reports VALUES(?,?,?,?,?)').run(randomUUID(),actor.id,input.postId,input.reason,new Date(now()).toISOString());send({ok:true});return;}
      if(route==='/api/blocks'&&req.method==='POST'){if(!actor)bad('请先登录。',401);const input=z.object({authorId:z.string().uuid()}).strict().parse(await json(req));db.prepare('INSERT OR IGNORE INTO blocks VALUES(?,?)').run(actor.id,input.authorId);send({ok:true});return;}
      if(route==='/style.css'){res.writeHead(200,{'Content-Type':'text/css'});res.end(readFileSync(new URL('./public.css',import.meta.url)));return;}
      if(req.method==='GET'&&(route==='/'||/^\/p\/[\da-f-]{36}$/.test(route))){
        res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; frame-ancestors 'none'");
        let html;
        if(route==='/'){const rows=db.prepare(postSelect+' WHERE p.visible=1 ORDER BY p.updated_at DESC LIMIT 50').all();html=page('灵感广场','<h1>想法，在这里继续生长。</h1>'+(!rows.length?'<p>还没有公开的想法。</p>':rows.map(row=>`<article><small>${escape(row.author)} · ${escape(row.updated_at.slice(0,10))}</small><h2><a href="/p/${row.id}">${escape(row.title)}</a></h2><p class="excerpt">${escape(row.body.slice(0,300))}</p></article>`).join('')));}
        else{const row=db.prepare(postSelect+' WHERE p.id=? AND p.visible=1').get(route.slice(3));if(!row){res.writeHead(404,{'Content-Type':'text/html; charset=utf-8'});res.end(page('内容已撤回','<h1>内容不存在或已撤回。</h1>'));return;}html=page(row.title,`<article><small>${escape(row.author)} · ${escape(row.updated_at.slice(0,10))} · 版本 ${row.revision}</small><h1>${escape(row.title)}</h1>${row.document_json!=='null'?render(JSON.parse(row.document_json)):`<p class="plain">${escape(row.body)}</p>`}${row.source_id?`<p><a href="/p/${row.source_id}">查看引用来源</a></p>`:''}</article>`);}
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(html);return;
      }
      send({error:'没有这个入口。'},404);
    }catch(error){send({error:error instanceof z.ZodError?'提交内容格式不正确。':error.status?error.message:'服务暂时不可用，请重试。'},error instanceof z.ZodError?400:error.status??500);}
  });
  server.on('close',()=>db.close());return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const port=Number(process.env.PORT??4318),host=process.env.HOST??'127.0.0.1';createPublicService({databasePath:process.env.PUBLIC_DATABASE??'server/data/publications.db',allowedOrigins:(process.env.ALLOWED_ORIGINS??'http://127.0.0.1:1420,tauri://localhost,http://tauri.localhost,https://tauri.localhost').split(',')}).listen(port,host,()=>console.log(`大肥鱼公开分享服务：http://${host}:${port}（仅接收明确发布的副本）`));}
