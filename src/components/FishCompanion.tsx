import {Eye} from 'lucide-react';
import { useEffect,useRef,useState } from 'react';
import { createPortal } from 'react-dom';
import type { MouseEvent,PointerEvent,CSSProperties } from 'react';
import { useI18n } from '../i18n';
import { useCompanion } from '../companion/preferences';
import type { Point } from '../companion/preferences';
import { clampPoint,nextDestination,clearRoute,edgeSpots } from '../companion/movement';
import { visibleObstacles } from '../companion/obstacles';
import type { Mood } from '../companion/catalog';
import type { Confirmation } from './ConfirmDialog';
import CharacterVideo from './CharacterVideo';
import {requestThinking,askAi,aiStatus} from '../ai/client';
import type {NoteRecord} from '../domain/models';
import {recordTitle} from '../domain/models';
import {activityDelay,chooseAction,touchActions,autonomousActions} from '../companion/actions';
import type {CharacterAction,Motion} from '../companion/actions';
import {companionReply} from '../companion/replies';
import {useWindowVisibility} from '../companion/visibility';
export type CompanionSignal={id:number;text:string;mood?:'happy'|'pout'};

function DecisionBubble({prompt,onClose,style}:{prompt:Confirmation;onClose:()=>void;style:CSSProperties}) {
  const {t,language}=useI18n();const {character}=useCompanion();const [working,setWorking]=useState(false),[failure,setFailure]=useState('');const stay=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const previous=document.activeElement as HTMLElement|null;stay.current?.focus({preventScroll:true});return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};},[]);
  async function run(action:()=>Promise<boolean>){if(working)return;setWorking(true);setFailure('');try{if(await action())onClose();else setFailure('没存好，再试一次？');}catch{setFailure('没存好，再试一次？');}finally{setWorking(false);}}
  return <div className={`save-bubble ${style.top?'is-below':''}`} role="dialog" aria-modal="false" aria-labelledby="whale-question" style={style} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!working)onClose();}}}>
    <p id="whale-question">{prompt.title==='这条要收好吗？'?character.lines.ask[language]:t(prompt.title)}</p>{prompt.body&&<p className="bubble-detail">{t(prompt.body)}</p>}
    {failure&&<p className="bubble-failure" role="alert">{t(failure)}</p>}
    <div className="bubble-choices"><button className="bubble-save" disabled={working} onClick={()=>void run(prompt.action)}>{working?t('保存中…'):t(prompt.label==='保存并离开'?'保存':prompt.label)}</button>{prompt.alternate&&<button disabled={working} onClick={()=>void run(prompt.alternate!.action)}>{t(prompt.alternate.label==='放弃本次修改'?'丢弃':prompt.alternate.label)}</button>}<button ref={stay} disabled={working} onClick={onClose}>{t(prompt.cancelLabel==='继续编辑'?'继续写':prompt.cancelLabel??'继续写')}</button></div>
  </div>;
}
export default function FishCompanion({busy,onCreate,signal,prompt,onPromptClose,onRequestSave,onSettings,onAskNotes,record,onSource}:{record:NoteRecord|null;onSource:(record:NoteRecord)=>void;busy:boolean;onCreate:()=>void;signal?:CompanionSignal|null;prompt?:Confirmation|null;onPromptClose:()=>void;onRequestSave:()=>boolean;onSettings:()=>void;onAskNotes:()=>void}) {
  const {t,language}=useI18n();const {preferences,character,update}=useCompanion();
  const [thinking,setThinking]=useState(false);
  useEffect(()=>{const changed=(event:Event)=>{const active=(event as CustomEvent<boolean>).detail;setThinking(active);if(active){clearMotion();cancelOnline();pause();}};window.addEventListener('dafeiyu-thinking',changed);return()=>window.removeEventListener('dafeiyu-thinking',changed);},[]);
  const initial=()=>clampPoint(preferences.position??{x:32,y:innerHeight*.66},innerWidth,innerHeight,preferences.size);
  const [position,setPosition]=useState<Point>(initial),[mood,setMood]=useState<Mood>('idle'),[message,setMessage]=useState(''),[walking,setWalking]=useState(false),[held,setHeld]=useState(false),[menu,setMenu]=useState(false),[yaw,setYaw]=useState(.12),[slot,setSlot]=useState<HTMLElement|null>(null),[reducedOS,setReducedOS]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const dock=useRef<HTMLElement>(null),pos=useRef(position),destination=useRef<Point|null>(null),pointer=useRef({x:-1000,y:-1000}),drag=useRef<{id:number;start:Point;origin:Point;moved:boolean}|null>(null),ignoreClick=useRef(false),lastActivity=useRef(Date.now()),nextWalk=useRef(Date.now()+activityDelay()),manualRest=useRef(false),responseTimer=useRef<ReturnType<typeof setTimeout>|null>(null),moodTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const reduced=preferences.reduced||reducedOS,visibleWindow=useWindowVisibility();
  const [motion,setMotion]=useState<Motion|null>(null),[replySource,setReplySource]=useState<NoteRecord|null>(null);
  const motionRef=useRef<Motion|null>(null),sequence=useRef(0),recentActions=useRef<CharacterAction[]>([]),recentReplies=useRef<string[]>([]),lastSpeech=useRef(0),lastTyping=useRef(0),composing=useRef(false);
  const recordRef=useRef(record);recordRef.current=record;
  const onlineRequest=useRef<AbortController|null>(null),onlineGeneration=useRef(0),lastOnline=useRef(0),motionOrigin=useRef('touch');
  function cancelOnline(){onlineGeneration.current++;onlineRequest.current?.abort();onlineRequest.current=null;}
  function clearMotion(){motionRef.current=null;setMotion(null);}
  function playMotion(action:CharacterAction,origin='touch'){const next={id:++sequence.current,action};motionRef.current=next;motionOrigin.current=origin;setMotion(next);recentActions.current=[...recentActions.current.slice(-3),action];}
  function endMotion(id:number){if(motionRef.current?.id!==id)return;clearMotion();setMood(manualRest.current?'sleep':'idle');nextWalk.current=Date.now()+activityDelay();}
  useEffect(()=>{cancelOnline();setReplySource(null);setMessage('');},[record?.id,record?.updatedAt,preferences.onlineReplies,preferences.recordReplies]);
  useEffect(()=>{if(!visibleWindow||!preferences.visible||busy){cancelOnline();clearMotion();destination.current=null;setWalking(false);setMessage('');setReplySource(null);if(moodTimer.current)clearTimeout(moodTimer.current);setMood(manualRest.current?'sleep':'idle');}nextWalk.current=Date.now()+activityDelay();},[visibleWindow,preferences.visible,busy]);
  useEffect(()=>{const blur=()=>{cancelOnline();setMessage('');setReplySource(null);};window.addEventListener('blur',blur);return()=>{cancelOnline();window.removeEventListener('blur',blur);};},[]);
  function move(point:Point){pos.current=point;setPosition(point);}
  function pause(){destination.current=null;setWalking(false);nextWalk.current=Date.now()+activityDelay();}
  function say(text:string){if(responseTimer.current)clearTimeout(responseTimer.current);setMessage(text);responseTimer.current=setTimeout(()=>setMessage(''),2300);}
  function react(next:'happy'|'pout',text:string,action:CharacterAction='pat'){if(!visibleWindow||!preferences.visible)return;if(!reduced)playMotion(action);else clearMotion();manualRest.current=false;setMood(next);say(text);lastActivity.current=Date.now();pause();if(moodTimer.current)clearTimeout(moodTimer.current);moodTimer.current=setTimeout(()=>setMood('idle'),1600);}
  useEffect(()=>{setSlot(document.getElementById('companion-slot'));const media=matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setReducedOS(media.matches);media.addEventListener('change',changed);const resize=()=>{pause();move(clampPoint(pos.current,innerWidth,innerHeight,preferences.size));};window.addEventListener('resize',resize);return()=>{media.removeEventListener('change',changed);window.removeEventListener('resize',resize);if(responseTimer.current)clearTimeout(responseTimer.current);if(moodTimer.current)clearTimeout(moodTimer.current);};},[preferences.size]);
  useEffect(()=>{move(clampPoint(preferences.position??{x:32,y:innerHeight*.66},innerWidth,innerHeight,preferences.size));pause();},[preferences.position,preferences.size]);
  useEffect(()=>{if(prompt){pause();clearMotion();cancelOnline();setMenu(false);setMessage('');setMood('idle');}},[prompt]);
  useEffect(()=>{if(signal&&preferences.visible&&!prompt)react(signal.mood??'happy',signal.text==='收好啦。'?character.lines.saved[language]:t(signal.text));},[signal?.id]);
  useEffect(()=>{const reply=(event:Event)=>{if(!prompt&&preferences.visible)react('happy',String((event as CustomEvent<string>).detail).slice(0,90));};window.addEventListener('dafeiyu-answer',reply);return()=>window.removeEventListener('dafeiyu-answer',reply);},[prompt,preferences.visible]);
  useEffect(()=>{pause();clearMotion();cancelOnline();manualRest.current=false;setMessage('');setMood('idle');if(moodTimer.current)clearTimeout(moodTimer.current);},[preferences.character,language]);
  useEffect(()=>{
    const track=(event:globalThis.PointerEvent)=>{pointer.current={x:event.clientX,y:event.clientY};};
    const active=()=>{lastActivity.current=Date.now();if(!manualRest.current)setMood(current=>current==='sleep'?'idle':current);};
    const typing=()=>{lastTyping.current=Date.now();lastActivity.current=Date.now();pause();if(motionOrigin.current==='auto')clearMotion();};
    const composeStart=()=>{composing.current=true;typing();},composeEnd=()=>{composing.current=false;typing();};
    document.addEventListener('input',typing);document.addEventListener('compositionstart',composeStart);document.addEventListener('compositionend',composeEnd);
    window.addEventListener('pointermove',track);window.addEventListener('keydown',active);window.addEventListener('pointerdown',active);
    const timer=setInterval(()=>{
      const now=Date.now(),editing=composing.current||now-lastTyping.current<1800;
      const selecting=!!document.getSelection()?.toString();
      const near=Math.hypot(pointer.current.x-(pos.current.x+preferences.size/2),pointer.current.y-(pos.current.y+preferences.size/2))<preferences.size*.9;
      if(prompt||menu||held||busy||thinking||reduced||!preferences.visible||!preferences.wandering||!visibleWindow||!!document.querySelector('dialog[open]')||selecting||editing||near||manualRest.current){destination.current=null;setWalking(false);return;}
      if(motionRef.current){destination.current=null;setWalking(false);return;}
      if(!destination.current&&now>=nextWalk.current){
        const action=chooseAction<CharacterAction>(autonomousActions,recentActions.current);
        if(action!=='walk'){playMotion(action,'auto');nextWalk.current=now+activityDelay();return;}
        recentActions.current=[...recentActions.current.slice(-3),'walk'];
        const obstacles=visibleObstacles(dock.current);
        destination.current=nextDestination(pos.current,innerWidth,innerHeight,preferences.size,obstacles);nextWalk.current=now+activityDelay();
      }
      const target=destination.current;if(!target)return;
      const dx=target.x-pos.current.x,dy=target.y-pos.current.y,distance=Math.hypot(dx,dy);
      if(distance<3){move(target);destination.current=null;setWalking(false);nextWalk.current=Date.now()+activityDelay();return;}
      // Check the remaining segment against inputs again as layouts can change.
      const dynamicObstacles=visibleObstacles(dock.current);
      if(!clearRoute(pos.current,target,preferences.size,dynamicObstacles)){pause();return;}
      setWalking(true);setMood('idle');setYaw(dx<0?-.65:.65);move(clampPoint({x:pos.current.x+dx/distance*character.speed*.08,y:pos.current.y+dy/distance*character.speed*.08},innerWidth,innerHeight,preferences.size));
    },80);
    return()=>{clearInterval(timer);window.removeEventListener('pointermove',track);window.removeEventListener('keydown',active);window.removeEventListener('pointerdown',active);document.removeEventListener('input',typing);document.removeEventListener('compositionstart',composeStart);document.removeEventListener('compositionend',composeEnd);};
  },[preferences.wandering,preferences.visible,preferences.size,reduced,prompt,menu,held,busy,thinking,character.id,visibleWindow]);
  useEffect(()=>{if(!prompt)return;const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'&&!document.querySelector('.bubble-choices button:disabled')){event.preventDefault();onPromptClose();}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[prompt]);
  useEffect(()=>{if(!menu)return;const close=(event:globalThis.PointerEvent)=>{if(!dock.current?.contains(event.target as Node))setMenu(false);};window.addEventListener('pointerdown',close);return()=>window.removeEventListener('pointerdown',close);},[menu]);
  useEffect(()=>{
    let scheduled=0;
    const avoid=()=>{scheduled=0;if(prompt||menu||held||!preferences.visible||(!preferences.wandering&&preferences.position)||document.querySelector('dialog[open]'))return;
      const obstacles=visibleObstacles(dock.current);if(clearRoute(pos.current,pos.current,preferences.size,obstacles))return;
      const right=innerWidth-preferences.size-12,bottom=innerHeight-preferences.size-8;
      const candidates=[...(innerWidth<=800?[{x:right,y:64}]:[]),{x:8,y:bottom},{x:8,y:innerHeight*.78},{x:right,y:bottom},{x:8,y:innerHeight*.66},{x:right,y:innerHeight*.66},{x:8,y:140},{x:right,y:140}];
      for(const candidate of [...candidates,...edgeSpots(innerWidth,innerHeight,preferences.size)]){const point=clampPoint(candidate,innerWidth,innerHeight,preferences.size);if(clearRoute(point,point,preferences.size,obstacles)){pause();move(point);break;}}
    };
    const queue=()=>{if(!scheduled)scheduled=requestAnimationFrame(avoid);};queue();
    const observer=new MutationObserver(queue),main=document.querySelector('.app-shell');if(main)observer.observe(main,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['hidden','aria-selected']});
    window.addEventListener('resize',queue);window.addEventListener('scroll',queue,true);
    return()=>{observer.disconnect();cancelAnimationFrame(scheduled);window.removeEventListener('resize',queue);window.removeEventListener('scroll',queue,true);};
  },[preferences.size,preferences.visible,preferences.wandering,preferences.position,prompt,menu,held]);
  useEffect(()=>{const avoid=()=>{const input=document.activeElement;if(!(input instanceof HTMLInputElement||input instanceof HTMLTextAreaElement||input instanceof HTMLSelectElement||input instanceof HTMLElement&&input.isContentEditable))return;const rect=input.getBoundingClientRect();if(clearRoute(pos.current,pos.current,preferences.size,[rect]))return;pause();const obstacles=visibleObstacles(dock.current);for(const point of [...(innerWidth<=800?[{x:innerWidth-preferences.size-12,y:64}]:[]),{x:8,y:innerHeight-preferences.size-8},{x:innerWidth-preferences.size-8,y:innerHeight-preferences.size-8},{x:8,y:140},...edgeSpots(innerWidth,innerHeight,preferences.size)]){if(clearRoute(point,point,preferences.size,obstacles)){move(point);break;}}};document.addEventListener('focusin',avoid);return()=>document.removeEventListener('focusin',avoid);},[preferences.size]);
  function down(event:PointerEvent<HTMLButtonElement>){if(prompt||busy||(event.pointerType==='mouse'&&event.button!==0))return;pause();drag.current={id:event.pointerId,start:{x:event.clientX,y:event.clientY},origin:pos.current,moved:false};ignoreClick.current=false;event.currentTarget.setPointerCapture(event.pointerId);setHeld(true);}
  function movePointer(event:PointerEvent<HTMLButtonElement>){const gesture=drag.current;if(gesture&&gesture.id===event.pointerId){const dx=event.clientX-gesture.start.x,dy=event.clientY-gesture.start.y;if(Math.hypot(dx,dy)>6)gesture.moved=true;if(gesture.moved)move(clampPoint({x:gesture.origin.x+dx,y:gesture.origin.y+dy},innerWidth,innerHeight,preferences.size));}}
  function finish(event:PointerEvent<HTMLButtonElement>,cancelled=false){const gesture=drag.current;if(!gesture||gesture.id!==event.pointerId)return;ignoreClick.current=gesture.moved||cancelled;drag.current=null;setHeld(false);if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);if(gesture.moved&&!cancelled){update({position:pos.current,wandering:false});say('换个位置。');}}
  async function onlineReply(source:NoteRecord){
    if(Date.now()-lastOnline.current<30000||!preferences.onlineReplies||!preferences.recordReplies)return;
    const controller=new AbortController(),token=++onlineGeneration.current;onlineRequest.current=controller;lastOnline.current=Date.now();
    try {
      const status=await aiStatus();if(controller.signal.aborted||!status.configured)return;
      let end=Math.min(1500,source.body.length);if(end<source.body.length&&/[\uD800-\uDBFF]/.test(source.body[end-1]))end--;
      const response=await askAi({id:crypto.randomUUID(),question:language==='en'?'The user just tapped you. Reply as Dafeiyu with one short, friendly sentence connected to the supplied saved note. No analysis, action list, or follow-up question.':'用户刚轻轻点了你一下。以安静、有一点俏皮的大肥鱼身份，结合提供的已保存记录，用一句简短自然的话回应，不分析、不列清单、不追问。',context:'',sources:[{recordId:source.id,revision:source.updatedAt,reference:1,title:recordTitle(source),date:source.createdAt,body:source.body.slice(0,end),start:0,end}],language,signal:controller.signal});
      if(controller.signal.aborted||onlineGeneration.current!==token||document.querySelector('dialog[open],.companion-menu')||recordRef.current?.id!==source.id||recordRef.current.updatedAt!==source.updatedAt)return;
      const text=Array.from(response.answer.replace(/\[\d+\]/g,'')).slice(0,100).join('');
      say(text);setReplySource(response.citations.includes(1)?source:null);recentReplies.current=[...recentReplies.current.slice(-3),text];
    }catch{/* Local feedback is already visible; an optional online failure stays quiet. */}
    finally{if(onlineGeneration.current===token)onlineRequest.current=null;}
  }
  function touch(event:MouseEvent<HTMLButtonElement>){
    if(ignoreClick.current){ignoreClick.current=false;return;}if(prompt)return;pause();cancelOnline();
    const action=chooseAction<CharacterAction>(touchActions,recentActions.current);
    if(mood==='sleep'){manualRest.current=false;react('happy',character.lines.wake[language],action);return;}
    const y=event.detail===0?.2:(event.clientY-event.currentTarget.getBoundingClientRect().top)/preferences.size;
    if(Date.now()-lastSpeech.current<5000){react(y>.34&&y<.6?'pout':'happy','',action);return;}
    const source=preferences.recordReplies?recordRef.current:null,result=companionReply(source,language,recentReplies.current);
    recentReplies.current=[...recentReplies.current.slice(-3),result.text];lastSpeech.current=Date.now();
    react(y>.34&&y<.6?'pout':'happy',result.text,action);setReplySource(result.source?source:null);
    if(source&&preferences.onlineReplies)void onlineReply(source);
  }
  function rest(){setMenu(false);pause();clearMotion();cancelOnline();if(moodTimer.current)clearTimeout(moodTimer.current);if(mood==='sleep')react('happy',character.lines.wake[language]);else{manualRest.current=true;setMood('sleep');setMessage('');}}
  const bubbleWidth=Math.min(290,innerWidth-20),bubbleLeft=Math.max(8-position.x,Math.min(0,innerWidth-position.x-bubbleWidth-8)),below=position.y<185;
  const bubbleStyle:CSSProperties & {'--tail-x':string}={width:bubbleWidth,left:bubbleLeft,...(below?{top:'calc(100% + 8px)'}:{bottom:'calc(100% + 8px)'}),'--tail-x':`${Math.max(15,Math.min(bubbleWidth-20,-bubbleLeft+preferences.size/2))}px`};
  if(!preferences.visible){const launcher=<button className="icon-button companion-restore" aria-label={t('显示大肥鱼')} title={t('显示大肥鱼')} onClick={()=>update({visible:true})}><Eye size={17}/></button>;return slot?createPortal(launcher,slot):launcher;}
  return <aside ref={dock} className={`companion-dock pixel-companion ${prompt?'has-prompt':''} ${held?'is-held':''}`} aria-label={t('小肥鱼陪伴')} data-character={preferences.character} data-mood={mood} data-walking={walking} data-renderer="video" style={{left:position.x,top:position.y,width:preferences.size,height:preferences.size,'--whale-size':`${preferences.size}px`} as CSSProperties}>
    {prompt?<DecisionBubble prompt={prompt} onClose={onPromptClose} style={bubbleStyle}/>:message?<p className="companion-bubble is-visible pixel-response" aria-live="polite" aria-atomic="true" style={bubbleStyle}>{t(message)}{replySource&&<button className="companion-source-link" onClick={()=>onSource(replySource)}>{t('查看原文')}</button>}</p>:null}
    <button className="companion-character" aria-label={t(mood==='sleep'?'唤醒小肥鱼（可拖动）':'摸摸小肥鱼（可拖动）')} disabled={busy||!!prompt} onPointerDown={down} onPointerMove={movePointer} onPointerUp={event=>finish(event)} onPointerCancel={event=>finish(event,true)} onLostPointerCapture={()=>{drag.current=null;setHeld(false);}} onClick={touch} onContextMenu={event=>{event.preventDefault();if(!prompt){pause();setMenu(current=>!current);}}} onKeyDown={event=>{if(event.key.startsWith('Arrow')){event.preventDefault();const delta={ArrowLeft:[-12,0],ArrowRight:[12,0],ArrowUp:[0,-12],ArrowDown:[0,12]}[event.key];if(delta){pause();const point=clampPoint({x:pos.current.x+delta[0],y:pos.current.y+delta[1]},innerWidth,innerHeight,preferences.size);move(point);update({position:point,wandering:false});}}}}>
      <CharacterVideo motion={motion} visible={visibleWindow} onActionEnd={endMotion} mood={mood} walking={walking&&!held&&!prompt} direction={yaw<0?'left':'right'} held={held} reduced={reduced} thinking={thinking}/>
    </button>
    {menu&&!prompt&&<div className="companion-menu" role="menu" style={bubbleStyle} onKeyDown={event=>{if(event.key==='Escape')setMenu(false);}}>
      <button role="menuitem" onClick={()=>{setMenu(false);onCreate();}}>{t('写一条记录')}</button>
      <button role="menuitem" onClick={()=>{setMenu(false);if(!onRequestSave())say(t('已保存在本地'));}}>{t('保存记录')}</button>
      <button role="menuitem" onClick={()=>{setMenu(false);onAskNotes();}}>{t('笺间对话')}</button>
      <button role="menuitem" onClick={()=>{setMenu(false);requestThinking(document.getSelection()?.toString()??'');}}>{t('聊聊')}</button>
      <button role="menuitem" onClick={()=>{update({wandering:!preferences.wandering,position:pos.current});setMenu(false);}}>{t(preferences.wandering?'待在这里':'自由活动')}</button>
      <button role="menuitem" onClick={rest}>{t(mood==='sleep'?'唤醒':'休息')}</button>
      <button role="menuitem" onClick={()=>{setMenu(false);onSettings();}}>{t('设置')}</button>
      <button role="menuitem" onClick={()=>{setMenu(false);update({visible:false});}}>{t('隐藏角色')}</button>
    </div>}
  </aside>;
}
