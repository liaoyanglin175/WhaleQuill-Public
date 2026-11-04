import type {Node as PMNode} from '@tiptap/pm/model';
import type {RichNode,RichDocument} from './rich-document';
import {tagKey,tagName} from './tags';

export function inlineTagName(text:string):string|null {
  if(!text.startsWith('#')||/[\r\n]/.test(text))return null;
  const name=tagName(text.slice(1));
  return name&&Array.from(name).length<=40?name:null;
}
export function inlineTagSpans(doc:PMNode){
  const spans:{id:string;from:number;to:number;text:string}[]=[];
  doc.descendants((node,pos)=>{
    if(!node.isText)return;
    const mark=node.marks.find(mark=>mark.type.name==='tag');if(!mark)return;
    const previous=spans.at(-1);
    if(previous&&previous.id===mark.attrs.id&&previous.to===pos){previous.to=pos+node.nodeSize;previous.text+=node.text??'';}
    else spans.push({id:mark.attrs.id,from:pos,to:pos+node.nodeSize,text:node.text??''});
  });
  return spans;
}
export function documentTags(doc:RichDocument|null):string[]{
  if(!doc)return [];
  const names:string[]=[];let run:{id:string;text:string}|null=null;
  const flush=()=>{if(run){const name=inlineTagName(run.text);if(name)names.push(name);}run=null;};
  const visit=(node:RichNode)=>{
    if(node.type==='text'){
      const tag=node.marks?.find(mark=>mark.type==='tag');
      if(!tag){flush();return;}
      const id=String(tag.attrs?.id??'');if(run?.id===id)run.text+=node.text??'';else{flush();run={id,text:node.text??''};}return;
    }
    flush();for(const child of node.content??[])visit(child);flush();
  };
  visit(doc);
  return [...new Map(names.map(name=>[tagKey(name),name])).values()];
}
export function mergeTagNames(legacy:string[],inline:string[]):string[]{
  return [...new Map([...legacy,...inline].map(name=>[tagKey(name),name])).values()];
}

// Migrate associations without touching text, user formatting or block IDs.
export function withoutInlineTags(document:RichDocument):RichDocument {
  const visit=(node:RichNode):RichNode=>{
    const copy={...node};
    if(node.marks){const marks=node.marks.filter(mark=>mark.type!=='tag');if(marks.length)copy.marks=marks;else delete copy.marks;}
    if(node.content)copy.content=node.content.map(visit);
    return copy;
  };
  return visit(document) as RichDocument;
}
