import { useEffect, useMemo, useRef, useState } from 'react';
import { aiStatus, askAi } from '../ai/client';
import { makeMemorySource, sourcesCurrent } from '../domain/memory-context';
import type { NoteRecord } from '../domain/models';
import { formatAiStarSummary } from '../domain/star-map';
import { useI18n } from '../i18n';

export default function StarSummaryDialog({ record, current, onUse, onClose }: {
  record: NoteRecord;
  current: NoteRecord | undefined;
  onUse: (summary: string) => void;
  onClose: () => void;
}) {
  const { t, language, locale } = useI18n();
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [configured, setConfigured] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const source = useMemo(() => makeMemorySource(record, 1), [record]);
  const stale = !current || !sourcesCurrent([source], [current]);
  const question = language === 'zh'
    ? '把这一条随记精简为50至90字、两句以内的中文摘要。只依据提供的原文，保留核心事件、原因或下一步。直接给摘要，不加标题、引用编号或建议。'
    : 'Condense this single note into up to two sentences, about 35–55 words. Use only the source, preserving the event and a relevant reason or next step. Return only the summary without headings, reference numbers, or suggestions.';

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void aiStatus().then(status => { if (active) setConfigured(status.configured); }).catch(() => {});
    return () => { active = false; request.current?.abort(); };
  }, []);

  async function generate() {
    if (!configured || !consent || stale || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    try {
      const response = await askAi({ id: crypto.randomUUID(), question, context: '', sources: [source], language, signal: controller.signal });
      if (controller.signal.aborted) return;
      const summary = formatAiStarSummary(response.answer, language);
      if (summary) setResult(summary);
      else setError('这次没有生成摘要，请重试。');
    } catch (error) {
      if (!controller.signal.aborted) setError(String(error));
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  }

  return <dialog ref={dialog} className="confirm-dialog star-summary-dialog" aria-labelledby="star-summary-title"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <h2 id="star-summary-title">{t('AI 精简')}</h2>
    {stale ? <p role="status">{t('参考原文已变化，请重新预览。')}</p> : result ? <>
      <p>{t('AI 摘要')}</p><blockquote>{result}</blockquote>
      <small>{t('采用后在本次打开的鲸笺中显示。')}</small>
    </> : <>
      <p>{t('将发送给 DeepSeek')}</p>
      <div className="star-summary-source" aria-label={t('发送内容预览')}>
        <strong>{source.title}</strong> <time dateTime={source.date}>{new Date(source.date).toLocaleDateString(locale)}</time>
        <blockquote>{source.body}</blockquote>
        <small>{question}</small>
      </div>
      {!configured && <p>{t('先在设置中连接 DeepSeek，即可结合原文思考。')}</p>}
      <label className="ai-consent"><input type="checkbox" checked={consent} disabled={!configured || busy}
        onChange={event => setConsent(event.target.checked)} />{t('允许发送上面这条随记的片段')}</label>
    </>}
    {error && <p role="alert">{t(error)}</p>}
    <div className="dialog-actions">
      <button className="button secondary" onClick={onClose}>{t('取消')}</button>
      {result ? <button className="button primary" disabled={stale} onClick={() => onUse(result)}>{t('用作星图摘要')}</button>
        : <button className="button primary" disabled={!configured || !consent || stale || busy} onClick={() => void generate()}>
          {t(busy ? '正在思考…' : '发送并精简')}
        </button>}
    </div>
  </dialog>;
}
