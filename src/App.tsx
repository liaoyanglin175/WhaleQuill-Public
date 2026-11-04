import WindowControls,{windowDrag} from './components/WindowControls';
import {version as appVersion} from '../package.json';
import { useI18n } from './i18n';
import {publicSharingEnabled} from './features';
import {usePlannerMaintenance} from './tasks/usePlannerMaintenance';
import {isTodayEvent} from './domain/planner';
import {invoke,isTauri} from '@tauri-apps/api/core';
import type {CreationItem,CreationBatch,CreationActions} from './domain/creation';
import {useTaskSync} from './tasks/useTaskSync';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { CalendarDays, Check, CircleHelp, HardDrive, History, Settings as SettingsIcon, NotebookPen, Plus, Search, Trash2, X } from 'lucide-react';
import { createRecord, createTask, matchesQuery } from './domain/models';
import type { NoteRecord, Task, TrashEntry, Workspace } from './domain/models';
import { EditorSession } from './domain/editor-session';
import { readRecovery, writeRecovery, recoveryEnabled } from './storage/recovery';
import type { RecoveryEntry } from './storage/recovery';
import { getRepository } from './storage/repository';
import type { NotebookRepository } from './storage/repository';
import { downloadCompleteBackup, readBackupFile } from './storage/backup';
import type {BackupArchive} from './domain/stream-backup';
import {useBackupWork} from './storage/useBackupWork';
import BackupProgress from './components/BackupProgress';

import FishCompanion from './components/FishCompanion';
import type { CompanionSignal } from './components/FishCompanion';
import RecallPanel from './components/RecallPanel';
import RecordEditor from './components/RecordEditor';
import TaskList from './components/TaskList';
import ConfirmDialog from './components/ConfirmDialog';
import type { Confirmation } from './components/ConfirmDialog';
import RecordsOverview from './components/RecordsOverview';
import type { StarPosition } from './components/TimeStarMap';
import RecordList from './components/RecordList';
import TrashList from './components/TrashList';
import MemoryCues from './components/MemoryCues';
import Settings from './components/Settings';
import NoteInquiry from './components/NoteInquiry';
import PublicSquare from './components/PublicSquare';
import type {PublicPost} from './community';
import {publicationLink} from './community';
import {documentText} from './domain/rich-document';
import {useCompanion} from './companion/preferences';
import {collectTags,hasTag} from './domain/tags';
import { matchesTimeline } from './domain/record-view';
import { defaultTimelineFilters } from './components/TimelineFilters';
import type { TimelineFilterState } from './components/TimelineFilters';

type View = 'all' | 'tasks' | 'trash' | 'recall' | 'highlights' | 'community';
const emptyWorkspace: Workspace = { records: [], tasks: [] };
const viewLabels: Record<View, string> = { all: '随记', tasks: '日程', trash: '回收站', recall: '回顾', highlights: '重点',community:'灵感广场' };
const noSubscription = () => () => {};
const noSnapshot = () => null;

export default function App() {
  const { t, language } = useI18n();
  const backup=useBackupWork();
  const {preferences:companionPreferences}=useCompanion();
  const [repository, setRepository] = useState<NotebookRepository>();
  const [workspace, setWorkspace] = useState<Workspace>(emptyWorkspace);

  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [busy, setBusy] = useState(false);
  const operationBusy = useRef(false);
  const [view, setView] = useState<View>('all');
  const [timelineFilters, setTimelineFilters] = useState(defaultTimelineFilters);
  const { tag: tagFilter } = timelineFilters;
  const [starView, setStarView] = useState(() => {
    try { return localStorage.getItem('jingjian-timeline-view') !== 'list'; }
    catch { return true; }
  });
  const [starPosition, setStarPosition] = useState<StarPosition | null>(null);
  const [session, setSession] = useState<EditorSession | null>(null);
  const sessionRef = useRef<EditorSession | null>(null);
  const snapshot = useSyncExternalStore(session?.subscribe ?? noSubscription, session?.getSnapshot ?? noSnapshot);
  const [inlineCapture, setInlineCapture] = useState(false);
  const activeId = snapshot?.record.id ?? null;
  const [query, setQuery] = useState('');
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  useTaskSync(repository?.mode==='desktop',language,setWorkspace,setTrash);
  usePlannerMaintenance(repository,setWorkspace,setTrash);
  const [recovery, setRecovery] = useState<RecoveryEntry[]>([]);
  useEffect(()=>{const failed=(event:Event)=>setNotice({text:(event as CustomEvent<string>).detail,error:true});window.addEventListener('jingjian-planner-error',failed);return()=>window.removeEventListener('jingjian-planner-error',failed);},[]);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [showStorage, setShowStorage] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTarget,setSettingsTarget]=useState<'general'|'companion'|'model'|'data'>('general');
  const [showInquiry,setShowInquiry]=useState(false);
  const [inquiryDocked,setInquiryDocked]=useState(false);
  useEffect(()=>{
    const menu=()=>document.querySelector<HTMLDetailsElement>('.sidebar-more');
    const outside=(event:PointerEvent)=>{const details=menu();if(details?.open&&!details.contains(event.target as Node))details.open=false;};
    const escape=(event:KeyboardEvent)=>{const details=menu();if(event.key==='Escape'&&details?.open){event.preventDefault();event.stopPropagation();details.open=false;details.querySelector('summary')?.focus();}};
    document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);};
  },[]);
  useEffect(()=>{const settings=()=>{setSettingsTarget('model');setShowSettings(true);};window.addEventListener('dafeiyu-open-ai-settings',settings);return()=>window.removeEventListener('dafeiyu-open-ai-settings',settings);},[]);
  const [companionSignal, setCompanionSignal] = useState<CompanionSignal | null>(null);
  const signalSequence = useRef(0);
  const [focused, setFocused] = useState(false);
  const [sourceSelection, setSourceSelection] = useState<{ recordId: string; start: number; end: number } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const leaveResolver = useRef<((allow: boolean) => void) | null>(null);
  const leaveDecision = useRef(false);
  const actions = useRef({ canLeave: async () => true, save: async () => {}, blocked: false });
  useEffect(()=>{const changed=(event:Event)=>sessionRef.current?.setRecoveryEnabled((event as CustomEvent<boolean>).detail);window.addEventListener('dafeiyu-recovery-setting',changed);return()=>window.removeEventListener('dafeiyu-recovery-setting',changed);},[]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const repo = await getRepository();
        const [data, deleted] = await Promise.all([repo.load(), repo.loadTrash()]);
        if (!cancelled) {
          setRepository(repo); setWorkspace(data); setTrash(deleted);
          try {
            const entries = await readRecovery(repo.mode);
            if (!cancelled) setRecovery(entries);
          } catch { setNotice({ text: '无法读取旧版恢复副本；已保存的记录仍可使用。', error: true }); }
        }
      } catch (error) { if (!cancelled) setFatal(`本地存储打开失败：${errorMessage(error)}`); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(()=>{if(!repository)return;let cancelled=false;void readRecovery(repository.mode).then(entries=>{if(!cancelled)setRecovery(entries);}).catch(()=>{});return()=>{cancelled=true;};},[repository,trash]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (sessionRef.current?.getSnapshot().dirty) { event.preventDefault(); event.returnValue = ''; } };
    const shortcut = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open], .save-bubble')) setFocused(false);
      if (!(event.ctrlKey || event.metaKey)) return;
      if(event.isComposing){if(event.key.toLowerCase()==='s')event.preventDefault();return;}
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); if (!actions.current.blocked) { setFocused(false); if(searchInput.current)searchInput.current.focus();else window.dispatchEvent(new Event('dafeiyu-find')); } }
      if (event.key.toLowerCase() === 's') { event.preventDefault(); if (!actions.current.blocked) void actions.current.save(); }
    };
    window.addEventListener('beforeunload', unload); window.addEventListener('keydown', shortcut);
    return () => { window.removeEventListener('beforeunload', unload); window.removeEventListener('keydown', shortcut); };
  }, []);

  useEffect(() => {
    if (repository?.mode !== 'desktop') return;
    let cancelled = false;
    let closing=false;
    const finishClose=async(exit:boolean)=>{
      if(closing)return;closing=true;
      try{
        const hadDirty=!!sessionRef.current?.getSnapshot().dirty;
        if(exit&&sessionRef.current?.getSnapshot().dirty)await invoke('restore_notebook');
        if(!(await actions.current.canLeave()))return;
        // The leave decision ends this edit session. Keeping the old rich-editor
        // instance after discard would display content no longer in its snapshot.
        if(hadDirty)closeSession();
        // Let the save bubble finish restoring editor focus before hiding WebView2.
        // Otherwise its unmount cleanup can bring the just-hidden window back.
        await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
        await invoke(exit?'exit_background':'close_to_background');
      }catch(error){setNotice({text:`关闭失败：${errorMessage(error)}`,error:true});}finally{closing=false;}
    };
    let unlisten: (() => void) | undefined;
    let stopExit:(()=>void)|undefined;
    void import('@tauri-apps/api/event').then(async({listen})=>{const stop=await listen('whale-quill-exit-requested',()=>void finishClose(true));if(cancelled)stop();else stopExit=stop;});
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      const stop = await window.onCloseRequested(async (event) => {
        event.preventDefault();
        await finishClose(false);
      });
      if (cancelled) stop(); else unlisten = stop;
    }).catch((error) => setNotice({ text: `关窗保护初始化失败：${errorMessage(error)}`, error: true }));
    return () => { cancelled = true; unlisten?.(); stopExit?.(); };
  }, [repository?.mode]);
  useEffect(() => () => { sessionRef.current?.dispose(); }, []);
  useEffect(() => { if (repository?.mode === 'desktop') void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().setTitle(t('鲸笺'))).catch(() => {}); }, [language, repository?.mode]);
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  const perform = useCallback(async (action: (repo: NotebookRepository) => Promise<void>, message?: string): Promise<boolean> => {
    if (!repository || operationBusy.current) return false;
    operationBusy.current = true; setBusy(true);
    try {
      await action(repository);
      const [data, deleted] = await Promise.all([repository.load(), repository.loadTrash()]);
      setWorkspace(data); setTrash(deleted);
      if (message) setNotice({ text: message });
      return true;
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); return false; }
    finally { operationBusy.current = false; setBusy(false); }
  }, [repository]);

  function closeSession() { sessionRef.current?.dispose(); sessionRef.current = null; setSession(null); setInlineCapture(false); setSourceSelection(null); }
  async function createFromAi(requestId:string,items:CreationItem[]):Promise<CreationBatch>{if(!repository)throw new Error('本地空间尚未准备好');const batch=await repository.commitCreation(requestId,items);setWorkspace(await repository.load());return batch;}
  async function undoAiCreation(batch:CreationBatch){if(!repository)throw new Error('本地空间尚未准备好');if(batch.records.some(record=>record.id===activeId)){if(!(await canLeave()))throw new Error('已保留当前编辑，未撤销。');closeSession();}await repository.undoCreation(batch.requestId);const [data,deleted]=await Promise.all([repository.load(),repository.loadTrash()]);setWorkspace(data);setTrash(deleted);}
  const creationActions:CreationActions={create:createFromAi,undo:undoAiCreation,showPlanner:()=>void navigate('tasks'),showRecord:record=>void openRecall(record)};
  function signalCompanion(text: string, mood: 'happy' | 'pout' = 'happy') { setCompanionSignal({ id: ++signalSequence.current, text, mood }); }
  function beginSession(record: NoteRecord, isNew = false, recovered?: NoteRecord, legacyId = record.id) {
    if (!repository) return;
    closeSession();
    const next = new EditorSession(record, isNew, async (saved) => {
      await repository.saveRecord(saved);
      setWorkspace((current) => ({ ...current, records: [...current.records.filter((candidate) => candidate.id !== saved.id), saved] }));
    }, async (copy) => { if(copy){await writeRecovery(repository.mode,record.id,copy);}else{await writeRecovery(repository.mode,legacyId,null);if(legacyId!==record.id)await writeRecovery(repository.mode,record.id,null);} }, recovered, recoveryEnabled()?12_000:0);
    sessionRef.current = next; setSession(next);
    return next;
  }

  async function canLeave(): Promise<boolean> {
    if (operationBusy.current || confirmation || leaveResolver.current) return false;
    const current = sessionRef.current;
    if(current?.getSnapshot().status==='saving'){await current.waitForPendingSave();if(sessionRef.current!==current)return false;}
    if (!current || !current.getSnapshot().dirty) return true;
    setShowSettings(false);
    window.dispatchEvent(new Event('dafeiyu-close-overlays'));
    leaveDecision.current = false;
    return new Promise((resolve) => {
      leaveResolver.current = (allow) => { leaveResolver.current = null; resolve(allow); };
      setConfirmation({ title: '这一页，要保存吗？', body: '', label: '保存并离开', cancelLabel: '继续编辑', companion: true, action: async () => {
        if (!(await current.save())) return false;
        leaveDecision.current = true; return true;
      }, alternate: { label: '放弃本次修改', action: async () => { if(!(await current.discard()))return false;leaveDecision.current = true; return true; } } });
    });
  }
  function closeConfirmation() { confirmation?.onClose?.();setConfirmation(null); leaveResolver.current?.(leaveDecision.current); leaveDecision.current = false; }
  async function navigate(next: View) { if (!(await canLeave())) return; closeSession(); setFocused(false); setView(next); setQuery(''); setTimelineFilters(defaultTimelineFilters); }
  async function openRecord(id: string) {
    if (activeId === id && !inlineCapture && view === 'all') return;
    if (!(await canLeave())) return;
    const record = workspace.records.find((candidate) => candidate.id === id);
    if (!record) return;
    beginSession(record); setView('all');
    if (view !== 'all') { setQuery(''); setTimelineFilters(defaultTimelineFilters); }
  }
  async function openRecall(record: NoteRecord, selection?: { start: number; end: number }) {
    if (!(await canLeave())) return false;
    const current = workspace.records.find((candidate) => candidate.id === record.id);
    if (!current) return false;
    beginSession(current); setView('all'); setTimelineFilters(defaultTimelineFilters); setQuery('');
    if (selection) setSourceSelection({ recordId: current.id, ...selection });
    return true;
  }
  async function filterRecords(next: TimelineFilterState) {
    if (next.tag === tagFilter && next.days === timelineFilters.days && next.highlighted === timelineFilters.highlighted) return;
    if (!(await canLeave())) return;
    closeSession(); setTimelineFilters(next); setStarPosition(null);
  }
  async function filterTag(tag: string | null) {
    if (!(await canLeave())) return;
    closeSession(); setFocused(false); setView('all');
    setTimelineFilters({ ...defaultTimelineFilters, tag }); setQuery(''); setStarPosition(null);
  }
  async function saveEditedRecord(): Promise<boolean> {
    const current = sessionRef.current;
    if (!current) return true;
    const success = await current.save();
    if (success && !current.getSnapshot().isNew) { signalCompanion('这一页，替你收好了。'); }
    else if (success) setNotice({ text: '先写一点内容，再让我收好。' });
    else if (current.getSnapshot().status === 'pending') setNotice({ text: '点击保存时的内容已收好，后续输入尚未保存。' });
    return success;
  }
  async function saveCapture() { const current = sessionRef.current; if (await saveEditedRecord() && current && !current.getSnapshot().isNew && current === sessionRef.current) closeSession(); }
  actions.current = { canLeave:async()=>backup.work?false:canLeave(), save: async () => { if (inlineCapture) await saveCapture(); else await saveEditedRecord(); }, blocked: !!backup.work||!!confirmation || showSettings || busy || !!document.querySelector('.task-composer[open]') };
  async function addRecord() { if (!(await canLeave())) return; beginSession(createRecord(), true); setView('all'); setTimelineFilters(defaultTimelineFilters); setQuery(''); }
  function updateCapture(body: string) { const current = sessionRef.current ?? beginSession(createRecord(), true); setInlineCapture(true); current?.update({ body }); }
  function expandCapture() { if (!sessionRef.current) beginSession(createRecord(), true); setInlineCapture(false); }

  async function collectIdea(post:PublicPost){
    if(!(await canLeave()))return;
    const attribution=`来源：${post.author} · ${publicationLink(post.id)} · 版本 ${post.revision}`;
    const document=post.document?{...post.document,content:[...post.document.content,{type:'paragraph',content:[{type:'text',text:attribution}]}]}:null;
    const record={...createRecord(),title:post.title,body:document?documentText(document):post.body+'\n\n'+attribution,document};
    try{const sources=JSON.parse(localStorage.getItem('dafeiyu-idea-sources-v1')??'{}');sources[record.id]=post.id;localStorage.setItem('dafeiyu-idea-sources-v1',JSON.stringify(sources));}catch{}
    beginSession({...createRecord(),id:record.id},true,record);setView('all');setTimelineFilters(defaultTimelineFilters);setQuery('');
  }
  function deleteRecord(record: NoteRecord) {
    const current = sessionRef.current;
    if (!current) return;
    const isNew = current.getSnapshot().isNew;
    setConfirmation({ title: isNew ? '放弃这条草稿？' : '将已保存的记录移入回收站？', body: isNew ? '这条草稿还没有正式保存，放弃后不会出现在时间线。' : `“${record.title}”的已保存版本可以从回收站恢复。本次未保存修改将放弃，关联任务仍然保留。`, label: isNew ? '放弃草稿' : '确认删除', destructive: true, action: async () => {
      const success = isNew || await perform((repo) => repo.deleteRecord(record.id), '记录已移入回收站');
      if (success) { await current.discard(); closeSession(); }
      return success;
    } });
  }
  function deleteTask(task: Task) { setConfirmation({ title: task.kind==='event'?'将这条行程移入回收站？':'将这个任务移入回收站？', body: `“${task.title}”可以从回收站恢复，来源记录会保留。`, label: task.kind==='event'?'删除行程':'删除任务', destructive: true, action: () => perform((repo) => repo.deleteTask(task.id), '任务已移入回收站') }); }
  async function downloadSavedBackup() {
    if (!repository || operationBusy.current) return false;
    try {
      const result=await backup.run('export',async(token,signal,progress)=>repository.mode==='desktop'?invoke('export_complete_backup',{token,language}):downloadCompleteBackup(await repository.exportSnapshot(),signal,progress));
      if(!result)return false;
      setNotice({ text: '完整备份已导出，包含已保存重点、回收站与任务来源；不含未保存编辑。' }); return true;
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); return false; }
  }
  async function exportBackup() {
    if (!repository || operationBusy.current || confirmation) return;
    if (sessionRef.current?.getSnapshot().dirty) {
      setConfirmation({ title: '备份前，要保存当前修改吗？', body: '', label: '保存后备份', cancelLabel: '继续编辑', companion: true, action: async () => await saveEditedRecord() && await downloadSavedBackup(), alternate: { label: '仅备份已保存内容', action: downloadSavedBackup } });
    } else await downloadSavedBackup();
  }
  async function stageImport(archive:BackupArchive) {
    try {
      if (!(await canLeave())) return;
      const { records, tasks } = archive.version === 1 ? archive.workspace : archive.snapshot;
      const deleted = archive.version !== 1 ? [...archive.snapshot.records, ...archive.snapshot.tasks].filter((entry) => entry.deletedAt).length : 0;
      const collisions = records.filter((record) => workspace.records.some((existing) => existing.id === record.id) || trash.some((entry) => entry.kind === 'record' && entry.record.id === record.id)).length + tasks.filter((task) => workspace.tasks.some((existing) => existing.id === task.id) || trash.some((entry) => entry.kind === 'task' && entry.task.id === task.id)).length;
      setConfirmation({ title: '导入这份备份？', body: `包含 ${records.length} 条记录、${tasks.length} 个任务${archive.version !== 1 ? `，其中回收站 ${deleted} 项` : '（旧版格式）'}。同 ID 的 ${collisions} 个条目将由备份覆盖并恢复备份状态，其他数据保留。`, label: '确认导入', action: async () => {
        const success = await perform((repo) => archive.version === 1 ? repo.mergeWorkspace(archive.workspace) : repo.mergeSnapshot(archive.snapshot), '备份已导入');
        if (success) closeSession(); return success;
      } });
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); }
  }
  async function addLinkedTask(title: string,dueDate:string|null=null): Promise<boolean> {
    const current = sessionRef.current?.getSnapshot();
    if (!current || current.dirty || current.isNew) return false;
    const success = await perform((repo) => repo.saveTask(createTask(title, dueDate, current.record.id)), '已添加关联任务');
    if (success) signalCompanion('任务记下了，来源记录也留好了。'); return success;
  }
  async function importBackup() {
    if(backup.work||confirmation)return;
    if (repository?.mode === 'desktop') { try {
      const preview=await backup.run('import',token=>invoke<{token:string;records:number;tasks:number;deleted:number;collisions:number;bytes:number}|null>('preview_complete_backup',{token,language}));
      if(!preview)return;if(!(await canLeave())){await invoke('cancel_complete_backup',{token:preview.token});return;}
      setConfirmation({title:'导入这份备份？',body:`包含 ${preview.records} 条记录、${preview.tasks} 个任务，其中回收站 ${preview.deleted} 项。同 ID 的 ${preview.collisions} 个条目将由备份覆盖并恢复备份状态，其他数据保留。`,label:'确认导入',onClose:()=>{void invoke('cancel_complete_backup',{token:preview.token});},action:async()=>{const success=await perform(()=>invoke('commit_complete_backup',{token:preview.token}),'备份已导入');if(success)closeSession();return success;}});
    } catch (error) { setNotice({ text: errorMessage(error), error: true }); } }
    else fileInput.current?.click();
  }
  async function recoverDraft(entry: RecoveryEntry) {
    if (!(await canLeave()) || !repository) return;
    const saved = workspace.records.find((record) => record.id === entry.record.id);
    const deleted = trash.some((item) => item.kind === 'record' && item.record.id === entry.record.id);
    const record = deleted ? { ...entry.record, id: crypto.randomUUID() } : entry.record;
    beginSession(saved ?? { ...createRecord(record.recordType), id: record.id, createdAt: record.createdAt }, !saved, record, entry.record.id);
    setView('all'); setTimelineFilters(defaultTimelineFilters); setQuery(''); setRecovery((entries) => entries.filter((candidate) => candidate.record.id !== entry.record.id));
  }
  function discardLegacyDraft(entry: RecoveryEntry) { setConfirmation({ title: '丢弃这份恢复副本？', body: '只清除这份恢复副本，正式记录不会改变。', label: '丢弃副本', destructive: true, action: async () => { if (!repository) return false; await writeRecovery(repository.mode, entry.record.id, null); setRecovery((entries) => entries.filter((candidate) => candidate.record.id !== entry.record.id)); return true; } }); }

  const records = useMemo(() => {
    const now = new Date();
    return workspace.records.filter(record =>
      (!tagFilter || hasTag(record, tagFilter))
      && matchesTimeline(record, timelineFilters, now) && matchesQuery(record, query));
  }, [workspace.records, tagFilter, timelineFilters, query]);
  const availableTags=collectTags(workspace.records);
  const active = snapshot?.record;
  const pendingTasks = workspace.tasks.filter((task) => task.kind==='task'&&task.status === 'todo');
  const highlightCount = workspace.records.reduce((count, record) => count + record.highlights.length, 0);
  if (loading || fatal) return <div className="boot-screen"><img className="brand-logo" src="/brand/jingjian-transparent.png" alt=""/><h1>{fatal ? t("暂时无法打开记事本") : t("大肥鱼正在整理书桌…")}</h1>{fatal && <><p role="alert">{t(fatal)}</p><button className="button primary" onClick={() => location.reload()}>{t("重新尝试")}</button></>}</div>;

  return <div className={`app-shell ${focused && active && !inlineCapture ? 'is-focus' : ''} ${showInquiry&&inquiryDocked&&!confirmation&&!showSettings?'has-inquiry-sidebar':''}`} data-desktop={isTauri()} data-view={view} data-home={view==='all'&&(!active||inlineCapture)}>
    <aside className="sidebar" onMouseDown={windowDrag}>
      <a className={language==='en'?'brand is-english':'brand'} href="#" onClick={(event) => { event.preventDefault(); void navigate('all'); }}><img className="brand-logo" src="/brand/jingjian-transparent.png" alt=""/><span className="brand-name">{language==='zh'?<img className="brand-wordmark" src="/brand/jingjian-wordmark.svg" alt="鲸笺"/>:<span className="brand-english">WhaleQuill</span>}</span></a>
      <button className="new-record-button" disabled={busy} onClick={() => void addRecord()}><Plus size={18} />{t("写一条")}</button>
      <nav aria-label={t("主导航")}>
        <NavButton active={view === 'all'} label={t("随记")} count={workspace.records.length} onClick={() => void navigate('all')} icon={<NotebookPen size={18} />} />
        <NavButton active={view === 'recall'} label={t("回顾")} onClick={() => void navigate('recall')} icon={<History size={18} />} />
        <NavButton active={view==='tasks'} label={t('日程')} count={pendingTasks.length+workspace.tasks.filter(task=>isTodayEvent(task)).length} onClick={()=>void navigate('tasks')} icon={<CalendarDays size={18}/>}/>
        <details className="sidebar-more"><summary>{t("更多")}</summary><div className="sidebar-more-menu" onClick={event=>{if((event.target as Element).closest('button'))event.currentTarget.closest('details')?.removeAttribute('open');}}><NavButton active={view === 'trash'} label={t("回收站")} count={trash.length} onClick={() => void navigate('trash')} icon={<Trash2 size={18} />} /><button className="sidebar-tool" disabled={busy} onClick={() => void exportBackup()}>{t("完整备份")}</button><button className="sidebar-tool" disabled={busy} onClick={() => void importBackup()}>{t("导入备份")}</button><button className="sidebar-tool" onClick={() => setShowStorage((value) => !value)}>{t("存储说明")}</button></div></details>
        <button className="sidebar-settings" onClick={() => {setSettingsTarget('general');setShowSettings(true);}}><SettingsIcon size={18}/>{t('设置')}</button>
      </nav>
      <div className="sidebar-bottom"><span className="storage-status"><span className="online-dot" />{repository?.mode === 'desktop' ? t("本地桌面空间") : t("浏览器预览空间")}</span><span className="version">{appVersion}</span></div>
    </aside>
    <main className="main-area">
      <header className="page-header" onMouseDown={windowDrag}><h1>{t(viewLabels[view])}</h1><div className="header-right">{view !== 'recall' && view!=='community' && view!=='all' && <div className="search-field"><Search size={16} /><input ref={searchInput} aria-label={t("搜索记录和任务")} placeholder={view === 'highlights' ? t("找一句重点…") : view === 'tasks' ? t("搜索待办与行程…") : t("找一条记录…")} value={query} onChange={(event) => setQuery(event.target.value)} /><kbd>Ctrl K</kbd>{query && <button className="icon-button" aria-label={t("清空搜索")} onClick={() => setQuery('')}><X size={14} /></button>}</div>}{view==='all'&&<button className="search-field global-note-search" aria-label={t('搜索记录和任务')} onMouseDown={event=>event.preventDefault()} onClick={()=>window.dispatchEvent(new Event('dafeiyu-find'))}><Search size={16}/><span>{t('搜索记录…')}</span><kbd>Ctrl K</kbd></button>}<div id="companion-slot" className="companion-slot" /></div><WindowControls/></header>
      {showStorage && <div className="storage-explainer"><HardDrive size={18} /><p>{repository?.mode === 'desktop' ? t("已保存内容保存在这台设备的 SQLite 数据库。") : t("预览内容保存在当前浏览器的 IndexedDB，清除站点数据会清除记录。桌面版使用独立数据库，可通过完整备份迁移。")}{t(" 正式记录由你手动保存；启用时会保留本地崩溃恢复副本，不上传云端。")}</p><button className="icon-button" aria-label={t("关闭存储说明")} onClick={() => setShowStorage(false)}><X size={16} /></button></div>}
      {!!recovery.length && <div className="recovery-banner" role="region" aria-label={t("未保存内容恢复")}><span>{t("发现 ")}{recovery.length}{t(" 份恢复副本：")}{recovery[0].record.title || t("未命名记录")}{t("。打开后仍需手动保存。")}</span><button className="button secondary" onClick={() => void recoverDraft(recovery[0])}>{t("恢复编辑")}</button><button className="text-button" onClick={() => discardLegacyDraft(recovery[0])}>{t("丢弃副本")}</button></div>}
      <TaskList active={view==='tasks'} tasks={workspace.tasks} records={workspace.records} busy={busy} query={view==='tasks'?query:''} onAdd={(task)=>perform(repo=>repo.saveTask(task),task.kind==='event'?'行程已添加':'任务已添加')} onUpdate={(task,expected)=>perform(repo=>repo.saveTask(task,expected))} onDelete={deleteTask} onOpenRecord={openRecord}/>
      <RecallPanel active={view==='recall'} records={workspace.records} onOpen={openRecall}/>
      {view==='community'&&publicSharingEnabled?<PublicSquare onCollect={post=>void collectIdea(post)}/>:view === 'recall' ? null : view === 'highlights' ? <div className="highlights-panel"><MemoryCues records={workspace.records} onOpen={openRecall} all query={query} /></div> : view === 'trash' ? <TrashList entries={trash} query={query} busy={busy} onRestore={(entry) => void perform((repo) => repo.restore(entry.kind, entry.kind === 'record' ? entry.record.id : entry.task.id), '内容已恢复')} /> : view === 'tasks' ? null : !active || inlineCapture ? <RecordsOverview
        availableTags={availableTags} filters={timelineFilters} onTag={tag=>void filterTag(tag)} onFilters={filterRecords}
        records={records} allRecords={workspace.records} tasks={workspace.tasks} query={query} busy={busy}
        onOpen={openRecord} onRecall={openRecall} draftBody={inlineCapture ? active?.body ?? '' : ''}
        draftError={inlineCapture ? snapshot?.error || snapshot?.recoveryError || '' : ''} saving={snapshot?.status === 'saving'}
        onDraftChange={updateCapture} onSaveDraft={saveCapture} onExpand={expandCapture} onComposing={(composing) => sessionRef.current?.setComposing(composing)}
        starView={starView} onStarView={value => {
          setStarView(value);
          try { localStorage.setItem('jingjian-timeline-view', value ? 'stars' : 'list'); }
          catch { /* Keep the current view for this session. */ }
        }} starPosition={starPosition} onStarPosition={setStarPosition} blocked={!!confirmation || showSettings || !!backup.work}
      /> : <div className="record-workspace has-selection">
        <RecordList availableTags={availableTags} filters={timelineFilters} onTag={tag=>void filterTag(tag)} records={records} activeId={activeId} query={query} busy={busy} onFilters={filterRecords} onOpen={openRecord} onCreate={addRecord} />
        {session && <RecordEditor availableTags={availableTags} onTag={tag=>void filterTag(tag)} key={active.id} session={session} contextLabel={t("记录")} busy={busy} onSave={saveEditedRecord} onDelete={() => deleteRecord(active)} onTask={addLinkedTask} focused={focused} onFocus={() => setFocused((value) => !value)} sourceSelection={sourceSelection} onBack={async () => { if (await canLeave()) { closeSession(); setFocused(false); } }} />}
      </div>}
      <footer className="app-footer"><span>{workspace.records.length}{t(" 条已保存记录 · ")}{highlightCount}{t(" 处重点")}</span><span><HardDrive size={12} />{t(" 本地保存 · 自由导出")}</span></footer>
    </main>
    <NoteInquiry creationActions={creationActions} records={workspace.records} currentId={activeId} open={showInquiry} docked={inquiryDocked} blocked={!!confirmation||showSettings||busy} onOpenChange={setShowInquiry} onDockedChange={setInquiryDocked} onOpenRecord={openRecall} findTag={view==='all'?tagFilter:null} onClearTag={()=>setTimelineFilters(current=>({...current,tag:null}))}/>
    <FishCompanion record={workspace.records.find(record=>record.id===activeId)??null} onSource={record=>void openRecall(record)} signal={companionSignal} busy={busy || (!!confirmation && !confirmation.companion)} prompt={confirmation?.companion ? confirmation : null} onPromptClose={closeConfirmation} onRequestSave={() => { if (!sessionRef.current?.getSnapshot().dirty || confirmation || busy || showSettings) return false; void canLeave().then(allow => { if (allow && inlineCapture) closeSession(); }); return true; }} onSettings={() => setShowSettings(true)} onAskNotes={()=>setShowInquiry(true)} onCreate={() => void addRecord()} />
    {notice && <div className={`toast ${notice.error ? 'error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{t(notice.text)}</span><button className="icon-button" aria-label={t("关闭提示")} onClick={() => setNotice(null)}><X size={15} /></button></div>}
    {confirmation && (!confirmation.companion||!companionPreferences.visible) && <ConfirmDialog confirmation={confirmation.companion?{...confirmation,title:confirmation.title==='这条要收好吗？'?'保存修改？':confirmation.title,label:confirmation.label==='保存并离开'?'保存':confirmation.label,cancelLabel:confirmation.cancelLabel==='继续编辑'?'继续写':confirmation.cancelLabel,alternate:confirmation.alternate?{...confirmation.alternate,label:confirmation.alternate.label==='放弃本次修改'?'丢弃':confirmation.alternate.label}:undefined}:confirmation} busy={busy} onClose={closeConfirmation} />}
    {showSettings && <Settings initialTab={settingsTarget} onClose={() => setShowSettings(false)} />}
    <input ref={fileInput} type="file" accept=".wqbackup,application/json,.json" className="sr-only" aria-label={t("选择备份文件")} onChange={async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;try{const archive=await backup.run('import',(_token,signal,progress)=>readBackupFile(file,signal,progress));if(archive)await stageImport(archive);}catch(error){setNotice({text:errorMessage(error),error:true});} }} />
    {backup.work&&<BackupProgress work={backup.work} onCancel={backup.cancel}/>}
  </div>;
}
function NavButton({ active, label, count, onClick, icon }: { active: boolean; label: string; count?: number; onClick: () => void; icon: React.ReactNode }) { const { t } = useI18n(); return <button className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}>{icon}<span>{t(label)}</span>{count!==undefined&&<small>{count}</small>}</button>; }
function errorMessage(error: unknown): string { if (error && typeof error === 'object' && 'issues' in error && Array.isArray(error.issues)) return String(error.issues[0]?.message ?? '输入内容不符合要求'); return error instanceof Error ? error.message : String(error); }
