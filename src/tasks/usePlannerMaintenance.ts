import {useEffect} from 'react';
import type {Dispatch,SetStateAction} from 'react';
import type {NotebookRepository} from '../storage/repository';
import type {Workspace,TrashEntry} from '../domain/models';
import {plannerDay} from '../domain/planner';
export function usePlannerMaintenance(repository:NotebookRepository|undefined,setWorkspace:Dispatch<SetStateAction<Workspace>>,setTrash:Dispatch<SetStateAction<TrashEntry[]>>){
 useEffect(()=>{
  if(!repository)return;let disposed=false,running=false,lastDay='';
  const refresh=async(force=false)=>{if(running||!force&&plannerDay()===lastDay)return;running=true;try{await repository.maintainTasks();const [data,trash]=await Promise.all([repository.load(),repository.loadTrash()]);if(!disposed){setWorkspace(current=>({...current,tasks:data.tasks}));setTrash(trash);lastDay=plannerDay();}}catch{if(!disposed)window.dispatchEvent(new CustomEvent('jingjian-planner-error',{detail:'待办清理未完成，原内容已保留。'}));}finally{running=false;}};
  void refresh(true);const setting=()=>void refresh(true),visible=()=>{if(document.visibilityState==='visible')void refresh();};
  const timer=setInterval(()=>void refresh(),30_000);window.addEventListener('jingjian-cleanup-setting',setting);window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
  return()=>{disposed=true;clearInterval(timer);window.removeEventListener('jingjian-cleanup-setting',setting);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
 },[repository,setWorkspace,setTrash]);
}
