import { useI18n } from '../i18n';
import { lazy,Suspense,useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowDownToLine, ArrowLeft, Highlighter, ListPlus, Maximize2, Minimize2, MoreHorizontal, Share2, Trash2, X } from 'lucide-react';
import {publicSharingEnabled} from '../features';
import { recordTitle } from '../domain/models';
import type { EditorSession } from '../domain/editor-session';
import TaskComposer from './TaskComposer';
const RichEditor=lazy(()=>import('./RichEditor'));
const PublicationComposer=lazy(()=>import('./PublicationComposer'));
import type {RichEditorHandle} from './RichEditor';
import { markdownDocument, markdownFilename } from '../domain/task-extraction';
import { downloadText } from '../storage/backup';
import {RecordTags} from './RecordTags';

export default function RecordEditor({ session, contextLabel, busy, onSave, onDelete, onTask, onBack, focused, onFocus, sourceSelection,onTag }: {
  session: EditorSession; contextLabel: string; busy: boolean;
  onSave: () => Promise<boolean>; onDelete: () => void;
  onTask: (title: string,dueDate?:string|null) => Promise<boolean>; onBack: () => void;
  focused: boolean; onFocus: () => void;
  availableTags:{name:string;count:number}[];onTag:(tag:string)=>void;
  sourceSelection?: { recordId: string; start: number; end: number } | null;
}) {
  const { t, locale } = useI18n();
  const { record, dirty, isNew, status, error, recoveryError, resetVersion } = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const autoTitle=useRef(record.title==='未命名记录'||record.title===recordTitle({...record,title:'未命名记录'}));
  const [selection, setSelection] = useState({ text: '', start: 0, end: 0 });
  const [composer, setComposer] = useState(false);
  const [publishing,setPublishing]=useState(false);
  const [editorReady,setEditorReady]=useState(false);
  const richEditor=useRef<RichEditorHandle>(null);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const tools = useRef<HTMLDetailsElement>(null);
  useEffect(()=>{setSelection({text:'',start:0,end:0});setLocalError('');setMessage('');setEditorReady(false);},[resetVersion]);
  function selectSource(start: number, end: number) {
    richEditor.current?.select(start,end);
  }
  function closeComposer() { setComposer(false);requestAnimationFrame(()=>richEditor.current?.select(selection.start,selection.end)); }
  useEffect(() => {
    if (sourceSelection?.recordId === record.id) selectSource(sourceSelection.start, sourceSelection.end);
  }, [sourceSelection]);
  useEffect(() => { const close = () => {setComposer(false);setPublishing(false);}; window.addEventListener('dafeiyu-close-overlays', close); return () => window.removeEventListener('dafeiyu-close-overlays', close); }, []);
  const saving = status === 'saving';
  const stateLabel = saving ? '正在保存…' : status === 'error' ? '保存失败，请重试' : dirty ? '尚未保存' : isNew ? '' : '已保存在本机';
  function closeTools() { if (tools.current) tools.current.open = false; }
  useEffect(()=>{
    const outside=(event:PointerEvent)=>{if(!tools.current?.contains(event.target as Node))closeTools();};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&tools.current?.open){event.preventDefault();event.stopPropagation();closeTools();tools.current.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[]);

  return <section className="editor-panel" aria-label={t("记录编辑器")} onCompositionStart={() => session.setComposing(true)} onCompositionEnd={() => session.setComposing(false)}>
    <div className="editor-toolbar">
      <div className="editor-breadcrumb"><button className="icon-button editor-back" aria-label={t("返回记录列表")} title={t('返回{0}',t(contextLabel))} onClick={onBack}><ArrowLeft size={17} /></button><span className="breadcrumb-current">{recordTitle(record)==='未命名记录'?t('未命名记录'):recordTitle(record)}</span></div>
      <div className="toolbar-actions">
        <details ref={tools} className="editor-tools"><summary aria-label={t("更多操作")} title={t("更多操作")}><MoreHorizontal size={20} /></summary><div className="tools-menu">
          {publicSharingEnabled&&<button disabled={busy||saving} onClick={()=>{closeTools();setPublishing(true);}}><Share2 size={16}/>{t('发布到广场')}</button>}
          <button aria-label={focused?t('退出专注编辑'):t('进入专注编辑')} onClick={()=>{closeTools();onFocus();}}>{focused?<Minimize2 size={16}/>:<Maximize2 size={16}/>} {t(focused?'退出专注编辑':'专注编辑')}</button>
          <button disabled={busy || saving} onClick={async () => { closeTools(); setLocalError(''); try { const latest = session.getSnapshot().record; await downloadText(markdownDocument(recordTitle(latest), latest.body, latest.tags), markdownFilename(recordTitle(latest))); setMessage('已导出当前编辑内容；本地保存状态未改变。'); } catch (error) { setLocalError(`导出失败：${error instanceof Error ? error.message : String(error)}`); } }}><ArrowDownToLine size={16} />{t("导出 Markdown")}</button>
          <button disabled={busy || saving || !record.body.trim()&&!record.title.trim()} onClick={() => { closeTools(); setComposer(true); }}><ListPlus size={16} />{t("创建任务")}</button>
          <button disabled={busy || saving} className="delete-button" aria-label={t("删除当前记录")} onClick={() => { closeTools(); onDelete(); }}><Trash2 size={16} />{isNew ? t("放弃当前草稿") : t("移入回收站")}</button>
        </div></details>
      </div>
    </div>
    <div className="editor-content">
      <label className="sr-only" htmlFor="record-title">{t("记录标题")}</label>
      <input id="record-title" className={`title-input ${autoTitle.current?'is-automatic-title':''}`} value={autoTitle.current?'':record.title === '未命名记录' ? '' : record.title} maxLength={200} placeholder={t("标题可选，也可以直接写正文")} onChange={(event) => {autoTitle.current=false;session.update({ title: event.target.value });}} />
      <div className="record-meta"><time dateTime={record.createdAt}>{t("记录于 ")}{new Date(record.createdAt).toLocaleDateString(locale, { month: 'long', day: 'numeric' })}</time></div>
      <RecordTags tags={record.tags} onTag={onTag} disabled={busy||saving||!editorReady} onChange={(tag,next)=>richEditor.current?richEditor.current.changeTag(tag,next):t('请稍后再修改标签。')}/>
      <div className="editor-divider" />
      <Suspense fallback={<p>{t('正在打开排版编辑…')}</p>}><RichEditor key={resetVersion} ref={richEditor} session={session} initialSelection={sourceSelection??undefined} onSelection={setSelection} onError={setLocalError} onTask={()=>setComposer(true)} onPublish={()=>setPublishing(true)} onTag={onTag} onReady={()=>setEditorReady(true)} disabled={busy||saving}/></Suspense>
      {!!record.highlights.length && <details className="editor-highlights"><summary><Highlighter size={14} />{t("本条重点 · ")}{record.highlights.length}{dirty ? t("（随记录保存）") : ''}</summary><ul>{record.highlights.map((highlight) => <li key={highlight.id} className={highlight.stale ? 'stale' : ''}><button className="highlight-source" disabled={highlight.stale} onClick={() => selectSource(highlight.start, highlight.end)}>{highlight.text}<small>{highlight.stale ? t("原文已修改，请重新划重点") : t("点击定位原文")}</small></button><button className="icon-button" aria-label={t('移除重点：{0}',highlight.text.slice(0,30))} onClick={() => richEditor.current?.removeMemory(highlight.id)}><X size={15} /></button></li>)}</ul></details>}
    </div>
    {error && <p className="save-error" role="alert">{t(error)}</p>}
    {recoveryError&&<p className="save-error" role="alert">{t(recoveryError)}</p>}
    {localError && <p className="save-error" role="alert">{t(localError)}</p>}
    {message && <p className="editor-message" role="status">{t(message)}</p>}
    <footer className="editor-footer"><span className={`save-state ${dirty || error ? 'unsaved' : ''}`} aria-live="polite">{dirty || error ? <span className="unsaved-dot" /> : null}{t(stateLabel)}</span><div><span className="word-count">{record.body.length.toLocaleString()}{t(" 字")}</span><button data-floating-avoid className="button primary save-button" title={t("让大肥鱼收好这条（Ctrl+S）")} disabled={busy || saving} onClick={() => void onSave()}>{saving ? t("保存中…") : t("保存记录")}</button></div></footer>
    {publicSharingEnabled&&publishing&&<Suspense fallback={null}><PublicationComposer record={record} selection={selection.text} dirty={dirty||isNew} onSave={onSave} onClose={()=>setPublishing(false)}/></Suspense>}
    {composer && <TaskComposer body={record.body} selection={selection.text || (record.title==='未命名记录'?'':record.title)} requiresSave={dirty || isNew} onClose={closeComposer} onConfirm={async (title,dueDate) => (!(dirty || isNew) || await onSave()) && await onTask(title,dueDate)} />}
  </section>;
}
