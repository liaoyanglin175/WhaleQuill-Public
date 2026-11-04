import type { NoteRecord } from './models';
import { liveHighlights } from './highlights';
import { tagKey } from './tags';

export const starSlots = [
  { x: 60, y: 21 }, { x: 75, y: 19 }, { x: 90, y: 24 },
  { x: 61, y: 41 }, { x: 75, y: 39 }, { x: 89, y: 43 },
  { x: 60, y: 61 }, { x: 76, y: 57 }, { x: 90, y: 63 },
  { x: 61, y: 77 }, { x: 75, y: 80 }, { x: 89, y: 77 },
];
export const starLimit = 5;
export type StarNode = { recordId: string; slot: number };
export type StarScene = { nodes: StarNode[]; seen: ReadonlySet<string>; fading: StarNode[] };

function stableHash(value: string) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function starThemes(records: Iterable<NoteRecord>) {
  const counts = new Map<string, number>();
  const byRecord = new Map<string, string[]>();
  for (const record of records) {
    const keys = [...new Set(record.tags.map(tagKey).filter(Boolean))];
    byRecord.set(record.id, keys);
    for (const tag of keys) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return new Map([...byRecord].map(([id, tags]) => {
    const specific = tags.filter(tag => counts.get(tag)! < byRecord.size * 0.72);
    const shared = specific.filter(tag => counts.get(tag)! > 1);
    const candidates = shared.length ? shared : specific.length ? specific : tags;
    return [id, candidates.sort((a, b) => counts.get(a)! - counts.get(b)! || a.localeCompare(b))[0]];
  }));
}

function addNode(record: NoteRecord, nodes: StarNode[], themes: Map<string, string | undefined>, blocked: ReadonlySet<number>, now: number) {
  const theme = themes.get(record.id);
  const row = stableHash(theme ?? record.id) % 4;
  const days = (now - Date.parse(record.createdAt)) / 86_400_000;
  const depth = days <= 7 ? 2 : days <= 30 ? 1 : 0;
  const occupied = new Set(nodes.map(node => node.slot));
  const neighbors = theme ? nodes.filter(node => themes.get(node.recordId) === theme) : [];
  let best = -1;
  let bestScore = Infinity;
  starSlots.forEach((_, index) => {
    if (occupied.has(index) || blocked.has(index)) return;
    const column = index % 3;
    const lane = Math.floor(index / 3);
    const nearTheme = neighbors.length ? Math.min(...neighbors.map(node =>
      Math.abs(Math.floor(node.slot / 3) - lane) + 0.25 * Math.abs(node.slot % 3 - column))) : Math.abs(lane - row);
    const score = 1.25 * Math.abs(column - depth) + 1.6 * nearTheme + 0.15 * Math.abs(lane - row);
    if (score < bestScore) { best = index; bestScore = score; }
  });
  if (best !== -1) nodes.push({ recordId: record.id, slot: best });
}

function takeRandom(pool: NoteRecord[]) {
  const index = Math.floor(Math.random() * pool.length);
  const record = pool[index];
  pool[index] = pool[pool.length - 1];
  pool.pop();
  return record;
}

export function fillStarScene(records: Map<string, NoteRecord>, themes: Map<string, string | undefined>, previous?: StarScene, required?: string): StarScene {
  const nodes = (previous?.nodes ?? []).filter(node => records.has(node.recordId));
  const seen = new Set([...(previous?.seen ?? [])].filter(id => records.has(id)));
  const now = Date.now();
  const selected = required && records.get(required);
  if (selected && !nodes.some(node => node.recordId === selected.id)) {
    if (nodes.length >= starLimit) nodes.pop();
    addNode(selected, nodes, themes, new Set(), now);
  }
  if (nodes.length < starLimit) {
    const occupied = new Set(nodes.map(node => node.recordId));
    const pool = [...records.values()].filter(record => !occupied.has(record.id));
    const blocked = new Set<number>();
    while (pool.length && nodes.length < starLimit) addNode(takeRandom(pool), nodes, themes, blocked, now);
  }
  for (const node of nodes) seen.add(node.recordId);
  return { nodes, seen, fading: [] };
}

export function rotateStarScene(scene: StarScene, records: Map<string, NoteRecord>, themes: Map<string, string | undefined>, featured: string, blocked: ReadonlySet<number>): StarScene {
  const visible = new Set(scene.nodes.map(node => node.recordId));
  const unseen = [...records.values()].filter(record => !scene.seen.has(record.id) && !visible.has(record.id));
  const pool = unseen.length ? unseen : [...records.values()].filter(record => !visible.has(record.id));
  const fading = scene.nodes.filter(node => node.recordId !== featured && !blocked.has(node.slot)).slice(0, Math.min(2, pool.length));
  if (!fading.length) return scene;
  const forbidden = new Set([...blocked, ...fading.map(node => node.slot)]);
  const nodes = scene.nodes.filter(node => !fading.includes(node));
  const seen = new Set(unseen.length ? scene.seen : visible);
  const now = Date.now();
  for (const outgoing of fading) {
    const candidate = takeRandom(pool);
    const before = nodes.length;
    addNode(candidate, nodes, themes, forbidden, now);
    if (nodes.length === before) nodes.push(outgoing);
    else seen.add(candidate.id);
  }
  return { nodes, seen, fading: fading.filter(node => !nodes.includes(node)) };
}

const clean = (value: string) => value.replace(/\s+/gu, ' ').trim();
const clip = (value: string, length: number) => {
  const points = Array.from(value);
  return points.length > length ? `${points.slice(0, length - 1).join('').trimEnd()}…` : value;
};

export function localStarSummary(record: NoteRecord): string {
  const body = record.body.trim();
  if (body.length <= 90) return clean(body);
  const excerpt = body.length > 1800 ? `${body.slice(0, 1000)}\n${body.slice(-800)}` : body;
  const lines = excerpt.split(/\n+|(?<=[。！？!?；;])|(?<=\.)\s+/u).map(clean).filter(Boolean);
  const highlight = liveHighlights(record)[0]?.text;
  const main = clean(highlight || lines[0] || excerpt);
  const ending = lines.slice(1).filter(line => !main.includes(line) && !line.includes(main));
  const signal = /下次|接下来|后来|发现|决定|原因|因为|结果|改为|调整|完成|下一步|next|because|decided|result/i;
  const detail = [...ending].reverse().find(line => signal.test(line)) ?? ending.at(-1);
  return detail ? `${clip(main, 44)} ${clip(detail, 45)}` : clip(main, 90);
}

export function formatAiStarSummary(answer: string, language: 'zh' | 'en'): string {
  return clip(clean(answer.replace(/\s*\[\d+\]/g, '')), language === 'zh' ? 100 : 280);
}
