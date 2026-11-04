import {useEffect,useRef,useState} from 'react';
import {useI18n} from '../i18n';
export default function TagNameDialog({suggestion,onConfirm,onClose}:{suggestion:string;onConfirm:(name:string)=>string|null;onClose:()=>void}){
  const {t}=useI18n(),dialog=useRef<HTMLDialogElement>(null),[name,setName]=useState(suggestion),[error,setError]=useState('');
  useEffect(()=>{dialog.current?.showModal();dialog.current?.querySelector('input')?.select();},[]);
  return <dialog ref={dialog} className="confirm-dialog tag-name-dialog" aria-labelledby="tag-name-title" onCancel={event=>{event.preventDefault();onClose();}}>
    <h2 id="tag-name-title">{t('关联标签')}</h2><p>{t('给这段内容一个简短标签，正文保持原样。')}</p>
    <form onSubmit={event=>{event.preventDefault();const message=onConfirm(name);if(message)setError(message);else onClose();}}>
      <label htmlFor="new-tag-name">{t('标签名称')}</label><input autoFocus id="new-tag-name" value={name} maxLength={40} onChange={event=>setName(event.target.value)}/>
      {error&&<p role="alert">{t(error)}</p>}<div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={!name.trim()}>{t('添加标签')}</button></div>
    </form>
  </dialog>;
}
