import { z } from 'zod';
import { invoke } from '@tauri-apps/api/core';
import { recordSchema } from '../domain/models';
import type { NoteRecord } from '../domain/models';

// A recovery copy must also preserve temporarily invalid editor input.
const recoverySchema = z.object({ record: recordSchema.safeExtend({ title: z.string(), body: z.string(), tags: z.array(z.string()) }), savedAt: z.string().datetime({ offset: true }) });
export type RecoveryEntry = z.infer<typeof recoverySchema>;
const prefix = (mode: string) => `dafeiyu-recovery-v1:${mode}:`;
const purgedKey=(mode:string,id:string)=>`dafeiyu-purged-recovery:${mode}:${id}`;
export function forgetPurgedRecovery(mode:string,ids:string[]){try{for(const id of ids){localStorage.setItem(purgedKey(mode,id),'1');localStorage.removeItem(prefix(mode)+id);}}catch{/* Native recovery is removed in the same database transaction. */}}
export function allowImportedRecovery(mode:string,ids:string[]){try{for(const id of ids)localStorage.removeItem(purgedKey(mode,id));}catch{/* Keep the imported note itself usable. */}}
const pending = new Map<string, Promise<void>>();
const revisions = new Map<string, object>();
export function recoveryEnabled():boolean {try{return localStorage.getItem('dafeiyu-crash-recovery')!=='off';}catch{return true;}}
export function setRecoveryEnabled(enabled:boolean) {try{localStorage.setItem('dafeiyu-crash-recovery',enabled?'on':'off');}catch{/* Keep the current session preference even when browser settings are unavailable. */}finally{window.dispatchEvent(new CustomEvent('dafeiyu-recovery-setting',{detail:enabled}));}}

export function writeRecovery(mode: string, id: string, record: NoteRecord | null): void | Promise<void> {
  const key = `${prefix(mode)}${id}`;
  try {
    if(record&&localStorage.getItem(purgedKey(mode,id)))throw new Error('原记录已永久清理，请新建记录后保存。');
    if (record) localStorage.setItem(key, JSON.stringify({ record, savedAt: new Date().toISOString() }));
    else localStorage.removeItem(key);
  } catch (error) { if (mode !== 'desktop') throw error; }
  if (mode === 'desktop') {
    const revision = {};
    revisions.set(key, revision);
    const next = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (revisions.get(key) === revision) await invoke<void>('write_recovery', { id, record });
    });
    pending.set(key, next);
    const cleanup = () => { if (pending.get(key) === next) { pending.delete(key); revisions.delete(key); } };
    void next.then(cleanup, cleanup);
    return next;
  }
}

export async function readRecovery(mode: string): Promise<RecoveryEntry[]> {
  const result: RecoveryEntry[] = [];
  try { for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key?.startsWith(prefix(mode))) continue;
    try {
      const entry = recoverySchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
      if (entry.success&&!localStorage.getItem(purgedKey(mode,entry.data.record.id))) result.push(entry.data);
    } catch { /* Leave unreadable recovery data untouched for manual inspection. */ }
  } } catch (error) { if (mode !== 'desktop') throw error; }
  if (mode === 'desktop') {
    const native = recoverySchema.array().parse(await invoke('load_recovery'));
    const entries = new Map(result.map((entry) => [entry.record.id, entry]));
    for (const entry of native) {
      const local = entries.get(entry.record.id);
      if (!local || Date.parse(entry.savedAt) >= Date.parse(local.savedAt)) entries.set(entry.record.id, entry);
    }
    return [...entries.values()].sort((a, b) => Date.parse(b.savedAt) - Date.parse(a.savedAt));
  }
  return result.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
}
