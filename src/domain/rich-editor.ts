import type {Node as PMNode} from '@tiptap/pm/model';
import type {Highlight} from './models';

export function projectEditor(doc:PMNode){
  let body='',first=true;const segments:{start:number;end:number;pos:number;size:number}[]=[],memories=new Map<string,{start:number;end:number;createdAt:string}>();
  doc.descendants((node,pos)=>{
    if(node.isTextblock){if(!first)body+='\n';first=false;segments.push({start:body.length,end:body.length,pos:pos+1,size:0});}
    if(node.type.name==='horizontalRule'){if(!first)body+='\n';first=false;segments.push({start:body.length,end:body.length+3,pos,size:1});body+='---';}
    if(node.isText||node.type.name==='hardBreak'){
      const text=node.isText?node.text!:'\n',start=body.length;body+=text;segments.push({start,end:body.length,pos,size:node.nodeSize});
      for(const mark of node.marks)if(mark.type.name==='memory'){
        const old=memories.get(mark.attrs.id);memories.set(mark.attrs.id,{start:old?.start??start,end:body.length,createdAt:mark.attrs.createdAt});
      }
    }
  });
  const toText=(pos:number)=>{let value=0;for(const part of segments){if(pos<part.pos)break;value=part.start+Math.min(part.end-part.start,Math.max(0,pos-part.pos));}return value;};
  const toPosition=(offset:number)=>{for(const part of segments)if(offset>=part.start&&offset<=part.end&&part.size)return part.pos+Math.min(part.size,offset-part.start);const last=[...segments].reverse().find(part=>part.start<=offset);return last?last.pos+last.size:1;};
  const highlights=(previous:Highlight[])=>{
    const active=[...memories].map(([id,span])=>{const text=body.slice(span.start,span.end),original=previous.find(item=>item.id===id);return original&&original.text.replace(/\r\n?/g,'\n')!==text?{...original,stale:true}:{id,...span,text,stale:false};}).filter(item=>item.text.trim());
    return [...active,...previous.filter(item=>!memories.has(item.id)).map(item=>({...item,stale:true}))];
  };
  return {body,toText,toPosition,highlights};
}
