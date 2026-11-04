import {useEffect,useRef} from 'react';
import {useI18n} from '../i18n';
export type BackupWork={token:string;mode:'export'|'import';done:number;total:number;bytes:number;cancelled:boolean};
export default function BackupProgress({work,onCancel}:{work:BackupWork;onCancel:()=>void}){
 const {t}=useI18n(),dialog=useRef<HTMLDialogElement>(null);useEffect(()=>{dialog.current?.showModal();},[]);
 return <dialog ref={dialog} className="confirm-dialog backup-progress" aria-labelledby="backup-progress-title" onCancel={event=>{event.preventDefault();onCancel();}}>
  <h2 id="backup-progress-title">{t(work.mode==='export'?'正在导出备份':'正在校验备份')}</h2>
  <p role="status">{t(work.cancelled?'正在取消…':work.total?'已处理{0} / {1}项':'正在准备…',work.done,work.total)}</p>
  {work.total>0&&<progress aria-label={t('备份进度')} value={work.done} max={work.total}/>}
  <p>{t(work.mode==='export'?'写入完成后才替换目标文件。':'校验完成后会先预览，确认前不写入。')}</p>
  <div className="dialog-actions"><button className="button secondary" disabled={work.cancelled} onClick={onCancel}>{t('取消')}</button></div>
 </dialog>;
}
