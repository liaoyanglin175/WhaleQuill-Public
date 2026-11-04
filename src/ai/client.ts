import {invoke,isTauri} from '@tauri-apps/api/core';
import type {ConversationTurn,MemoryAnswer,MemorySource} from '../domain/memory-context';
export const desktopAi=()=>isTauri();
export const aiStatus=()=>desktopAi()?invoke<{configured:boolean;supported:boolean}>('ai_status'):Promise.resolve({configured:false,supported:false});
export const saveAiKey=(key:string)=>invoke<void>('ai_save_key',{key});
export const deleteAiKey=()=>invoke<void>('ai_delete_key');
export const cancelAi=(id:string)=>invoke<void>('ai_cancel',{id}).catch(()=>{});
export async function askAi({id,question,context,sources,conversation=[],language,signal,allowCreation=false}:{id:string;question:string;context:string;sources:MemorySource[];conversation?:ConversationTurn[];language:'zh'|'en';signal:AbortSignal;allowCreation?:boolean}):Promise<MemoryAnswer>{
  if(!desktopAi())throw new Error('AI 在 Windows 桌面版中使用。');
  if(signal.aborted)throw new Error('已停止思考。');
  const cancel=()=>{void cancelAi(id);};signal.addEventListener('abort',cancel,{once:true});
  try{
    const answer=await invoke<MemoryAnswer>('ai_ask',{inquiry:{id,question,context,sources:sources.map(({reference,title,date,body})=>({reference,title,date,body})),conversation,language,allowCreation}});
    if(signal.aborted)throw new Error('已停止思考。');return answer;
  }finally{signal.removeEventListener('abort',cancel);}
}
export function requestThinking(text=''){window.dispatchEvent(new CustomEvent('dafeiyu-think',{detail:{text:Array.from(text).slice(0,2000).join('')}}));}
