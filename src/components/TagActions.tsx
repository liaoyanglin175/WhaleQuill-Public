import {useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {MoreHorizontal,X} from 'lucide-react';
import {useI18n} from '../i18n';

export default function TagActions({tag,disabled,onChange}:{tag:string;disabled:boolean;onChange:(tag:string,next:string|null)=>string|null}){
  const {t}=useI18n();const [open,setOpen]=useState(false),[name,setName]=useState(tag),[error,setError]=useState(''),[point,setPoint]=useState({x:8,y:8});
  const trigger=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null),restore=useRef(true);
  function close(focus=true){restore.current=focus;setOpen(false);}
  useEffect(()=>{
    if(!open)return;
    const position=()=>{const rect=trigger.current?.getBoundingClientRect();if(!rect)return;const width=panel.current?.offsetWidth??270,height=panel.current?.offsetHeight??210;setPoint({x:Math.max(8,Math.min(rect.right-width,innerWidth-width-8)),y:Math.max(8,Math.min(rect.bottom+6,innerHeight-height-8))});};
    const outside=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))close();};
    position();panel.current?.querySelector('input')?.focus({preventScroll:true});document.addEventListener('pointerdown',outside);window.addEventListener('resize',position);window.addEventListener('scroll',position,true);
    return()=>{document.removeEventListener('pointerdown',outside);window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true);if(restore.current)requestAnimationFrame(()=>{if(trigger.current?.isConnected)trigger.current.focus({preventScroll:true});});};
  },[open]);
  function change(next:string|null){const problem=onChange(tag,next);if(problem)setError(problem);else close(false);}
  return <><button ref={trigger} className="tag-actions-trigger" type="button" aria-label={t('管理标签：{0}',tag)} aria-expanded={open} disabled={disabled} onClick={()=>{setName(tag);setError('');restore.current=true;setOpen(!open);}}><MoreHorizontal size={13}/></button>{open&&createPortal(<div ref={panel} className="tag-actions-panel" role="dialog" aria-label={t('管理标签：{0}',tag)} style={{left:point.x,top:point.y}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}}}>
    <header><span>{t('仅修改本条记录')}</span><button className="icon-button" aria-label={t('关闭标签菜单')} onClick={()=>close()}><X size={15}/></button></header>
    <form onSubmit={event=>{event.preventDefault();change(name);}}><label>{t('标签名称')}<input value={name} maxLength={80} disabled={disabled} onChange={event=>setName(event.target.value)} /></label>{error&&<p role="alert">{t(error)}</p>}<div><button type="button" className="text-button" disabled={disabled} onClick={()=>change(null)}>{t('取消此标签')}</button><button className="button primary" disabled={disabled||!name.trim()}>{t('更名')}</button></div></form>
  </div>,document.body)}</>;
}
