import {useCallback,useEffect,useRef,useState} from 'react';
import type {RefObject} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

type DockInfo={side:'left'|'right'|null;folded:boolean};
export default function useStripDocking(root:RefObject<HTMLElement|null>,busy:boolean){
 const [dock,setDock]=useState<DockInfo>({side:null,folded:false}),inside=useRef(false),interacting=useRef(false),keyboard=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|null>(null),alive=useRef(true);
 const cancel=useCallback(()=>{if(timer.current)clearTimeout(timer.current);timer.current=null;},[]);
 const fold=useCallback(async(value:boolean)=>{if(!isTauri())return;try{const result=await invoke<DockInfo>('fold_task_strip',{folded:value});if(alive.current)setDock(result);}catch{/* Keep the visible window usable if the display changes. */}},[]);
 const schedule=useCallback(()=>{cancel();if(!isTauri()||!dock.side||dock.folded||busy||inside.current||interacting.current||keyboard.current)return;
  timer.current=setTimeout(()=>{timer.current=null;if(!inside.current&&!interacting.current&&!keyboard.current&&!root.current?.querySelector('details[open]'))void fold(true);},1000);
 },[dock,busy,cancel,fold,root]);
 useEffect(()=>{alive.current=true;if(!isTauri())return;let stop:(()=>void)|undefined;
  const update=(value:DockInfo)=>{if(alive.current){interacting.current=false;setDock(value);}};
  void invoke<DockInfo>('task_strip_dock').then(update).catch(()=>{});void listen<DockInfo>('task-strip-dock',event=>update(event.payload)).then(unlisten=>{if(alive.current)stop=unlisten;else unlisten();});return()=>{alive.current=false;stop?.();cancel();};
 },[cancel]);
 useEffect(()=>{schedule();return cancel;},[schedule,cancel]);
 return {dock,fold,events:{
  onPointerEnter(){inside.current=true;cancel();},
  onPointerLeave(){inside.current=false;schedule();},
  onPointerDownCapture(){interacting.current=true;keyboard.current=false;cancel();},
  onPointerUpCapture(){interacting.current=false;schedule();},
  onPointerCancel(){interacting.current=false;schedule();},
  onKeyDownCapture(){keyboard.current=true;cancel();},
  onBlurCapture(event:React.FocusEvent<HTMLElement>){if(!root.current?.contains(event.relatedTarget as Node|null)){keyboard.current=false;interacting.current=false;schedule();}},
 }};
}
