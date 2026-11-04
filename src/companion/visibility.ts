import {useEffect,useState} from 'react';
import {isTauri} from '@tauri-apps/api/core';

export function useWindowVisibility(){
  const [documentVisible,setDocumentVisible]=useState(()=>!document.hidden),[minimized,setMinimized]=useState(false);
  useEffect(()=>{
    let alive=true,revision=0;const cleanup:(()=>void)[]=[];
    const changed=()=>setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange',changed);
    if(isTauri())void import('@tauri-apps/api/window').then(async({getCurrentWindow})=>{
      const window=getCurrentWindow();
      const refresh=()=>{const token=++revision;void window.isMinimized().then(value=>{if(alive&&revision===token)setMinimized(value);}).catch(()=>{});};
      const listeners=await Promise.all([window.onResized(refresh),window.onFocusChanged(refresh)]);
      if(!alive)listeners.forEach(stop=>stop());else{
        cleanup.push(...listeners);refresh();
        // Windows can minimize an already unfocused window without another
        // focus/resize notification reaching WebView. Reconcile native state.
        const timer=setInterval(refresh,1000);cleanup.push(()=>clearInterval(timer));
      }
    }).catch(()=>{});
    return()=>{alive=false;revision++;cleanup.forEach(stop=>stop());document.removeEventListener('visibilitychange',changed);};
  },[]);
  return documentVisible&&!minimized;
}
