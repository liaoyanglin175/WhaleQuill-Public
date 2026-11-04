import { useI18n } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

export interface Confirmation {
  title: string;
  body: string;
  label: string;
  destructive?: boolean;
  cancelLabel?: string;
  companion?: boolean;
  action: () => Promise<boolean>;
  alternate?: { label: string; action: () => Promise<boolean> };
  onClose?:()=>void;
}

export default function ConfirmDialog({ confirmation, busy, onClose }: {
  confirmation: Confirmation;
  busy: boolean;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const [working, setWorking] = useState(false);
  const [failure, setFailure] = useState('');
  const locked = busy || working;
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function run(action: () => Promise<boolean>) {
    if (locked) return;
    setWorking(true);
    setFailure('');
    try { if (await action()) onClose(); else setFailure('操作未完成，内容仍保留。请重试，或取消后查看保存错误。'); }
    catch { setFailure('操作失败，内容仍保留。请取消后重试。'); }
    finally { setWorking(false); }
  }
  return <dialog ref={dialog} className="confirm-dialog" aria-labelledby="confirmation-title" aria-describedby="confirmation-description" onCancel={(event) => { event.preventDefault(); if (!locked) onClose(); }}>
    <button className="icon-button dialog-close" aria-label={t("关闭对话框")} disabled={locked} onClick={onClose}><X size={18} /></button>

    <h2 id="confirmation-title">{t(confirmation.title)}</h2>
    <p id="confirmation-description">{t(confirmation.body)}</p>
    {failure && <p role="alert">{t(failure)}</p>}
    <div className="dialog-actions">
      <button className="button secondary" autoFocus disabled={locked} onClick={onClose}>{t(confirmation.cancelLabel ?? "取消")}</button>
      {confirmation.alternate && <button className="button secondary" disabled={locked} onClick={() => void run(confirmation.alternate!.action)}>{t(confirmation.alternate.label)}</button>}
      <button className={`button ${confirmation.destructive ? 'danger' : 'primary'}`} disabled={locked} onClick={() => void run(confirmation.action)}>{locked ? t("正在处理…") : t(confirmation.label)}</button>
    </div>
  </dialog>;
}
