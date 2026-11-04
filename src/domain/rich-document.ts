import {z} from 'zod';

export type RichMark={type:string;attrs?:Record<string,unknown>};
export type RichNode={type:string;text?:string;attrs?:Record<string,unknown>;marks?:RichMark[];content?:RichNode[]};
export type RichDocument=RichNode&{type:'doc';content:RichNode[]};
export const fontChoices=[{name:'思源黑体',family:'DFY Han Sans'},{name:'思源宋体',family:'DFY Han Serif'},{name:'霞鹜文楷',family:'DFY Wen Kai'},{name:'朱雀仿宋',family:'DFY Fang Song'},{name:'更纱等宽 SC',family:'DFY Mono'}] as const;
export const fonts=['Segoe UI, Microsoft YaHei UI, sans-serif','Georgia, SimSun, serif','Consolas, monospace','DFY Han Sans','DFY Han Serif','DFY Wen Kai','DFY Fang Song','DFY Mono'] as const;
export const textColors=[{name:'默认',value:'#24262b'},{name:'灰',value:'#62656e'},{name:'红',value:'#b33e3e'},{name:'橙',value:'#9a550c'},{name:'绿',value:'#28684b'},{name:'蓝',value:'#315eab'},{name:'紫',value:'#7450a3'},{name:'棕',value:'#80513c'}] as const;
export const fillColors=[{name:'浅黄',value:'#fff0b5'},{name:'浅红',value:'#fbe0e0'},{name:'浅橙',value:'#ffe6ce'},{name:'浅绿',value:'#dceee1'},{name:'浅蓝',value:'#deebfb'},{name:'浅紫',value:'#ece1f6'}] as const;
const color=z.string().regex(/^#[\da-fA-F]{6}$/).nullable().optional();
const safeHref=z.string().max(2000).refine(value=>/^(https?:\/\/|mailto:)/i.test(value));
const mark=z.union([
  z.object({type:z.enum(['bold','italic','underline','strike','code'])}).strict(),
  z.object({type:z.literal('textStyle'),attrs:z.object({color,fontFamily:z.enum(fonts).nullable().optional(),fontSize:z.enum(['14px','16px','18px','20px','24px','28px','32px']).nullable().optional(),backgroundColor:color}).strict()}),
  z.object({type:z.literal('highlight'),attrs:z.object({color}).strict().optional()}),
  z.object({type:z.literal('memory'),attrs:z.object({id:z.string().uuid(),createdAt:z.string().datetime({offset:true})}).strict()}),
  z.object({type:z.literal('tag'),attrs:z.object({id:z.string().uuid()}).strict()}),
  z.object({type:z.literal('link'),attrs:z.object({href:safeHref,target:z.literal('_blank').nullable().optional(),rel:z.string().max(100).nullable().optional(),class:z.null().optional()}).strict()}),
]);
const node:z.ZodType<RichNode>=z.lazy(()=>z.object({
  type:z.enum(['doc','paragraph','heading','text','hardBreak','bulletList','orderedList','listItem','blockquote','codeBlock','horizontalRule']),
  text:z.string().max(1_000_000).optional(),marks:z.array(mark).max(12).optional(),
  attrs:z.object({id:z.string().max(100).nullable().optional(),level:z.number().int().min(1).max(3).optional(),start:z.number().int().min(1).max(100000).optional(),type:z.null().optional(),language:z.string().max(40).nullable().optional()}).strict().optional(),
  content:z.array(node).max(20000).optional(),
}).strict());
export const richDocumentSchema=z.custom<RichDocument>(value=>{
  // Bound depth and size before recursive validation.
  let count=0;const bounded=(n:unknown,depth=0):boolean=>{if(!n||typeof n!=='object'||depth>24||++count>30000)return false;const c=(n as RichNode).content;return !c||Array.isArray(c)&&c.every(child=>bounded(child,depth+1));};
  if(!bounded(value)||JSON.stringify(value).length>4_000_000)return false;
  const parsed=node.safeParse(value);if(!parsed.success||parsed.data.type!=='doc'||!Array.isArray(parsed.data.content))return false;
  const blocks=['paragraph','heading','blockquote','codeBlock','horizontalRule','bulletList','orderedList'];
  const valid=(n:RichNode):boolean=>{
    const children=n.content??[];
    if(n.type==='text')return typeof n.text==='string'&&!!n.text.length&&!children.length;
    if(n.text!==undefined)return false;
    if(n.type==='hardBreak'||n.type==='horizontalRule')return !children.length;
    if(['paragraph','heading'].includes(n.type)&&!children.every(c=>c.type==='text'||c.type==='hardBreak'))return false;
    if(n.type==='codeBlock'&&!children.every(c=>c.type==='text'))return false;
    if(['doc','blockquote'].includes(n.type)&&(!children.length||!children.every(c=>blocks.includes(c.type))))return false;
    if(['bulletList','orderedList'].includes(n.type)&&(!children.length||!children.every(c=>c.type==='listItem')))return false;
    if(n.type==='listItem'&&(children[0]?.type!=='paragraph'||!children.every(c=>blocks.includes(c.type))))return false;
    return children.every(valid);
  };
  return valid(parsed.data);
},'排版文档格式不正确');

export function documentText(doc:RichNode):string {
  const blocks:string[]=[];
  const inline=(n:RichNode):string=>n.type==='text'?n.text??'':n.type==='hardBreak'?'\n':(n.content??[]).map(inline).join('');
  const visit=(n:RichNode)=>{if(['paragraph','heading','codeBlock'].includes(n.type))blocks.push(inline(n));else if(n.type==='horizontalRule')blocks.push('---');else(n.content??[]).forEach(visit);};
  visit(doc);return blocks.join('\n');
}
export function plainDocument(text:string):RichDocument {return {type:'doc',content:text.replace(/\r\n?/g,'\n').split('\n').map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))};}
export function publicDocument(doc:RichDocument|null):RichDocument|null {
  if(!doc)return null;
  const clean=(n:RichNode):RichNode=>({...n,attrs:n.attrs?Object.fromEntries(Object.entries(n.attrs).filter(([key])=>key!=='id')):undefined,marks:n.marks?.filter(m=>m.type!=='memory').flatMap(m=>m.type==='tag'?[{type:'bold'},{type:'textStyle',attrs:{color:'#62656e'}}]:[m]),content:n.content?.map(clean)});
  return clean(doc) as RichDocument;
}

export function hasNewFormatting(document:RichDocument|null):boolean {
  if(!document)return false;
  const visit=(node:RichNode):boolean=>!!node.marks?.some(mark=>mark.type==='tag'||mark.type==='textStyle'&&String(mark.attrs?.fontFamily??'').startsWith('DFY '))||!!node.content?.some(visit);
  return visit(document);
}
