import {localDay} from '../domain/resurfacing';
import type {MemoryPreferences} from '../domain/resurfacing';
const key='dafeiyu-memory-cues-v1';
export function readMemoryPreferences(now=new Date()):MemoryPreferences{
 const day=localDay(now),defaults:MemoryPreferences={day,frequency:'daily',selected:'',dismissed:[],shown:{},hiddenToday:false};
 try{const value=JSON.parse(localStorage.getItem(key)??'{}');return {...defaults,frequency:value.disabled===true?'off':['daily','quiet','off'].includes(value.frequency)?value.frequency:'daily',selected:value.day===day&&typeof value.selected==='string'?value.selected:'',dismissed:value.day===day&&Array.isArray(value.dismissed)?value.dismissed.filter((id:unknown)=>typeof id==='string').slice(0,500):[],hiddenToday:value.day===day&&value.hiddenToday===true,shown:typeof value.shown==='object'&&value.shown?Object.fromEntries(Object.entries(value.shown).filter(([id,date])=>id.length<100&&typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date))).sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).slice(-500)) as Record<string,string>:{}};}catch{return defaults;}
}
export function updateMemoryPreferences(patch:Partial<MemoryPreferences>):MemoryPreferences{
 const next={...readMemoryPreferences(),...patch};try{localStorage.setItem(key,JSON.stringify({...next,disabled:next.frequency==='off'}));}catch{/* Display preferences do not commit notes. */}
 window.dispatchEvent(new CustomEvent('dafeiyu-memory-setting',{detail:next}));return next;
}
