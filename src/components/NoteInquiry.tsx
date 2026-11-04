import {useEffect,useMemo,useRef,useState} from 'react';
import {ArrowLeft,ArrowUpRight,MessageCircle,PanelRight,Send,X,GripVertical,RotateCcw} from 'lucide-react';
import {useI18n} from '../i18n';
import {recordTitle} from '../domain/models';
import type {NoteRecord} from '../domain/models';
import {recallRecords} from '../domain/recall';
import type {RecallQuote} from '../domain/recall';
import MatchedText from './MatchedText';
import MemoryAssistant from './MemoryAssistant';
import type {CreationActions} from '../domain/creation';
import type {MemorySeed} from './MemoryAssistant';
import {useFloatingTool} from './useFloatingTool';
import type {MemorySource} from '../domain/memory-context';
import RecallClues from './RecallClues';
import {hasTag} from '../domain/tags';
import {ActiveTag} from './RecordTags';

type Question={id:string;text:string;recordId:string|null;now:number;tag:string|null;relaxed?:boolean};
type Preview={recordId:string;quote:RecallQuote;origin?:'review'};

export default function NoteInquiry({creationActions,records,currentId,open,docked,blocked,onOpenChange,onDockedChange,onOpenRecord,findTag=null,onClearTag}:{
  creationActions:CreationActions;records:NoteRecord[];currentId:string|null;open:boolean;docked:boolean;blocked:boolean;
  onOpenChange:(open:boolean)=>void;onDockedChange:(docked:boolean)=>void;
  onOpenRecord:(record:NoteRecord,selection?:{start:number;end:number})=>Promise<boolean>;
  findTag?:string|null;onClearTag?:()=>void;
}) {
  const {t,locale}=useI18n();
  const [wide,setWide]=useState(()=>matchMedia('(min-width:1100px)').matches);
  useEffect(()=>{const media=matchMedia('(min-width:1100px)'),change=()=>setWide(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);
  const sidebar=docked&&wide;
  const [question,setQuestion]=useState(''),[scope,setScope]=useState<'all'|'current'>('all');
  const [questions,setQuestions]=useState<Question[]>([]),[preview,setPreview]=useState<Preview|null>(null);
  const [expanded,setExpanded]=useState<Record<string,number>>({}),[modalOpen,setModalOpen]=useState(false),[opening,setOpening]=useState(false);
  const [mode,setMode]=useState<'find'|'think'>('find'),[aiHost,setAiHost]=useState<HTMLDivElement|null>(null),[seed,setSeed]=useState<MemorySeed|null>(null);
  const seedSequence=useRef(0);
  const input=useRef<HTMLInputElement>(null),panel=useRef<HTMLElement>(null),log=useRef<HTMLDivElement>(null);
  const launcher=useRef<HTMLButtonElement>(null),returnFocus=useRef<HTMLElement|null>(null);
  const returnRange=useRef<Range|null>(null),returnScroll=useRef<{element:HTMLElement;top:number;left:number}|null>(null);
  const returnDirection=useRef<{anchor:Node;anchorOffset:number;focus:Node;focusOffset:number}|null>(null);
  const current=records.find(record=>record.id===currentId),effectiveScope=scope==='current'&&current?'current':'all';
  const suspended=blocked||modalOpen,visible=open&&!suspended;
  const launcherTool=useFloatingTool({element:launcher,key:'dafeiyu-inquiry-launcher-position',active:!suspended,avoid:'[data-floating-avoid]'});
  const panelTool=useFloatingTool({element:panel,key:'dafeiyu-inquiry-panel-position',active:visible&&!sidebar,anchor:launcherTool.manual?{...launcherTool.point!,...launcherTool.size}:null,avoid:'[data-floating-avoid]'});
  const answers=useMemo(()=>questions.map(item=>({...item,results:recallRecords(records.filter(record=>(!item.recordId||record.id===item.recordId)&&(!item.tag||hasTag(record,item.tag))),item.text,{now:item.now,limit:Infinity,relaxed:item.relaxed})})),[records,questions]);
  const source=preview?records.find(record=>record.id===preview.recordId):undefined;
  const exact=!!source&&!!preview&&source.body.slice(preview.quote.start,preview.quote.end)===preview.quote.text;
  useEffect(()=>{const think=(event:Event)=>{const text=(event as CustomEvent<{text?:string}>).detail?.text??'';rememberFocus();setSeed({id:++seedSequence.current,text:Array.from(text).slice(0,2000).join('')});setMode('think');setPreview(null);onOpenChange(true);};window.addEventListener('dafeiyu-think',think);return()=>window.removeEventListener('dafeiyu-think',think);},[]);

  useEffect(()=>{
    const find=()=>{rememberFocus();setMode('find');setPreview(null);onOpenChange(true);requestAnimationFrame(()=>input.current?.focus({preventScroll:true}));};
    const previewSource=(event:Event)=>{rememberFocus();setMode('find');setPreview({...((event as CustomEvent<Preview>).detail),origin:'review'});onOpenChange(true);};
    const discuss=(event:Event)=>{const detail=(event as CustomEvent<{text:string;sources:MemorySource[];label:string}>).detail;rememberFocus();setSeed({id:++seedSequence.current,text:detail.text,review:{sources:detail.sources,label:detail.label}});setMode('think');setPreview(null);onOpenChange(true);};
    window.addEventListener('dafeiyu-find',find);window.addEventListener('dafeiyu-preview-source',previewSource);window.addEventListener('dafeiyu-review-discuss',discuss);
    return()=>{window.removeEventListener('dafeiyu-find',find);window.removeEventListener('dafeiyu-preview-source',previewSource);window.removeEventListener('dafeiyu-review-discuss',discuss);};
  },[]);
  useEffect(()=>{
    const check=()=>setModalOpen(!!document.querySelector('dialog[open],.editor-tools[open]'));
    check();const observer=new MutationObserver(check);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open']});
    return()=>observer.disconnect();
  },[]);
  useEffect(()=>{
    if(!visible)return;
    const frame=requestAnimationFrame(()=>{(input.current??panel.current?.querySelector<HTMLButtonElement>('button'))?.focus({preventScroll:true});});
    return()=>cancelAnimationFrame(frame);
  },[visible]);
  useEffect(()=>{if(visible&&!preview)log.current?.scrollTo({top:log.current.scrollHeight});},[questions.length,visible,preview]);
  useEffect(()=>{if(preview&&!source)setPreview(null);},[preview,source]);

  function rememberFocus(){
    const element=document.activeElement;if(!(element instanceof HTMLElement)||panel.current?.contains(element)||element===launcher.current)return;
    returnFocus.current=element;const selection=document.getSelection();returnRange.current=element.isContentEditable&&selection?.rangeCount?selection.getRangeAt(0).cloneRange():null;
    returnDirection.current=returnRange.current&&selection?.anchorNode&&selection.focusNode?{anchor:selection.anchorNode,anchorOffset:selection.anchorOffset,focus:selection.focusNode,focusOffset:selection.focusOffset}:null;
    const scroller=element.closest<HTMLElement>('.editor-content')??element;returnScroll.current={element:scroller,top:scroller.scrollTop,left:scroller.scrollLeft};
  }
  function close(){onOpenChange(false);requestAnimationFrame(()=>{
    const target=returnFocus.current?.isConnected?returnFocus.current:launcher.current;target?.focus({preventScroll:true});
    const range=returnRange.current,direction=returnDirection.current;if(range&&range.startContainer.isConnected&&range.endContainer.isConnected){const selection=document.getSelection();if(direction?.anchor.isConnected&&direction.focus.isConnected)selection?.setBaseAndExtent(direction.anchor,direction.anchorOffset,direction.focus,direction.focusOffset);else{selection?.removeAllRanges();selection?.addRange(range);}}
    const saved=returnScroll.current;if(saved?.element.isConnected){saved.element.scrollTop=saved.top;saved.element.scrollLeft=saved.left;}
  });}
  function ask(){
    if(!question.trim()||!records.length)return;
    setQuestions(previous=>[...previous.slice(-7),{id:crypto.randomUUID(),text:question.trim(),recordId:effectiveScope==='current'?current!.id:null,now:Date.now(),tag:findTag}]);
    setQuestion('');setPreview(null);
  }

  return <>
    {!suspended&&<button ref={launcher} className="inquiry-launcher movable-tool" data-manual-position={!!launcherTool.manual} style={launcherTool.style} aria-label={t(open?'收起笺间对话':'打开笺间对话')} title={t('轻点打开，拖动移动；方向键移动，Home复位')} aria-expanded={open} aria-controls="note-inquiry" {...launcherTool.drag} onPointerDown={event=>{rememberFocus();launcherTool.drag.onPointerDown(event);}} onKeyDown={launcherTool.keyboard} onClick={()=>{if(launcherTool.consumeClick())return;if(open)close();else{rememberFocus();onOpenChange(true);}}}><MessageCircle size={17}/><span>{t('笺间对话')}</span></button>}
    {visible&&<section ref={panel} id="note-inquiry" className={`note-inquiry ${sidebar?'is-docked':''}`} style={panelTool.style} role="region" aria-label={t('笺间对话')} onKeyDown={event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
      if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();event.stopPropagation();}
    }}>
      <header className="inquiry-heading" {...panelTool.drag}><div>{!sidebar&&<button data-floating-grip className="icon-button floating-grip" aria-label={t('移动对话浮窗')} title={t('拖动移动；方向键移动，Home复位')} onKeyDown={panelTool.keyboard}><GripVertical size={16}/></button>}<h2>{t('笺间对话')}</h2></div><div>{(panelTool.manual||launcherTool.manual)&&<button className="icon-button" aria-label={t('复位浮窗与入口')} title={t('复位浮窗与入口')} onClick={()=>{panelTool.reset();launcherTool.reset();}}><RotateCcw size={16}/></button>}<button className="icon-button inquiry-dock-toggle" aria-label={t(docked?'切换为浮窗':'固定为侧栏')} title={t(docked?'切换为浮窗':'固定为侧栏')} aria-pressed={docked} onClick={()=>onDockedChange(!docked)}><PanelRight size={17}/></button><button className="icon-button" aria-label={t('关闭聊天')} onClick={close}><X size={17}/></button></div></header>
      <div className="inquiry-modes" role="tablist" aria-label={t('询问方式')}><button role="tab" aria-selected={mode==='find'} onClick={()=>{setMode('find');setPreview(null);}}>{t('找记录')}</button><button role="tab" aria-selected={mode==='think'} onClick={()=>{setMode('think');setPreview(null);}}>{t('聊聊')}</button></div>
      {mode==='find'&&<div className="inquiry-scope"><label className="sr-only" htmlFor="inquiry-scope">{t('查找范围')}</label><select id="inquiry-scope" value={effectiveScope} onChange={event=>setScope(event.target.value as 'all'|'current')}><option value="all">{t('全部记录')}</option><option value="current" disabled={!current}>{t('当前记录')}</option></select><span>{t('仅已保存')}</span></div>}
      {mode==='find'&&findTag&&<ActiveTag value={findTag} onClear={()=>onClearTag?.()}/>}
      {source&&preview?<div className="inquiry-preview" role="region" aria-label={t('原文预览')}>
        <button className="text-button" onClick={()=>{if(preview.origin==='review')close();setPreview(null);}}><ArrowLeft size={14}/>{t(preview.origin==='review'?'返回回顾':'返回查找结果')}</button>
        <h3>{recordTitle(source)==='未命名记录'?t('未命名记录'):recordTitle(source)}</h3><time dateTime={source.createdAt}>{new Date(source.createdAt).toLocaleDateString(locale)}</time>
        {!exact&&<p className="inquiry-hint">{t('原文已更新，请重新核对。')}</p>}
        <div className="inquiry-source-text" tabIndex={0}>{!source.body.trim()?t('这条记录只有标题。'):exact?<>{source.body.slice(0,preview.quote.start)}<mark ref={element=>element?.scrollIntoView({block:'nearest'})}>{preview.quote.text}</mark>{source.body.slice(preview.quote.end)}</>:source.body}</div>
        <button className="button secondary" disabled={opening} onClick={async()=>{setOpening(true);try{if(await onOpenRecord(source,exact?{start:preview.quote.start,end:preview.quote.end}:undefined))onOpenChange(false);}finally{setOpening(false);}}}>{t('打开记录')}<ArrowUpRight size={14}/></button>
      </div>:mode==='think'?<div ref={setAiHost} className="memory-assistant-host"/>:<>
        <div ref={log} className="inquiry-conversation" role="log" aria-live="polite" aria-relevant="additions text">
          {!answers.length&&<div className="inquiry-welcome"><MessageCircle size={25}/><p>{t(records.length?'想找回哪一段记录？':'先记下一条，再来翻阅。')}</p></div>}
          {answers.map(item=><article className="inquiry-turn" key={item.id}>
            <p className="inquiry-question">{item.text}</p><span className="inquiry-answer-scope">{item.recordId?t('当前记录（已保存）'):t('全部已保存记录')}{item.tag&&' · #'+item.tag}</span>
            <RecallClues question={item.text} now={item.now} tags={records.flatMap(record=>record.tags)} relaxed={item.relaxed}/><p className="inquiry-answer-label">{t(item.results.length?'找到 {0} 条相关记录':'暂未找到相关记录，换条线索试试。',item.results.length)}</p>
            {!item.results.length&&!item.relaxed&&<button className="text-button" onClick={()=>{setQuestions(previous=>previous.map(q=>q.id===item.id?{...q,relaxed:true}:q));setExpanded(previous=>({...previous,[item.id]:3}));}}>{t('放宽关键词线索')}</button>}
            
            {item.results.slice(0,expanded[item.id]??3).map(result=><div className="inquiry-match" key={result.record.id}>
              <h3>{recordTitle(result.record)==='未命名记录'?t('未命名记录'):recordTitle(result.record)}</h3><time dateTime={result.record.createdAt}>{new Date(result.record.createdAt).toLocaleDateString(locale)}</time>
              {[result.quotes[0]??{text:'',start:0,end:0,line:1}].map(quote=><div key={quote.start}>{quote.text&&<blockquote><MatchedText text={quote.text} terms={result.matchedTerms}/></blockquote>}<button className="text-button" onClick={()=>setPreview({recordId:result.record.id,quote})}>{t('查看原文')}<ArrowUpRight size={13}/></button></div>)}
            </div>)}
            {item.results.length>(expanded[item.id]??3)&&<button className="text-button" onClick={()=>setExpanded(previous=>({...previous,[item.id]:(previous[item.id]??3)+12}))}>{t('再显示 {0} 条',Math.min(12,item.results.length-(expanded[item.id]??3)))}</button>}
            {item.results.length>15&&<p className="inquiry-hint">{t('已显示{0} / {1}条',Math.min(expanded[item.id]??3,item.results.length),item.results.length)}</p>}
          </article>)}
        </div>
        <form className="inquiry-form" onSubmit={event=>{event.preventDefault();ask();}}><label className="sr-only" htmlFor="inquiry-question">{t('询问已保存的笔记')}</label><div><input ref={input} id="inquiry-question" value={question} maxLength={200} onChange={event=>setQuestion(event.target.value)} placeholder={t('关键词、人物、时间…')} onKeyDown={event=>{if(event.key==='Enter'&&event.nativeEvent.isComposing)event.preventDefault();}}/><button className="button primary" aria-label={t('提交询问')} disabled={!question.trim()||!records.length}><Send size={16}/></button></div></form>
      </>}
    </section>}
    <MemoryAssistant creationActions={creationActions} host={aiHost} active={visible&&mode==='think'&&!preview} records={records} currentId={currentId} seed={seed} onSource={item=>setPreview({recordId:item.recordId,quote:{text:item.body,start:item.start,end:item.end,line:1}})}/>
  </>;
}
