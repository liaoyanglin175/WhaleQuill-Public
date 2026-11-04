import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Compass, SkipForward, Sparkles, Waypoints, X } from 'lucide-react';
import { useI18n } from '../i18n';
import { liveHighlights } from '../domain/highlights';
import { recordTitle } from '../domain/models';
import type { NoteRecord, Task } from '../domain/models';
import { tagKey } from '../domain/tags';
import { fillStarScene, localStarSummary, rotateStarScene, starLimit, starSlots, starThemes } from '../domain/star-map';
import type { StarScene } from '../domain/star-map';
import Starfield from './Starfield';
import StarSummaryDialog from './StarSummaryDialog';
import './time-star-map.css';

const dwell = 8000;
const rotation = 15000;
const summaryKey = 'jingjian-star-summaries';
type Summaries = Record<string, { revision: string; text: string }>;
export type StarPosition = { recordId: string; scene: StarScene };

function readSummaries(): Summaries {
  try {
    const saved = JSON.parse(sessionStorage.getItem(summaryKey) ?? '{}');
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  } catch { return {}; }
}

export default function TimeStarMap({ records, tasks, position, onPosition, onOpen, busy, writing, filtered }: {
  records: NoteRecord[];
  tasks: Task[];
  position: StarPosition | null;
  onPosition: (position: StarPosition) => void;
  onOpen: (id: string) => void;
  busy: boolean;
  writing: boolean;
  filtered: boolean;
}) {
  const { t, locale } = useI18n();
  const stage = useRef<HTMLElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const recordsById = useMemo(() => new Map(records.map(record => [record.id, record])), [records]);
  const themes = useMemo(() => starThemes(records), [records]);
  const [scene, setScene] = useState(() => fillStarScene(recordsById, themes, position?.scene, position?.recordId));
  const [selected, setSelected] = useState(position?.recordId);
  const [inView, setInView] = useState(true);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [cluesOpen, setCluesOpen] = useState(false);
  const [summaryTarget, setSummaryTarget] = useState<NoteRecord | null>(null);
  const [summaries, setSummaries] = useState(readSummaries);
  const nodes = useMemo(() => scene.nodes.flatMap(node => {
    const record = recordsById.get(node.recordId);
    return record ? [{ ...node, record }] : [];
  }), [scene.nodes, recordsById]);
  const current = (nodes.find(node => node.recordId === selected) ?? nodes[0])?.record;
  const noteId = current?.id;
  const featured = useRef(noteId);
  featured.current = noteId;
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }), [locale]);
  const currentHighlights = useMemo(() => current ? liveHighlights(current) : [], [current]);
  const clueNotes = useMemo(() => {
    if (!cluesOpen || !current?.tags.length) return [];
    const keys = new Set(current.tags.map(tagKey));
    return records.filter(record => record.id !== current.id && record.tags.some(tag => keys.has(tagKey(tag))));
  }, [cluesOpen, current, records]);
  const clueTasks = useMemo(() => cluesOpen && noteId ? tasks.filter(task => task.sourceRecordId === noteId) : [], [cluesOpen, noteId, tasks]);
  const previewId = hovered ?? focused;
  const moving = !reduced && inView && foreground;
  const autoAdvance = moving && !writing && !busy && !previewId && !cluesOpen && !summaryTarget;

  useEffect(() => { setScene(previous => fillStarScene(recordsById, themes, previous)); }, [recordsById, themes]);

  useEffect(() => {
    if (!autoAdvance || recordsById.size <= starLimit) return;
    const interval = window.setInterval(() => {
      const active = featured.current;
      if (!active) return;
      const bounds = stage.current?.getBoundingClientRect();
      const position = pointer.current;
      const blocked = new Set<number>();
      if (bounds && position) starSlots.forEach(({ x, y }, index) => {
        const dx = bounds.left + x * bounds.width / 100 - position.x;
        const dy = bounds.top + y * bounds.height / 100 - position.y;
        if (Math.abs(dx) <= 30 && Math.abs(dy) <= 30) blocked.add(index);
      });
      setScene(previous => rotateStarScene(previous, recordsById, themes, active, blocked));
    }, rotation);
    return () => window.clearInterval(interval);
  }, [autoAdvance, recordsById, themes]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setInView(entries[0].isIntersecting), { threshold: 0.18 });
    observer.observe(element);
    const visibility = () => setForeground(!document.hidden);
    document.addEventListener('visibilitychange', visibility);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motion = () => setReduced(media.matches);
    media.addEventListener('change', motion);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      media.removeEventListener('change', motion);
    };
  }, []);

  const advance = useCallback(() => {
    if (nodes.length < 2) return;
    const index = nodes.findIndex(node => node.recordId === noteId);
    setSelected(nodes[(index + 1) % nodes.length].recordId);
  }, [noteId, nodes]);

  useEffect(() => {
    if (!autoAdvance || nodes.length < 2) return;
    const timer = window.setTimeout(advance, dwell);
    return () => window.clearTimeout(timer);
  }, [advance, autoAdvance, nodes.length]);

  function open(id: string) {
    onPosition({ recordId: id, scene });
    onOpen(id);
  }

  const nodeCopy = useMemo(() => new Map(nodes.map(({ record }) => [record.id, {
    title: recordTitle(record),
    excerpt: localStarSummary(record),
    date: dateFormat.format(new Date(record.createdAt)),
  }])), [dateFormat, nodes]);
  function displayTitle(name: string) { return name === '未命名记录' ? t(name) : name; }
  const activeCopy = current && nodeCopy.get(current.id);
  const title = activeCopy ? displayTitle(activeCopy.title) : '';
  const cached = current && summaries[current.id];
  const aiSummary = cached && cached.revision === current?.updatedAt && typeof cached.text === 'string' ? cached.text : '';
  const excerpt = aiSummary || activeCopy?.excerpt || '';

  function adoptSummary(summary: string) {
    if (!summaryTarget) return;
    const id = summaryTarget.id;
    const next = Object.fromEntries([...Object.entries(summaries).filter(([key]) => key !== id).slice(-59),
      [id, { revision: summaryTarget.updatedAt, text: summary }]]);
    try { sessionStorage.setItem(summaryKey, JSON.stringify(next)); } catch { /* The current view still has the summary. */ }
    setSummaries(next);
    setSummaryTarget(null);
  }

  return <section ref={stage} className="star-map" aria-label={t('时间星图')} data-moving={moving}
    onPointerMove={event => { pointer.current = { x: event.clientX, y: event.clientY }; }}
    onPointerLeave={() => { pointer.current = null; }}
    onKeyDown={event => {
      if (event.key === 'Escape') {
        setCluesOpen(false);
        setHovered(null);
        setFocused(null);
      }
    }}>
    <Starfield moving={moving} />
    <div className="star-shade" aria-hidden="true" />
    <header className="star-map-top">
      <h3><Compass size={17} />{t('星海漫游')}</h3>
      {current && <button className="star-control star-clue-toggle" aria-expanded={cluesOpen} aria-controls="star-clue-panel"
        onClick={() => setCluesOpen(value => !value)} disabled={busy}>
        {cluesOpen ? <X size={15} /> : <Waypoints size={15} />}{t(cluesOpen ? '关闭线索' : '线索')}
      </button>}
    </header>
    {current ? <>
      <div key={current.id} className="star-memory" data-inspecting={previewId === current.id}>
        <time dateTime={current.createdAt}>{activeCopy?.date}</time>
        <h4><button onClick={() => open(current.id)} disabled={busy}
          onFocus={() => setFocused(current.id)} onBlur={() => setFocused(null)}>{title}</button></h4>
        {!!excerpt && excerpt !== title && <p className="star-excerpt">{aiSummary && <small>{t('AI 摘要')}</small>}{excerpt}</p>}
        <div className="star-memory-actions">
          <button className="star-open" onClick={() => open(current.id)} disabled={busy}
            onFocus={() => setFocused(current.id)} onBlur={() => setFocused(null)}>{t('打开记录')}<ArrowUpRight size={15} /></button>
          {!!current.body.trim() && <button className="star-open" onClick={() => setSummaryTarget(current)} disabled={busy}
            onFocus={() => setFocused(current.id)} onBlur={() => setFocused(null)}><Sparkles size={13} />{t('AI 精简')}</button>}
        </div>
      </div>
      {scene.fading.map(({ recordId, slot }) => <span aria-hidden="true" key={`out-${recordId}-${slot}`} className="star-fading"
        style={{ left: `${starSlots[slot].x}%`, top: `${starSlots[slot].y}%` }} />)}
      {nodes.map(({ record, slot }) => {
        const { x, y } = starSlots[slot];
        const copy = nodeCopy.get(record.id)!;
        const inspecting = previewId === record.id;
        const tooltipId = `star-point-preview-${record.id}`;
        return <div className="star-anchor" key={record.id} data-inspecting={inspecting} style={{ left: `${x}%`, top: `${y}%` }}>
          <button className="star-point" type="button" data-featured={record.id === noteId}
            aria-label={t('星点：{0}，{1}', displayTitle(copy.title), copy.date)}
            aria-describedby={inspecting ? tooltipId : undefined} disabled={busy}
            onPointerEnter={event => { if (event.pointerType !== 'touch') { setHovered(record.id); setSelected(record.id); } }}
            onPointerLeave={() => setHovered(null)}
            onFocus={() => { setFocused(record.id); setSelected(record.id); }} onBlur={() => setFocused(null)}
            onClick={() => open(record.id)}><span /></button>
          <div className="star-tooltip" id={tooltipId} role="tooltip" data-visible={inspecting} data-above={y > 49}>
            <strong>{displayTitle(copy.title)}</strong>
          </div>
        </div>;
      })}
    </> : <div className="star-memory star-empty">
      <h4>{t(filtered ? '没有找到匹配的内容' : '等待第一条记录')}</h4>
      <p>{t(filtered ? '试试其他线索，或调整筛选。' : '保存一条随记，就能在这里遇见它。')}</p>
    </div>}
    <footer className="star-map-bottom">
      {current && <button className="star-control star-next" onClick={advance} disabled={busy || nodes.length < 2}>
        <SkipForward size={15} />{t('下一段回忆')}
      </button>}
      {records.length === 1 && <small>{t('此刻只有这一条记录')}</small>}
    </footer>
    {cluesOpen && current && <aside className="star-clues" id="star-clue-panel" aria-label={t('线索')}>
      <h4>{t('线索')}</h4>
      {current.tags.length > 0 && <div className="star-tags">{current.tags.slice(0, 6).map(tag => <span key={tag}>#{tag}</span>)}</div>}
      <div className="star-clue-section">
        <h5>{t('同标签记录')} <span>{clueNotes.length}</span></h5>
        {!clueNotes.length && <p>{t('加上共同标签，就能在这里串起记录。')}</p>}
        {clueNotes.slice(0, 5).map(record => <button key={record.id} onClick={() => open(record.id)} disabled={busy}>
          {recordTitle(record)}<ArrowUpRight size={13} />
        </button>)}
        {clueNotes.length > 5 && <p>{t('另有 {0} 条，按标签筛选可查看。', clueNotes.length - 5)}</p>}
      </div>
      {currentHighlights.length > 0 && <div className="star-clue-section"><h5>{t('{0} 处重点', currentHighlights.length)}</h5>
        <p>{currentHighlights[0].text}</p>
      </div>}
      {clueTasks.length > 0 && <div className="star-clue-section"><h5>{t('关联事项')} <span>{clueTasks.length}</span></h5>
        {clueTasks.slice(0, 3).map(task => <p key={task.id} className={task.status === 'done' ? 'star-done' : undefined}>{task.title}</p>)}
      </div>}
    </aside>}
    {summaryTarget && <StarSummaryDialog record={summaryTarget} current={recordsById.get(summaryTarget.id)} onUse={adoptSummary} onClose={() => setSummaryTarget(null)} />}
  </section>;
}
