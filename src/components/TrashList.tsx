import { useI18n } from '../i18n';
import { RotateCcw } from 'lucide-react';
import type { TrashEntry } from '../domain/models';
import {useTrashRetention} from './TrashRetention';

export default function TrashList({ entries, busy, query, onRestore }: { entries: TrashEntry[]; busy: boolean; query: string; onRestore: (entry: TrashEntry) => void }) {
  const { t, locale } = useI18n();
  const {info,error}=useTrashRetention(entries),expiries=new Map(info?.entries.map(item=>[`${item.kind}:${item.id}`,item.expiresAt]));
  const matching = entries.filter((entry) => (entry.kind === 'record' ? entry.record.title : entry.task.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <section className="tasks-panel trash-panel" aria-label={t("回收站")}>
    <div className="section-intro"><p>{info?t(info.policy.days===null?'自动清理已关闭，已删除内容可恢复。':'已删除内容保留{0}天，到期永久清除。',info.policy.days):t('删除的内容暂存于此，可恢复。')}</p></div>
    {matching.map((entry) => {
      const item = entry.kind === 'record' ? entry.record : entry.task,expires=expiries.get(`${entry.kind}:${item.id}`);
      return <article className="trash-row" key={`${entry.kind}:${item.id}`}><div><span>{t(entry.kind==='record'?'随记':entry.task.kind==='event'?'行程':'待办')}</span><h3>{item.title}</h3><time>{new Date(entry.deletedAt).toLocaleString(locale)}{t(" 删除")}</time>{expires&&<p className="trash-expiry">{t("剩余{0}天 · {1}清除",Math.max(0,Math.ceil((Date.parse(expires)-Date.now())/86400000)),new Date(expires).toLocaleDateString(locale))}</p>}</div><button className="button secondary" disabled={busy} aria-label={t(entry.kind==='record'?'恢复记录：{0}':'恢复任务：{0}',item.title)} onClick={() => onRestore(entry)}><RotateCcw size={15} />{t("恢复")}</button></article>;
    })}
    {!matching.length && <p className="task-empty">{query ? t("没有匹配的已删除内容。") : t("回收站是空的。")}</p>}
    {error&&<p className="save-error" role="alert">{t(error)}</p>}<p className="trash-help">{t("完整备份包含回收站、任务及原始来源关系，无需先恢复。")}</p>
  </section>;
}
