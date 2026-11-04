import {useEffect,useRef,useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import type {BackupWork} from '../components/BackupProgress';
import type {BackupProgress} from '../domain/stream-backup';
export function useBackupWork(){
 const [work,setWork]=useState<BackupWork|null>(null),active=useRef<{token:string;controller:AbortController}|null>(null);
 function cancel(){const current=active.current;if(!current)return;current.controller.abort();setWork(previous=>previous?{...previous,cancelled:true}:previous);if(isTauri())void invoke('cancel_complete_backup',{token:current.token}).catch(()=>{});}
 useEffect(()=>()=>{const current=active.current;current?.controller.abort();if(current&&isTauri())void invoke('cancel_complete_backup',{token:current.token}).catch(()=>{});},[]);
 async function run<T>(mode:'export'|'import',action:(token:string,signal:AbortSignal,progress:(p:BackupProgress)=>void)=>Promise<T>):Promise<T|null>{
  if(active.current)throw Error('另一个备份操作尚未结束。');const current={token:crypto.randomUUID(),controller:new AbortController()};active.current=current;setWork({token:current.token,mode,done:0,total:0,bytes:0,cancelled:false});let stop:(()=>void)|undefined;
  const progress=(p:BackupProgress)=>setWork(previous=>previous?.token===current.token?{...previous,...p}:previous);
  try{if(isTauri())stop=await listen<BackupProgress&{token:string}>('backup-progress',event=>{if(event.payload.token===current.token)progress(event.payload);});if(current.controller.signal.aborted)return null;const result=await action(current.token,current.controller.signal,progress);return current.controller.signal.aborted?null:result;}
  catch(error){if(current.controller.signal.aborted)return null;throw error;}finally{stop?.();if(active.current===current){active.current=null;setWork(null);}}
 }
 return {work,run,cancel};
}
