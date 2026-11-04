import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { extractTaskCandidates } from '../domain/task-extraction';

export default function TaskComposer({ body, selection, requiresSave = false, onConfirm, onClose }: {
  body: string; selection: string; requiresSave?: boolean; onConfirm: (title: string,dueDate:string|null) => Promise<boolean>; onClose: () => void;
}) {
  const { t } = useI18n();
  const candidates = extractTaskCandidates(body);
  const [title, setTitle] = useState(selection.trim().replace(/\s+/g, ' ') || candidates[0]?.title || '');
  const [working, setWorking] = useState(false);
  const [dueDate,setDueDate]=useState(()=>new Date().toLocaleDateString('sv-SE'));
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="confirm-dialog task-composer" aria-labelledby="task-composer-title" onCancel={(event) => { event.preventDefault(); if (!working) onClose(); }}>
    <button className="icon-button dialog-close" aria-label={t("关闭任务预览")} disabled={working} onClick={onClose}><X size={18} /></button>
    <h2 id="task-composer-title">{t("创建关联任务")}</h2><p>{t("核对名称与日期，原记录会保留为来源。")}</p>
    {requiresSave && <p className="task-save-consent">{t("当前记录尚未保存。确认时会一并保存正文和重点，作为任务来源；取消不会保存。")}</p>}
    {!!candidates.length && <div className="task-candidates" aria-label={t("正文待办候选")}>{candidates.map((candidate) => <button className="task-candidate" key={candidate.line} disabled={working} onClick={() => setTitle(candidate.title)}><span>{t("第 ")}{candidate.line}{t(" 行")}</span>{candidate.title}</button>)}</div>}
    {!candidates.length && !selection && <p>{t("未识别到明确的待办标记。你可以选中正文中的一句话，或在下面填写任务名称。")}</p>}
    <form onSubmit={async (event) => { event.preventDefault(); if (!title.trim() || title.trim().length > 200 || working) return; setWorking(true); setError(''); try { if (await onConfirm(title.trim(),dueDate||null)) onClose(); else setError('未能创建任务，请查看保存状态后重试。'); } finally { setWorking(false); } }}>
      <label className="task-name-label" htmlFor="extracted-task-name">{t("任务名称")}</label><input autoFocus id="extracted-task-name" value={title} disabled={working} onChange={(event) => setTitle(event.target.value)} />
      <label className="task-name-label" htmlFor="extracted-task-date">{t('截止日期（可选）')}</label><input id="extracted-task-date" type="date" value={dueDate} disabled={working} onChange={event=>setDueDate(event.target.value)}/>
      {title.trim().length > 200 && <p role="alert">{t("任务名称需要缩短到 200 个字符以内。")}</p>}{error && <p role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button secondary" disabled={working} onClick={onClose}>{t("取消")}</button><button className="button primary" disabled={working || !title.trim() || title.trim().length > 200}>{working ? t("正在添加…") : requiresSave ? t("保存记录并添加任务") : t("确认添加任务")}</button></div>
    </form>
  </dialog>;
}
