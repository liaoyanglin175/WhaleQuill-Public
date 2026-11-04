import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {Minus,Square,Copy,X} from 'lucide-react';
import {useI18n} from '../i18n';

export function windowDrag(event:React.MouseEvent<HTMLElement>){
 if(!isTauri()||event.button!==0||(event.target as Element).closest('button,input,select,textarea,a,summary'))return;
 const window=getCurrentWindow();void (event.detail===2?window.toggleMaximize():window.startDragging()).catch(()=>{});
}
export default function WindowControls(){
 const {t}=useI18n(),[maximized,setMaximized]=useState(false),[error,setError]=useState('');
 useEffect(()=>{if(!isTauri())return;const window=getCurrentWindow();let disposed=false,stop:(()=>void)|undefined;
  const update=()=>void window.isMaximized().then(value=>{if(!disposed)setMaximized(value);});update();void window.onResized(update).then(unlisten=>{if(disposed)unlisten();else stop=unlisten;});return()=>{disposed=true;stop?.();};
 },[]);
 if(!isTauri())return null;
 async function act(action:()=>Promise<void>){setError('');try{await action();}catch{setError(t('窗口操作未完成，请重试。'));}}
 return <><div className="window-controls" role="group" aria-label={t('窗口控制')} data-floating-avoid>
  <button aria-label={t('最小化窗口')} title={t('最小化窗口')} onClick={()=>void act(()=>getCurrentWindow().minimize())}><Minus size={16}/></button>
  <button aria-label={t(maximized?'还原窗口':'最大化窗口')} title={t(maximized?'还原窗口':'最大化窗口')} onClick={()=>void act(()=>getCurrentWindow().toggleMaximize())}>{maximized?<Copy size={14}/>:<Square size={14}/>}</button>
  <button className="window-close" aria-label={t('关闭主窗口')} title={t('关闭主窗口')} onClick={()=>void act(()=>getCurrentWindow().close())}><X size={17}/></button>
 </div>{error&&<p className="window-control-error" role="alert">{error}</p>}</>;
}
