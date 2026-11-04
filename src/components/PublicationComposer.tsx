import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import type {NoteRecord} from '../domain/models';
import {publicDocument} from '../domain/rich-document';
import {contentFingerprint,publicationLink,publicRequest,readPublishedLink,rememberPublishedLink,usePublicSession} from '../community';
import type {PublicPost} from '../community';
import {useI18n} from '../i18n';
import PublicAccount from './PublicAccount';
import RichContent from './RichContent';

export default function PublicationComposer({record,selection,dirty,onSave,onClose}:{record:NoteRecord;selection:string;dirty:boolean;onSave:()=>Promise<boolean>;onClose:()=>void}){
  const {t}=useI18n(),session=usePublicSession(),dialog=useRef<HTMLDialogElement>(null);
  const [needsSave,setNeedsSave]=useState(dirty),[part,setPart]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[published,setPublished]=useState<PublicPost|null>(null),[existing,setExisting]=useState(readPublishedLink(record.id)),[notice,setNotice]=useState('');
  const [changed,setChanged]=useState(false);
  const payload={title:part?selection.trim().split('\n')[0].slice(0,60):record.title==='未命名记录'?record.body.trim().split('\n')[0].slice(0,60):record.title,body:part?selection.trim():record.body,document:part?null:publicDocument(record.document),sourceId:(()=>{try{return JSON.parse(localStorage.getItem('dafeiyu-idea-sources-v1')??'{}')[record.id]??null;}catch{return null;}})()};
  useEffect(()=>{dialog.current?.showModal();},[]);
  useEffect(()=>{let active=true;if(existing)void contentFingerprint(payload).then(hash=>{if(active)setChanged(hash!==existing.fingerprint);});return()=>{active=false;};},[record,part,existing]);
  return <dialog ref={dialog} className="confirm-dialog publication-composer" aria-label={t('发布预览')} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}><header><div><h2>{t('发布预览')}</h2><p>{t('原稿保留在本地，公开的是你确认的副本。')}</p></div><button className="icon-button" aria-label={t('关闭发布预览')} disabled={busy} onClick={onClose}><X size={18}/></button></header>
    {needsSave?<div><p>{t('当前修改尚未保存。先保存，再预览公开内容。')}</p><button className="button primary" disabled={busy} onClick={async()=>{setBusy(true);try{if(await onSave())setNeedsSave(false);else setError('保存未完成，内容尚未发布。');}finally{setBusy(false);}}}>{t('保存并预览')}</button></div>:<>
      <PublicAccount/>{!session&&<p className="publication-auth-hint" role="status">{t('先完成上方登录，再确认发布。')}</p>}{selection.trim()&&<label className="setting-row"><input type="checkbox" checked={part} disabled={busy||!!published} onChange={event=>{setPart(event.target.checked);setPublished(null);}}/>{t('只发布选中片段')}</label>}
      <div className="publication-preview"><h3>{payload.title}</h3><RichContent document={payload.document} body={payload.body}/></div>
      {existing&&!published&&!part&&<div className="previous-publication"><p role="status">{t(changed?'本地有更新，尚未更新公开副本。':'与上次发布的版本一致。')} · {t('版本 {0}',existing.revision)}</p><input aria-label={t('上次公开链接')} readOnly value={publicationLink(existing.id)}/><button className="text-button" disabled={busy} onClick={()=>{setExisting(null);setNotice('将发布为新的副本，已有公开内容保留。');}}>{t('作为新的副本发布')}</button></div>}
      <p className="inquiry-hint">{t('个人重点、任务和恢复副本不会随这份内容发布。')}</p>
      {published?<div className="published-result" role="status"><p>{t('公开副本已发布 · 版本 {0}',published.revision)}</p><input aria-label={t('公开链接')} readOnly value={publicationLink(published.id)}/><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(publicationLink(published.id));setNotice('链接已复制。');}catch{setNotice('请从上方复制链接。');}}}>{t('复制链接')}</button><button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);setError('');try{await publicRequest(`/api/posts/${published.id}`,{method:'DELETE'});rememberPublishedLink(record.id,null);setPublished(null);setExisting(null);setNotice('公开副本已撤回，本地原稿保留。');}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}}>{t('撤回公开副本')}</button></div>:<div className="dialog-actions"><button className="button secondary" disabled={busy} onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={busy||!session||!payload.body||payload.body.length>20000} onClick={async()=>{setBusy(true);setError('');try{const fingerprint=await contentFingerprint(payload);const next=await publicRequest<PublicPost>(existing&&!part?`/api/posts/${existing.id}`:'/api/posts',{method:existing&&!part?'PUT':'POST',body:payload,revision:existing&&!part?existing.revision:undefined});if(!part){const link={id:next.id,revision:next.revision,fingerprint};rememberPublishedLink(record.id,link);setExisting(link);}setPublished(next);setNotice('');}catch(error){setError(error instanceof Error?error.message:String(error));}finally{setBusy(false);}}}>{t(existing&&!part?'确认更新公开副本':'确认发布副本')}</button></div>}
      {payload.body.length>20000&&<p role="alert">{t('公开内容最多 20000 字，请选中一段再发布。')}</p>}
    </>}{error&&<p role="alert">{t(error)}</p>}{notice&&<p role="status">{t(notice)}</p>}
  </dialog>;
}
