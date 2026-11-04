import {useEffect} from 'react';
import {listen} from '@tauri-apps/api/event';
import type {Dispatch,SetStateAction} from 'react';
import type {Language} from '../i18n';
import type {Workspace,TrashEntry} from '../domain/models';
import {getRepository} from '../storage/repository';
import {stripTasks,updateStrip} from './client';
export function useTaskSync(desktop:boolean,language:Language,setWorkspace:Dispatch<SetStateAction<Workspace>>,setTrash:Dispatch<SetStateAction<TrashEntry[]>>){
  useEffect(()=>{
    if(!desktop)return;
    let disposed=false,sequence=0;const stops:(()=>void)[]=[];
    const refresh=async()=>{const request=++sequence;try{const [tasks,trash]=await Promise.all([stripTasks(),getRepository().then(repo=>repo.loadTrash())]);if(!disposed&&request===sequence){setWorkspace(current=>({...current,tasks}));setTrash(trash);}}catch{/* Never replace rows with empty data on failure. */}};
    void listen('tasks-changed',()=>void refresh()).then(stop=>{if(disposed)stop();else{stops.push(stop);void refresh();}});
    void updateStrip({language}).catch(()=>{});
    return()=>{disposed=true;sequence++;stops.forEach(stop=>stop());};
  },[desktop,language,setWorkspace,setTrash]);
}
