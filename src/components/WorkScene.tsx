import {useEffect,useRef,useState} from 'react';
import {useCompanion} from '../companion/preferences';
import {useWindowVisibility} from '../companion/visibility';
import {useI18n} from '../i18n';
export default function WorkScene(){
 const video=useRef<HTMLVideoElement>(null),{preferences}=useCompanion(),visible=useWindowVisibility(),{t}=useI18n(),[systemReduced,setSystemReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
 const reduced=preferences.reduced||systemReduced;
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)'),changed=()=>setSystemReduced(media.matches);media.addEventListener('change',changed);return()=>media.removeEventListener('change',changed);},[]);
 useEffect(()=>{if(!preferences.visible)return;document.documentElement.dataset.quillWorking='true';return()=>{delete document.documentElement.dataset.quillWorking;};},[preferences.visible]);
 useEffect(()=>{if(visible&&!reduced&&preferences.visible)void video.current?.play().catch(()=>{});else video.current?.pause();},[visible,reduced,preferences.visible]);
 if(!preferences.visible)return null;
 return <figure className="quill-work-scene"><video ref={video} src="/mascot/dafeiyu/writing.webm" loop muted playsInline preload="auto" aria-label={t('大肥鱼正在整理草案')} onLoadedData={()=>{if(visible&&!reduced)void video.current?.play().catch(()=>{});}}/><figcaption>{t('正在整理草案…')}</figcaption></figure>;
}
