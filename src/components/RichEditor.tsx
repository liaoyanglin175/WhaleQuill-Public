import {forwardRef,useImperativeHandle,useRef,useState} from 'react';
import {Mark,mergeAttributes} from '@tiptap/core';
import {EditorContent,useEditor} from '@tiptap/react';
import {TextSelection} from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import {TextStyle,Color,FontFamily,FontSize,BackgroundColor} from '@tiptap/extension-text-style';
import HighlightColor from '@tiptap/extension-highlight';
import UniqueID from '@tiptap/extension-unique-id';
import {plainDocument,fonts} from '../domain/rich-document';
import type {RichDocument,RichNode} from '../domain/rich-document';
import {projectEditor} from '../domain/rich-editor';
import {addHighlight} from '../domain/highlights';
import type {EditorSession} from '../domain/editor-session';
import {useI18n} from '../i18n';
import {requestThinking} from '../ai/client';
import {InlineTag} from './InlineTag';
import SelectionToolbar from './SelectionToolbar';
import {documentTags,mergeTagNames,withoutInlineTags} from '../domain/inline-tags';
import {tagName} from '../domain/tags';
import {TagEditorState,savedDocument,changeLinkedTag,toggleLinkedTag,addLinkedTag} from './TagEditorState';
import TagNameDialog from './TagNameDialog';

const Memory=Mark.create({name:'memory',inclusive:false,addAttributes(){return{id:{default:null,parseHTML:element=>element.getAttribute('data-memory-id'),renderHTML:attributes=>({'data-memory-id':attributes.id})},createdAt:{default:null,parseHTML:element=>element.getAttribute('data-memory-at'),renderHTML:attributes=>({'data-memory-at':attributes.createdAt})}};},parseHTML(){return[{tag:'span[data-memory]'}];},renderHTML({HTMLAttributes}){return ['span',mergeAttributes(HTMLAttributes,{'data-memory':'true',class:'memory-mark'}),0];}});
function cleanPastedHTML(html:string){
  const doc=new DOMParser().parseFromString(html,'text/html');
  for(const element of doc.body.querySelectorAll<HTMLElement>('*')){
    const original=element.style,style:Record<string,string>={};
    for(const key of ['color','backgroundColor'] as const){const value=original[key],rgb=value.match(/^rgb\(\s*(\d+),\s*(\d+),\s*(\d+)\s*\)$/);const hex=rgb?'#'+rgb.slice(1).map(n=>Number(n).toString(16).padStart(2,'0')).join(''):value;if(/^#[\da-f]{6}$/i.test(hex))style[key]=hex;}
    const font=fonts.find(font=>font.toLowerCase()===original.fontFamily.replaceAll('"','').replaceAll("'",'').toLowerCase());if(font)style.fontFamily=font;
    if(/^(14|16|18|20|24|28|32)px$/.test(original.fontSize))style.fontSize=original.fontSize;
    const href=element.getAttribute('href');for(const attr of [...element.attributes])element.removeAttribute(attr.name);
    for(const [key,value]of Object.entries(style))Object.assign(element.style,{[key]:value});
    if(element.tagName==='A'&&href&&/^(https?:\/\/|mailto:)/i.test(href))element.setAttribute('href',href);
  }
  return doc.body.innerHTML;
}
export type RichEditorHandle={remember:()=>void;removeMemory:(id:string)=>void;select:(start:number,end:number)=>void;changeTag:(tag:string,next:string|null)=>string|null};
function editableDocument(document:RichDocument):RichDocument{
  const copy=structuredClone(document);
  const visit=(node:RichNode)=>{if(['paragraph','heading','codeBlock'].includes(node.type)&&!node.attrs?.id)node.attrs={...node.attrs,id:crypto.randomUUID()};node.content?.forEach(visit);};
  visit(copy);return copy;
}
export default forwardRef<RichEditorHandle,{session:EditorSession;initialSelection?:{start:number;end:number};onSelection:(range:{start:number;end:number;text:string})=>void;onError:(text:string)=>void;onTask:()=>void;onPublish:()=>void;onTag:(tag:string)=>void;onReady:()=>void;disabled:boolean}>(function RichEditor({session,initialSelection,onSelection,onError,onTask,onPublish,onReady,disabled},ref){
  const {t}=useI18n(),initial=useRef(session.getSnapshot().record),selection=useRef(initialSelection),hydrating=useRef(true),menu=useRef<HTMLDivElement>(null);
  const [expanded,setExpanded]=useState(false);
  const [tagSuggestion,setTagSuggestion]=useState<string|null>(null),initialContent=useRef<string|null>(null);
  const [legacyTags]=useState(()=>mergeTagNames(initial.current.tags,documentTags(initial.current.document)));
  const [content]=useState(()=>{const document=editableDocument(withoutInlineTags(initial.current.document??plainDocument(initial.current.body)));document.attrs={...document.attrs,legacyTags};return document;});
  const normalizedOffset=(offset:number)=>session.getSnapshot().record.document?offset:session.getSnapshot().record.body.slice(0,offset).replace(/\r\n?/g,'\n').length;
  const editor=useEditor({
    editable:false,
    extensions:[StarterKit.configure({heading:{levels:[1,2,3]},link:{openOnClick:false}}),TextStyle,Color,FontFamily,FontSize,BackgroundColor,HighlightColor.configure({multicolor:true}),UniqueID.configure({types:['paragraph','heading','codeBlock']}),Memory,InlineTag,TagEditorState],
    content,
    editorProps:{transformPastedHTML:cleanPastedHTML,attributes:{id:'record-body',class:'rich-body',role:'textbox','aria-multiline':'true','aria-label':t('记录正文'),'data-placeholder':t('此刻所想，随手记下。'),spellcheck:'false'},handleDOMEvents:{compositionstart:()=>{session.setComposing(true);return false;},compositionend:()=>{session.setComposing(false);return false;}},handleKeyDown:(view,event)=>{
      if(event.isComposing)return false;
      if(event.key==='Escape'&&(expanded||!view.state.selection.empty)){
        if(expanded)setExpanded(false);else view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,view.state.selection.to)));
        event.preventDefault();event.stopPropagation();return true;
      }
      if((event.ctrlKey||event.metaKey)&&(event.key==='Home'||event.key==='End')){
        const edge=event.key==='Home'?TextSelection.atStart(view.state.doc).from:TextSelection.atEnd(view.state.doc).to;
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,event.shiftKey?view.state.selection.anchor:edge,edge)).scrollIntoView());event.preventDefault();return true;
      }
      if((event.ctrlKey||event.metaKey)&&event.shiftKey&&event.key.toLowerCase()==='m'){event.preventDefault();remember();return true;}return false;
    }},
    onCreate:({editor})=>{
      if(!initial.current.document){
        for(const item of initial.current.highlights.filter(item=>!item.stale)){
          const start=initial.current.body.slice(0,item.start).replace(/\r\n?/g,'\n').length,end=initial.current.body.slice(0,item.end).replace(/\r\n?/g,'\n').length,p=projectEditor(editor.state.doc);
          editor.chain().setTextSelection({from:p.toPosition(start),to:p.toPosition(end)}).setMark('memory',{id:item.id,createdAt:item.createdAt}).run();
        }
      }
      if(selection.current){const p=projectEditor(editor.state.doc);editor.commands.setTextSelection({from:p.toPosition(normalizedOffset(selection.current.start)),to:p.toPosition(normalizedOffset(selection.current.end))});}
      initialContent.current=JSON.stringify(editor.state.doc.content.toJSON());hydrating.current=false;
      editor.setEditable(true,false);
      const active=document.activeElement;
      if(selection.current||active===document.body||active instanceof HTMLButtonElement&&!editor.view.hasFocus())editor.view.focus();
      if(selection.current)editor.commands.scrollIntoView();editor.view.dom.setAttribute('data-editor-ready','true');onReady();
    },
    onUpdate:({editor,transaction})=>{if(hydrating.current)return;const document=savedDocument(editor),tags=editor.state.doc.attrs.legacyTags as string[];
      if(JSON.stringify(tags)===JSON.stringify(legacyTags)&&initialContent.current===JSON.stringify(editor.state.doc.content.toJSON())){session.update({body:initial.current.body,document:initial.current.document,tags:initial.current.tags,highlights:initial.current.highlights});return;}
      if(transaction.before.content.eq(editor.state.doc.content)){const previous=session.getSnapshot().record.document;session.update({tags,...(previous?{document:withoutInlineTags(previous)}:{})});return;}
      const p=projectEditor(editor.state.doc);session.update({body:p.body,document,tags,highlights:p.highlights(session.getSnapshot().record.highlights)});},
    onSelectionUpdate:({editor})=>{const p=projectEditor(editor.state.doc),start=p.toText(editor.state.selection.from),end=p.toText(editor.state.selection.to);onSelection({start,end,text:p.body.slice(start,end)});if(start===end)setExpanded(false);},
  },[session]);
  function remember(){if(!editor||disabled)return;try{onError('');const p=projectEditor(editor.state.doc),start=p.toText(editor.state.selection.from),end=p.toText(editor.state.selection.to),record=session.getSnapshot().record,all=addHighlight({...record,body:p.body,highlights:p.highlights(record.highlights)},start,end),item=all.find(h=>!h.stale&&h.start===start&&h.end===end)??all[all.length-1];editor.chain().focus().setTextSelection({from:p.toPosition(item.start),to:p.toPosition(item.end)}).setMark('memory',{id:item.id,createdAt:item.createdAt}).run();}catch(error){onError(error instanceof Error?error.message:String(error));}}
  useImperativeHandle(ref,()=>({remember,changeTag(tag,next){if(!editor||disabled)return '请稍后再修改标签。';return changeLinkedTag(editor,tag,next);},select(start,end){if(!editor)return;const p=projectEditor(editor.state.doc);editor.chain().focus().setTextSelection({from:p.toPosition(normalizedOffset(start)),to:p.toPosition(normalizedOffset(end))}).scrollIntoView().run();},removeMemory(id){if(!editor)return;session.update({highlights:session.getSnapshot().record.highlights.filter(item=>item.id!==id)});const tr=editor.state.tr;editor.state.doc.descendants((node,pos)=>{for(const mark of node.marks)if(mark.type.name==='memory'&&mark.attrs.id===id)tr.removeMark(pos,pos+node.nodeSize,mark);});editor.view.dispatch(tr);}}),[editor,disabled]);
  if(!editor)return null;
  return <div className="rich-editor" data-empty={editor.isEmpty}><EditorContent editor={editor}/><SelectionToolbar editor={editor} menu={menu} expanded={expanded} setExpanded={setExpanded} disabled={disabled} remember={remember} onError={onError} onTask={onTask} onPublish={onPublish} onLinkTag={()=>{const text=editor.state.doc.textBetween(editor.state.selection.from,editor.state.selection.to,'\n');if(/[\r\n]/.test(text)||tagName(text).length>40)setTagSuggestion(tagName(text).slice(0,40));else onError(toggleLinkedTag(editor)??'');}} onThink={()=>{const p=projectEditor(editor.state.doc);requestThinking(p.body.slice(p.toText(editor.state.selection.from),p.toText(editor.state.selection.to)));}}/>{tagSuggestion!==null&&<TagNameDialog suggestion={tagSuggestion} onConfirm={name=>addLinkedTag(editor,name)} onClose={()=>{setTagSuggestion(null);requestAnimationFrame(()=>editor.view.focus());}}/>}</div>;
});
