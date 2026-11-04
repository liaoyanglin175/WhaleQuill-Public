import type {CSSProperties,ReactNode} from 'react';
import type {RichDocument,RichNode} from '../domain/rich-document';
export default function RichContent({document,body}:{document:RichDocument|null;body:string}){
  function render(node:RichNode,key:string):ReactNode{
    let children:ReactNode=node.type==='text'?node.text:(node.content??[]).map((child,index)=>render(child,`${key}-${index}`));
    for(const [index,mark]of(node.marks??[]).entries()){
      const k=`${key}-m${index}`;
      if(mark.type==='bold')children=<strong key={k}>{children}</strong>;
      if(mark.type==='italic')children=<em key={k}>{children}</em>;
      if(mark.type==='underline')children=<u key={k}>{children}</u>;
      if(mark.type==='strike')children=<s key={k}>{children}</s>;
      if(mark.type==='code')children=<code key={k}>{children}</code>;
      if(mark.type==='textStyle')children=<span key={k} style={{color:mark.attrs?.color,fontFamily:mark.attrs?.fontFamily,fontSize:mark.attrs?.fontSize,backgroundColor:mark.attrs?.backgroundColor} as CSSProperties}>{children}</span>;
      if(mark.type==='highlight')children=<mark key={k} style={{backgroundColor:String(mark.attrs?.color??'#fff0b5')}}>{children}</mark>;
      if(mark.type==='link')children=<a key={k} href={String(mark.attrs?.href)} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
    switch(node.type){case'doc':return <div key={key}>{children}</div>;case'paragraph':return <p key={key}>{children||<br/>}</p>;case'heading':return node.attrs?.level===1?<h2 key={key}>{children}</h2>:<h3 key={key}>{children}</h3>;case'bulletList':return <ul key={key}>{children}</ul>;case'orderedList':return <ol key={key} start={Number(node.attrs?.start??1)}>{children}</ol>;case'listItem':return <li key={key}>{children}</li>;case'blockquote':return <blockquote key={key}>{children}</blockquote>;case'codeBlock':return <pre key={key}><code>{children}</code></pre>;case'horizontalRule':return <hr key={key}/>;case'hardBreak':return <br key={key}/>;default:return <span key={key}>{children}</span>;}
  }
  return <div className="rich-content">{document?render(document,'doc'):<p className="plain-content">{body}</p>}</div>;
}
