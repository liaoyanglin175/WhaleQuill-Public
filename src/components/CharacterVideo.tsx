import {useEffect,useRef,useState} from 'react';
import type {Mood} from '../companion/catalog';
import type {CharacterAction,Motion} from '../companion/actions';

type Pending={slot:number;action:CharacterAction;token:number;motionId:number;preparing?:boolean};
const loops=new Set<CharacterAction>(['idle','walk','drag','think','sleep']);
export default function CharacterVideo({mood,walking,held,reduced,thinking=false,direction,visible=true,motion,onActionEnd}:{mood:Mood;walking:boolean;held:boolean;reduced:boolean;thinking?:boolean;direction:'left'|'right';visible?:boolean;motion?:Motion|null;onActionEnd?:(id:number)=>void}) {
  const desired:CharacterAction=reduced?'idle':held?'drag':thinking?'think':walking?'walk':motion?.action??(mood==='sleep'?'sleep':'idle');
  const [clips,setClips]=useState<(CharacterAction|null)[]>(['idle',null]),[shown,setShown]=useState(0),[loaded,setLoaded]=useState(false);
  const videos=useRef<(HTMLVideoElement|null)[]>([]),current=useRef(0),generation=useRef(0),booted=useRef(false);
  const pending=useRef<Pending|null>({slot:0,action:'idle',token:0,motionId:0}),playing=useRef({action:'idle' as CharacterAction,motionId:0});
  const state=useRef({visible,reduced,desired,motionId:motion?.id??0});state.current={visible,reduced,desired,motionId:motion?.id??0};
  const finish=useRef(onActionEnd);finish.current=onActionEnd;
  const frame=useRef<{video:HTMLVideoElement;id:number}|null>(null);
  function cancelFrame(){if(frame.current){frame.current.video.cancelVideoFrameCallback?.(frame.current.id);frame.current=null;}}
  function ready(slot:number,action:CharacterAction){
    const request=pending.current,video=videos.current[slot];
    if(!request||request.slot!==slot||request.action!==action||request.token!==generation.current||!video||video.readyState<2)return;
    const token=request.token;
    const commit=()=>{
      if(pending.current?.token!==token||generation.current!==token)return;
      const old=current.current;if(old!==slot)videos.current[old]?.pause();
      current.current=slot;playing.current={action,motionId:request.motionId};pending.current=null;booted.current=true;
      setShown(slot);setLoaded(true);
    };
    if(!state.current.visible){if(!booted.current)commit();return;}
    if(state.current.reduced){video.pause();commit();return;}
    if(request.preparing)return;request.preparing=true;cancelFrame();
    void video.play().then(()=>{
      if(generation.current!==token){video.pause();return;}
      if(typeof video.requestVideoFrameCallback==='function')frame.current={video,id:video.requestVideoFrameCallback(()=>{frame.current=null;commit();})};else requestAnimationFrame(commit);
    }).catch(()=>{if(video.readyState>=2)commit();});
  }
  useEffect(()=>{
    if(!visible){generation.current++;pending.current=booted.current?null:{slot:0,action:'idle',token:generation.current,motionId:0};cancelFrame();videos.current.forEach(video=>video?.pause());if(!booted.current)ready(0,'idle');return;}
    const motionId=motion?.id??0;
    if(booted.current&&playing.current.action===desired&&playing.current.motionId===motionId){if(!reduced)void videos.current[current.current]?.play().catch(()=>{});else videos.current[current.current]?.pause();return;}
    const slot=booted.current?1-current.current:0,token=++generation.current;
    pending.current={slot,action:desired,token,motionId};
    setClips(previous=>previous.map((clip,index)=>index===slot?desired:clip));
  },[desired,motion?.id,visible,reduced]);
  useEffect(()=>{
    const request=pending.current;
    if(request&&clips[request.slot]===request.action)ready(request.slot,request.action);
  },[clips,visible,reduced]);
  useEffect(()=>()=>{generation.current++;cancelFrame();videos.current.forEach(video=>video?.pause());},[]);
  return <span className="character-video" aria-hidden="true" data-loaded={loaded} data-action={playing.current.action} data-requested={desired} data-paused={!visible||reduced} style={{transform:direction==='left'?'scaleX(-1)':undefined}}>
    {!loaded&&<img src="/mascot/dafeiyu/poster.png" alt=""/>}
    {clips.map((clip,index)=><video ref={element=>{videos.current[index]=element;}} key={index} src={clip?`/mascot/dafeiyu/${clip}.webm`:undefined} poster="/mascot/dafeiyu/poster.png" muted playsInline preload="auto" loop={!!clip&&loops.has(clip)&&motion?.action!==clip} onLoadedData={()=>{if(clip)ready(index,clip);}} onEnded={()=>{if(current.current===index&&playing.current.motionId)finish.current?.(playing.current.motionId);}} onTimeUpdate={event=>{const root=event.currentTarget.parentElement;if(current.current===index&&root)root.dataset.time=event.currentTarget.currentTime.toFixed(2);}} style={{opacity:loaded&&shown===index?1:0,transition:shown===index?'none':'opacity 120ms linear'}}/>)}
  </span>;
}
