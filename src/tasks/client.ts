import {invoke,isTauri} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {taskSchema} from '../domain/models';
import type {Task} from '../domain/models';
import {getRepository} from '../storage/repository';
import {cleanupEnabled} from '../domain/planner';
export type StripPreferences={enabled:boolean;pinned:boolean;language:'zh'|'en';position:[number,number]|null;cleanupEnabled:boolean;remindersEnabled:boolean};
export const defaultStripPreferences:StripPreferences={enabled:true,pinned:false,language:'zh',position:null,cleanupEnabled:true,remindersEnabled:true};
export async function stripTasks():Promise<Task[]> {
  return isTauri()?taskSchema.array().parse(await invoke('load_strip_tasks')):(await (await getRepository()).load()).tasks;
}
export const stripPreferences=():Promise<StripPreferences>=>isTauri()?invoke('task_strip_preferences'):Promise.resolve({...defaultStripPreferences,cleanupEnabled:cleanupEnabled(),language:localStorage.getItem('dafeiyu-language')==='en'?'en':'zh'});
export const updateStrip=(patch:Partial<StripPreferences>&{reset?:boolean}):Promise<StripPreferences>=>invoke('update_task_strip',patch);
export async function setTaskStatus(task:Task):Promise<void> {
  const status=task.status==='todo'?'done':'todo';
  if(isTauri())await invoke('set_task_status',{id:task.id,status,expectedStatus:task.status});
  else await (await getRepository()).saveTask({...task,status,updatedAt:new Date().toISOString()},task.updatedAt);
}
export async function subscribeStrip(callback:()=>void,opened:()=>void):Promise<()=>void> {
  if(!isTauri())return ()=>{};
  const stops=await Promise.all([listen('tasks-changed',callback),listen('task-strip-settings',callback),listen('task-strip-opened',opened),listen('task-reminder',callback)]);
  return ()=>stops.forEach(stop=>stop());
}
