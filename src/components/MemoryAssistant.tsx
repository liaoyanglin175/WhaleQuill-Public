import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import type {NoteRecord} from '../domain/models';
import {combineMemorySources,memorySources,reindexSources,sourcesCurrent} from '../domain/memory-context';
import type {ConversationTurn,MemoryAnswer,MemoryPeriod,MemorySource} from '../domain/memory-context';
import {aiStatus,askAi} from '../ai/client';
import {useI18n} from '../i18n';
import {creationIntent,creationProposalSchema} from '../domain/creation';
import type {CreationActions,CreationBatch} from '../domain/creation';
import CreationPreview from './CreationPreview';
import WorkScene from './WorkScene';

type ChatTurn={id:string;question:string;response:MemoryAnswer;sources:MemorySource[];batch?:CreationBatch|null;selected?:boolean[]};
type Prepared={allowCreation:boolean;question:string;context:string;sources:MemorySource[];historySources:MemorySource[];conversation:ConversationTurn[]};
export type MemorySeed={id:number;text:string;review?:{label:string;sources:MemorySource[]}};

export default function MemoryAssistant({creationActions,host,active,records,currentId,seed,onSource}: {creationActions:CreationActions;host:HTMLElement|null;active:boolean;records:NoteRecord[];currentId:string|null;seed:MemorySeed|null;onSource:(source:MemorySource)=>void}) {
  const {t,language,locale}=useI18n();
  const [question,setQuestion]=useState(''),[context,setContext]=useState('');
  const [period,setPeriod]=useState<MemoryPeriod>('all'),[prepared,setPrepared]=useState<Prepared|null>(null);
  const [excluded,setExcluded]=useState<string[]>([]),[consent,setConsent]=useState(false),[includeConversation,setIncludeConversation]=useState(true);
  const [turns,setTurns]=useState<ChatTurn[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [status,setStatus]=useState({configured:false,supported:false});
  const [reviewScope,setReviewScope]=useState<MemorySeed['review']>(undefined);
  const reviewStale=!!reviewScope&&!sourcesCurrent(reviewScope.sources,records);
  const request=useRef<{token:number;controller:AbortController}|null>(null),generation=useRef(0),recordsRef=useRef(records);recordsRef.current=records;
  const selected=reindexSources((prepared?.sources??[]).filter(source=>!excluded.includes(source.recordId)));

  function stop(){generation.current++;request.current?.controller.abort();request.current=null;setBusy(false);window.dispatchEvent(new CustomEvent('dafeiyu-thinking',{detail:false}));}
  useEffect(()=>{if(!active||!host)return;const frame=requestAnimationFrame(()=>host.querySelector<HTMLTextAreaElement>('#ai-question')?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);},[host,active]);
  useEffect(()=>{const refresh=()=>{void aiStatus().then(setStatus).catch(()=>setStatus({configured:false,supported:false}));};refresh();window.addEventListener('dafeiyu-ai-setting',refresh);return()=>window.removeEventListener('dafeiyu-ai-setting',refresh);},[]);
  useEffect(()=>{if(!active)stop();},[active]);
  useEffect(()=>{stop();setContext('');setPrepared(null);setConsent(false);},[currentId]);
  useEffect(()=>{if(!seed)return;stop();setPrepared(null);setConsent(false);setError('');setReviewScope(seed.review);if(seed.review){setContext('');setQuestion(seed.text);setPeriod('all');setTurns([]);}else{setContext(seed.text);setQuestion(seed.text?(language==='en'?'Can we talk about this excerpt?':'聊聊这段吧。'):'');}},[seed?.id]);
  useEffect(()=>{
    if(prepared&&(!sourcesCurrent(prepared.sources,records)||!sourcesCurrent(prepared.historySources,records))){stop();setPrepared(null);setConsent(false);setError('参考原文已变化，请重新预览。');}
  },[records]);
  useEffect(()=>()=>{generation.current++;request.current?.controller.abort();window.dispatchEvent(new CustomEvent('dafeiyu-thinking',{detail:false}));},[]);

  function preview(){
    stop();setError('');setExcluded([]);setConsent(false);
    if(reviewStale){setError('回顾来源已变化，请返回回顾重新选择。');return;}
    const recent=turns.filter(turn=>sourcesCurrent(turn.sources,records)).slice(-3);
    const fresh=reviewScope?reviewScope.sources:memorySources(records,question,context,period);
    const since=period==='week'?Date.now()-7*86400000:period==='month'?Date.now()-30*86400000:-Infinity;
    const combined=[...fresh,...recent.flatMap(turn=>turn.sources).filter(source=>Date.parse(source.date)>=since)];
    const sources=combineMemorySources(fresh,combined.slice(fresh.length));
    setPrepared({allowCreation:creationIntent(question)||recent.some(turn=>creationIntent(turn.question)),question:question.trim(),context,sources,historySources:recent.flatMap(turn=>turn.sources),conversation:recent.map(turn=>({question:turn.question,answer:turn.response.answer+(turn.response.creation?"\n"+(turn.batch?"用户已确认创建，请不要重复创建：":"尚未确认的创建草案：")+JSON.stringify({items:turn.response.creation.items.map(item=>({...item,body:item.body.slice(0,180),notes:item.notes.slice(0,180)}))}).slice(0,4200):"")}))});
  }
  function clearChat(){stop();setTurns([]);setPrepared(null);setConsent(false);setQuestion('');setContext('');setError('');}
  async function send(){
    if(!prepared||!consent||busy||!status.configured||!sourcesCurrent(selected,records)||includeConversation&&!sourcesCurrent(prepared.historySources,records))return;
    const controller=new AbortController(),token=++generation.current;request.current={token,controller};
    setBusy(true);setError('');window.dispatchEvent(new CustomEvent('dafeiyu-thinking',{detail:true}));
    try {
      const result=await askAi({id:crypto.randomUUID(),question:prepared.question,context:prepared.context,sources:selected,conversation:includeConversation?prepared.conversation:[],language,signal:controller.signal,allowCreation:prepared.allowCreation});
      if(controller.signal.aborted||generation.current!==token)return;
      if(result.creation)result.creation=creationProposalSchema.parse(result.creation);
      if(!sourcesCurrent(selected,recordsRef.current)){setError('参考原文已变化，请重新预览。');return;}
      setTurns(previous=>[...previous.slice(-3),{id:crypto.randomUUID(),question:prepared.question,response:result,sources:selected}]);
      setPrepared(null);setConsent(false);setQuestion('');setContext('');
      if(!result.creation)window.dispatchEvent(new CustomEvent('dafeiyu-answer',{detail:t('我把回答写在对话里了。')}));
    }catch(error){if(!controller.signal.aborted&&generation.current===token)setError(String(error));}
    finally{if(generation.current===token){request.current=null;setBusy(false);window.dispatchEvent(new CustomEvent('dafeiyu-thinking',{detail:false}));}}
  }
  if(!host)return null;
  return createPortal(<div className="memory-assistant">
    <div className="memory-assistant-body">
      {!status.configured&&<p className="ai-connection-hint">{t(status.supported?'先在设置中连接 DeepSeek，即可结合原文思考。':'AI 在 Windows 桌面版中使用。')} {status.supported&&<button className="text-button" onClick={()=>window.dispatchEvent(new Event('dafeiyu-open-ai-settings'))}>{t('设置连接')}</button>}</p>}
      {!!turns.length&&<div className="ai-chat-tools"><span>DeepSeek</span><button className="text-button" onClick={clearChat}>{t('清空本次聊天')}</button></div>}
      {!turns.length&&!prepared&&<p className="inquiry-hint">{t('有什么想一起想想？')}</p>}
      {turns.map(turn=>{
        const stale=!sourcesCurrent(turn.sources,records),references=turn.sources.filter(source=>turn.response.citations.includes(source.reference));
        return <article className="ai-answer" aria-label={t('大肥鱼的回答')} key={turn.id}>
          <p className="ai-turn-question">{turn.question}</p>
          {stale?<p role="status">{t('参考原文已变化，请重新询问。')}</p>:<>
            <p className="ai-answer-text">{turn.response.answer}</p>
            {turn.response.creation&&<CreationPreview proposal={turn.response.creation} requestId={turn.id} actions={creationActions} disabled={busy||stale} initialBatch={turn.batch} initialSelected={turn.selected} onDraftChange={(items,selected)=>setTurns(previous=>previous.map(item=>item.id===turn.id?{...item,selected,response:{...item.response,creation:{items}}}:item))} onApplied={batch=>setTurns(previous=>previous.map(item=>item.id===turn.id?{...item,batch}:item))}/>}
            {!!turn.response.nextSteps.length&&<ul>{turn.response.nextSteps.map((step,index)=><li key={index}>{step}</li>)}</ul>}
            {!!references.length&&<details className="ai-answer-sources"><summary>{t('查看依据')} ({references.length})</summary>{references.map(source=><button key={source.recordId} className="ai-reference" onClick={()=>onSource(source)}>[{source.reference}] {new Date(source.date).toLocaleDateString(locale)} · {source.title}</button>)}</details>}
          </>}
        </article>;
      })}
      {busy&&prepared?.allowCreation&&<WorkScene/>}
      {context&&<div className="ai-context"><small>{t('本次临时片段')}</small><blockquote>{context}</blockquote><button className="text-button" disabled={busy} onClick={()=>{setContext('');setPrepared(null);setConsent(false);}}>{t('移除片段')}</button></div>}
      {prepared&&!busy&&<div className="ai-send-preview" role="region" aria-label={t('发送内容预览')}>
        <p>{t('将发送给 DeepSeek')}</p><blockquote>{prepared.question}</blockquote>
        <p className="inquiry-hint">{t('参考原文（最多5条）')} · {selected.length}</p>
        {!prepared.sources.length&&<p className="inquiry-hint">{t('没有找到相关历史；只发送问题和本次片段。')}</p>}
        {prepared.sources.map(source=><details className="ai-source" key={source.recordId}><summary><input type="checkbox" aria-label={t('发送来源：{0}',source.title)} checked={!excluded.includes(source.recordId)} disabled={busy} onClick={event=>event.stopPropagation()} onChange={event=>{setConsent(false);setExcluded(previous=>event.target.checked?previous.filter(id=>id!==source.recordId):[...previous,source.recordId]);}}/>{source.title}<time>{new Date(source.date).toLocaleDateString(locale)}</time></summary><blockquote>{source.body||t('这条记录只有标题。')}</blockquote></details>)}
        {!!prepared.conversation.length&&<details className="ai-history-preview"><summary>{t('最近 {0} 轮聊天',prepared.conversation.length)}</summary><label><input type="checkbox" checked={includeConversation} disabled={busy} onChange={event=>{setIncludeConversation(event.target.checked);setConsent(false);}}/>{t('附带这些聊天')}</label>{prepared.conversation.map((turn,index)=><div key={index}><p>{turn.question}</p><blockquote>{turn.answer}</blockquote></div>)}</details>}
        <label className="ai-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>{t('允许发送本次问题、片段、勾选的原文和聊天')}</label>
        <button className="button primary" disabled={!consent||!status.configured||busy} onClick={()=>void send()}>{t(busy?'正在思考…':'发送并思考')}</button>
      </div>}
      {busy&&<button className="text-button" onClick={stop}>{t('停止思考')}</button>}
      {error&&<p className="save-error" role="alert">{t(error)}</p>}
    </div>
    <form className="ai-question-form" onSubmit={event=>{event.preventDefault();if(question.trim())preview();}}>
      {reviewScope?<div className="ai-review-scope"><span>{t('本次主题：{0}',reviewScope.label)}</span><small>{t('选取 {0} 条原文，发送前可核对。',reviewScope.sources.length)}</small><button type="button" className="text-button" disabled={busy} onClick={()=>{clearChat();setReviewScope(undefined);}}>{t('退出主题范围')}</button>{reviewStale&&<p role="status">{t('回顾来源已变化，请返回回顾重新选择。')}</p>}</div>:<label className="ai-period">{t('参考记录范围')}<select aria-label={t('参考记录范围')} value={period} disabled={busy} onChange={event=>{setPeriod(event.target.value as MemoryPeriod);setPrepared(null);setConsent(false);}}><option value="all">{t('全部已保存记录')}</option><option value="week">{t('最近7天')}</option><option value="month">{t('最近30天')}</option></select></label>}
      <label className="sr-only" htmlFor="ai-question">{t('想和大肥鱼讨论什么？')}</label><textarea id="ai-question" maxLength={2000} value={question} disabled={busy} placeholder={t('有什么想一起想想？')} onChange={event=>{setQuestion(event.target.value);setPrepared(null);setConsent(false);}}/>
      <button className="button secondary" disabled={busy||!question.trim()||reviewStale}>{t('发送前预览')}</button>
    </form>
  </div>,host);
}
