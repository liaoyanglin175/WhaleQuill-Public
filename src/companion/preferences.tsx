import {createContext,useContext,useState} from 'react';
import type {ReactNode} from 'react';
import {getCharacter} from './catalog';
export type Point={x:number;y:number};
export type CompanionPreferences={character:'lanxi';outfit:'dress';wandering:boolean;visible:boolean;reduced:boolean;size:number;position:Point|null;recordReplies:boolean;onlineReplies:boolean};
export const companionKey='dafeiyu-companion-v3';
const defaults:CompanionPreferences={character:'lanxi',outfit:'dress',wandering:true,visible:true,reduced:false,size:56,position:null,recordReplies:true,onlineReplies:false};
export function readCompanion():CompanionPreferences {
  try{
    const value=JSON.parse(localStorage.getItem(companionKey)??'{}');
    return {...defaults,recordReplies:value?.recordReplies!==false,onlineReplies:value?.onlineReplies===true,wandering:value?.wandering!==false,visible:value?.visible!==false,reduced:value?.reduced===true,size:Number.isFinite(value?.size)?Math.max(40,Math.min(72,value.size)):56,position:value?.position&&Number.isFinite(value.position.x)&&Number.isFinite(value.position.y)?value.position:null};
  }catch{return {...defaults};}
}
const Context=createContext({preferences:defaults,outfit:'dress' as const,character:getCharacter('lanxi'),update:(_patch:Partial<CompanionPreferences>)=>{}});
export function CompanionProvider({children}:{children:ReactNode}) {
  const [preferences,setPreferences]=useState(readCompanion);
  function update(patch:Partial<CompanionPreferences>){setPreferences(current=>{
    const next={...current,...patch,character:'lanxi' as const,outfit:'dress' as const};
    try{localStorage.setItem(companionKey,JSON.stringify(next));}catch{/* Appearance never changes notes. */}
    return next;
  });}
  return <Context.Provider value={{preferences,outfit:'dress',character:getCharacter('lanxi'),update}}>{children}</Context.Provider>;
}
export const useCompanion=()=>useContext(Context);
