import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {Editor} from '@tiptap/core';
import {Bold,Italic,Underline,Highlighter,Eraser,MoreHorizontal,ListPlus,Share2,GripVertical,Hash,RotateCcw} from 'lucide-react';
import {fillColors,fontChoices,textColors} from '../domain/rich-document';
import {selectionHasTag} from './TagEditorState';
import {useI18n} from '../i18n';
import {publicSharingEnabled} from '../features';

export default function SelectionToolbar({editor,menu,expanded,setExpanded,disabled,remember,onTask,onPublish,onThink,onLinkTag}:{
  editor:Editor;menu:RefObject<HTMLDivElement|null>;expanded:boolean;setExpanded:(value:boolean)=>void;disabled:boolean;
  remember:()=>void;onError:(message:string)=>void;onTask:()=>void;onPublish:()=>void;onThink:()=>void;onLinkTag:()=>void;
}){
  const {t}=useI18n();
  const [view,setView]=useState({visible:false,x:0,y:0}),[,render]=useState(0);
  const manual=useRef<{x:number;y:number}|null>(null),gesture=useRef<{id:number;x:number;y:number;left:number;top:number}|null>(null);
  const raf=useRef(0),disabledRef=useRef(disabled);disabledRef.current=disabled;
  function bounds(point:{x:number;y:number}){
    const width=menu.current?.offsetWidth??304,height=menu.current?.offsetHeight??42;
    return {x:Math.max(8,Math.min(point.x,innerWidth-width-8)),y:Math.max(8,Math.min(point.y,innerHeight-height-8))};
  }
  function refresh(){
    if(editor.isDestroyed)return;
    const visible=!disabledRef.current&&!editor.state.selection.empty&&!document.querySelector('dialog[open]')&&(editor.isFocused||!!menu.current?.contains(document.activeElement)||!!gesture.current);
    if(!visible){setView(previous=>previous.visible?{...previous,visible:false}:previous);return;}
    let point=manual.current;
    if(!point){
      const {from,to}=editor.state.selection,a=editor.view.coordsAtPos(from),b=editor.view.coordsAtPos(to);
      const width=menu.current?.offsetWidth??304,height=menu.current?.offsetHeight??42;
      const top=Math.min(a.top,b.top),bottom=Math.max(a.bottom,b.bottom);
      point={x:(a.left+b.right-width)/2,y:top-height-10};
      if(point.y<8)point.y=bottom+10;
    }
    const clamped=bounds(point);
    setView(previous=>previous.visible&&previous.x===clamped.x&&previous.y===clamped.y?previous:{visible:true,...{x:clamped.x,y:clamped.y}});
  }
  function queue(){cancelAnimationFrame(raf.current);raf.current=requestAnimationFrame(refresh);}
  useEffect(()=>{
    const changed=()=>{render(value=>value+1);queue();};
    editor.on('selectionUpdate',changed);editor.on('transaction',changed);editor.on('focus',queue);editor.on('blur',queue);
    document.addEventListener('focusin',queue);window.addEventListener('resize',queue);window.addEventListener('scroll',queue,true);queue();
    return()=>{cancelAnimationFrame(raf.current);editor.off('selectionUpdate',changed);editor.off('transaction',changed);editor.off('focus',queue);editor.off('blur',queue);document.removeEventListener('focusin',queue);window.removeEventListener('resize',queue);window.removeEventListener('scroll',queue,true);};
  },[editor]);
  useEffect(()=>{queue();const element=menu.current;if(!element)return;const observer=new ResizeObserver(queue);observer.observe(element);return()=>observer.disconnect();},[view.visible,expanded,disabled]);
  if(!view.visible)return null;
  const color=editor.getAttributes('textStyle').color??'#24262b',fill=editor.getAttributes('highlight').color??editor.getAttributes('textStyle').backgroundColor;
  return createPortal(<div ref={menu} className="rich-selection-menu movable-selection-menu" role="toolbar" aria-label={t('选中文字样式')} data-manual={!!manual.current} style={{position:'fixed',left:view.x,top:view.y}} onMouseDown={event=>{if(event.target instanceof Element&&event.target.closest('button'))event.preventDefault();}} onKeyDown={event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(expanded)setExpanded(false);else editor.commands.setTextSelection(editor.state.selection.to);}
  }}>
    <div className="selection-primary">
      <button type="button" className="selection-drag" aria-label={t('拖动样式面板')} title={t('拖动样式面板')} onPointerDown={event=>{event.preventDefault();gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,left:view.x,top:view.y};event.currentTarget.setPointerCapture(event.pointerId);}} onPointerMove={event=>{
        const drag=gesture.current;if(!drag||drag.id!==event.pointerId)return;event.preventDefault();const point=bounds({x:drag.left+event.clientX-drag.x,y:drag.top+event.clientY-drag.y});manual.current=point;setView({visible:true,...point});
      }} onPointerUp={event=>{gesture.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}} onPointerCancel={()=>{gesture.current=null;}} onKeyDown={event=>{
        const delta:Record<string,[number,number]>={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};
        if(event.key==='Home'){event.preventDefault();manual.current=null;queue();}
        if(delta[event.key]){event.preventDefault();const [x,y]=delta[event.key],point=bounds({x:view.x+x,y:view.y+y});manual.current=point;setView({visible:true,...point});}
      }}><GripVertical size={16}/></button>
      <button type="button" title={t('粗体')} aria-label={t('粗体')} aria-pressed={editor.isActive('bold')} onClick={()=>editor.chain().focus().toggleBold().run()}><Bold size={16}/></button>
      <button type="button" title={t('斜体')} aria-label={t('斜体')} aria-pressed={editor.isActive('italic')} onClick={()=>editor.chain().focus().toggleItalic().run()}><Italic size={16}/></button>
      <button type="button" title={t('关联标签')} aria-label={t('关联标签')} aria-pressed={selectionHasTag(editor)} onClick={onLinkTag}><Hash size={16}/></button>
      <span className="selection-separator"/>
      <button type="button" title={t('记住这句')} onClick={remember}><Highlighter size={15}/>{t('记住这句')}</button>
      <button type="button" className="selection-more" aria-label={t('更多文字操作')} title={t('更多文字操作')} aria-expanded={expanded} aria-controls="selection-extra" onClick={()=>setExpanded(!expanded)}><MoreHorizontal size={18}/></button>
    </div>
    {expanded&&<div id="selection-extra" className="selection-extra">
      <label>{t('字体')}<select aria-label={t('字体')} value={editor.getAttributes('textStyle').fontFamily??fontChoices[0].family} onChange={event=>editor.chain().focus().setFontFamily(event.target.value).run()}>{fontChoices.map(font=><option key={font.family} value={font.family}>{t(font.name)}</option>)}{editor.getAttributes('textStyle').fontFamily&&!fontChoices.some(font=>font.family===editor.getAttributes('textStyle').fontFamily)&&<option value={editor.getAttributes('textStyle').fontFamily}>{t('原有字体')}</option>}</select></label>
      <label>{t('字号')}<select aria-label={t('字号')} value={editor.getAttributes('textStyle').fontSize??'16px'} onChange={event=>editor.chain().focus().setFontSize(event.target.value).run()}>{[14,16,18,20,24,28,32].map(size=><option key={size} value={`${size}px`}>{size}</option>)}</select></label>
      <label>{t('段落样式')}<select aria-label={t('段落样式')} value={editor.isActive('heading')?String(editor.getAttributes('heading').level):'paragraph'} onChange={event=>{if(event.target.value==='paragraph')editor.chain().focus().setParagraph().run();else editor.chain().focus().toggleHeading({level:Number(event.target.value) as 1|2|3}).run();}}><option value="paragraph">{t('正文')}</option>{[1,2,3].map(level=><option key={level} value={level}>{t('标题 {0}',level)}</option>)}</select></label>
      <button type="button" aria-label={t('下划线')} aria-pressed={editor.isActive('underline')} onClick={()=>editor.chain().focus().toggleUnderline().run()}><Underline size={16}/>{t('下划线')}</button>
      <div className="preset-colors" role="group" aria-label={t('文字颜色')}><span>{t('字色')}</span><div>{textColors.map(item=><button type="button" key={item.value} className="color-swatch" style={{backgroundColor:item.value}} aria-label={t('字色：{0}',t(item.name))} title={t(item.name)} aria-pressed={color===item.value} onClick={()=>editor.chain().focus().setColor(item.value).run()}/>)}</div></div>
      <div className="preset-colors" role="group" aria-label={t('背景颜色')}><span>{t('底色')}</span><div><button type="button" className="color-swatch no-fill" aria-label={t('无底色')} title={t('无底色')} aria-pressed={!fill} onClick={()=>editor.chain().focus().unsetHighlight().unsetBackgroundColor().run()}>×</button>{fillColors.map(item=><button type="button" key={item.value} className="color-swatch" style={{backgroundColor:item.value}} aria-label={t('底色：{0}',t(item.name))} title={t(item.name)} aria-pressed={fill===item.value} onClick={()=>editor.chain().focus().unsetBackgroundColor().setHighlight({color:item.value}).run()}/>)}</div></div>
      <button type="button" aria-label={t('清除格式')} onClick={()=>{const chain=editor.chain().focus();for(const name of ['bold','italic','underline','strike','code','textStyle','highlight'])chain.unsetMark(name);chain.run();}}><Eraser size={16}/>{t('清除格式')}</button>
      <button type="button" onClick={()=>{manual.current=null;queue();}}><RotateCcw size={15}/>{t('回到选区旁')}</button>
      <div className="selection-record-actions"><button type="button" onClick={()=>{setExpanded(false);onThink();}}>{t('聊聊')}</button><button type="button" onClick={()=>{setExpanded(false);onTask();}}><ListPlus size={16}/>{t('转为任务')}</button>{publicSharingEnabled&&<button type="button" onClick={()=>{setExpanded(false);onPublish();}}><Share2 size={16}/>{t('发布到广场')}</button>}</div>
    </div>}
  </div>,document.body);
}
