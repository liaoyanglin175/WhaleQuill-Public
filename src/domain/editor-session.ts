import { recordSchema, recordTitle } from './models';
import type { NoteRecord } from './models';
import { isBlankDraft } from './record-view';
import { reanchorHighlights } from './highlights';

export type EditorSnapshot = {
  record: NoteRecord;
  dirty: boolean;
  isNew: boolean;
  status: 'draft' | 'pending' | 'saving' | 'saved' | 'error';
  error: string;
  recoveryAt?: string;
  recoveryError?: string;
  resetVersion: number;
};

// Only an explicit save commits a captured revision. Input after that gesture
// stays unsaved, even when the earlier database write is still in flight.
export class EditorSession {
  private baseline: NoteRecord;
  private initial: NoteRecord;
  private snapshot: EditorSnapshot;
  private listeners = new Set<() => void>();
  private flight?: Promise<boolean>;
  private requestedContent = '';
  private disposed = false;
  private composing = false;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private recoveryFlight: Promise<void> = Promise.resolve();
  private recoveryContent = '';
  private recoveryEnabled: boolean;

  constructor(record: NoteRecord, isNew: boolean, private persist: (record: NoteRecord) => Promise<void>, private recoveryWriter: (record: NoteRecord | null) => void | Promise<void> = () => {}, recovered?: NoteRecord, private recoveryDelay = 0) {
    this.initial = record;
    this.baseline = record;
    this.snapshot = { record: recovered ?? record, dirty: !!recovered, isNew, status: recovered ? 'pending' : isNew ? 'draft' : 'saved', error: '', resetVersion:0 };
    this.recoveryEnabled = recoveryDelay > 0;
    this.scheduleRecovery();
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private publish(patch: Partial<EditorSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }

  update(patch: Partial<Pick<NoteRecord, 'title' | 'body' | 'recordType' | 'tags' | 'highlights' | 'document'>>) {
    if (this.disposed) return;
    const previous = this.snapshot.record;
    const record = { ...previous, ...patch };
    if (patch.body !== undefined && patch.highlights === undefined) record.highlights = reanchorHighlights(previous.body, record.body, previous.highlights);
    const dirty = !!this.flight || (this.content(record) !== this.content(this.baseline) && !(this.snapshot.isNew && this.empty(record)));
    this.publish({ record, dirty, status: this.flight ? 'saving' : dirty ? 'pending' : this.snapshot.isNew ? 'draft' : 'saved', error: '' });
    if(dirty)this.scheduleRecovery();else void this.clearRecovery();
  }

  private content(record: NoteRecord) { return JSON.stringify([record.title, record.body, record.recordType, record.tags, record.highlights.map(({id,text,start,end,createdAt,stale})=>[id,text,start,end,createdAt,stale]),record.document??null]); }
  private empty(record: NoteRecord) { return isBlankDraft({ ...record, title: record.title.trim() || '未命名记录' }); }

  setComposing(composing: boolean) { this.composing = composing; }
  waitForPendingSave(): Promise<boolean> { return this.flight ?? Promise.resolve(true); }

  setRecoveryEnabled(enabled: boolean) {
    this.recoveryEnabled=enabled;
    if(enabled){if(!this.recoveryDelay)this.recoveryDelay=12_000;this.scheduleRecovery();}
    else void this.clearRecovery();
  }

  private scheduleRecovery() {
    if(this.disposed||!this.recoveryEnabled||!this.snapshot.dirty||this.recoveryTimer)return;
    this.recoveryTimer=setTimeout(()=>{this.recoveryTimer=undefined;void this.protectRecovery();},this.recoveryDelay);
  }

  private async protectRecovery() {
    if(this.disposed||!this.recoveryEnabled||!this.snapshot.dirty)return;
    if(this.composing||this.flight){this.scheduleRecovery();return;}
    const record=this.snapshot.record,content=this.content(record);
    if(content===this.recoveryContent)return;
    this.recoveryFlight=this.recoveryFlight.catch(()=>{}).then(async()=>{
      await this.recoveryWriter(record);this.recoveryContent=content;
      if(!this.disposed)this.publish({recoveryAt:new Date().toISOString(),recoveryError:''});
    });
    try{await this.recoveryFlight;}catch{if(!this.disposed)this.publish({recoveryError:'本地恢复副本更新失败，请及时手动保存。'});}
    if(this.snapshot.dirty&&this.content(this.snapshot.record)!==this.recoveryContent)this.scheduleRecovery();
  }

  save(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.composing) {
      this.publish({ error: '请先完成当前输入法选字，再保存。' });
      return Promise.resolve(false);
    }
    const input = this.snapshot.record;
    const content = this.content(input);
    if (this.flight && content === this.requestedContent) return this.flight;
    if (!this.flight && !this.snapshot.dirty) return Promise.resolve(true);
    this.requestedContent = content;
    const preceding = this.flight ?? Promise.resolve(true);
    this.publish({ status: 'saving', error: '' });
    const operation = preceding.then(async () => {
      if (this.disposed) return false;
      try {
        const saved = recordSchema.parse({ ...input, title: recordTitle(input), updatedAt: new Date().toISOString() });
        await this.persist(saved);
        this.baseline = saved;
        const current = this.snapshot.record;
        const record = { ...current, title: this.content(current) === content ? saved.title : current.title, updatedAt: saved.updatedAt };
        const dirty = this.content(record) !== this.content(saved);
        this.publish({ record, isNew: false, dirty, status: dirty ? 'pending' : 'saved', error: '' });
        const cleared=await this.clearRecovery();
        if(!cleared)this.publish({dirty:true,status:'error',error:'正式记录已保存，但恢复副本未能清理，请重试。'});
        if(dirty)this.scheduleRecovery();
        return !dirty&&cleared;
      } catch (error) {
        this.publish({ dirty: true, status: 'error', error: `保存失败：${error instanceof Error ? error.message : String(error)}。内容仍在编辑器中，请重试。` });
        return false;
      }
    }).finally(() => { if (this.flight === operation) this.flight = undefined; });
    this.flight = operation;
    return operation;
  }

  private async clearRecovery() {
    if(this.recoveryTimer){clearTimeout(this.recoveryTimer);this.recoveryTimer=undefined;}
    this.recoveryFlight=this.recoveryFlight.catch(()=>{}).then(async()=>{await this.recoveryWriter(null);this.recoveryContent='';if(!this.disposed)this.publish({recoveryAt:undefined,recoveryError:''});});
    try { await this.recoveryFlight; return true; }
    catch { this.publish({ recoveryError: '本地恢复副本未能清理，请重试；正式记录不受影响。' }); return false; }
  }

  async discard() {
    if (this.flight) await this.flight;
    if(!(await this.clearRecovery()))return false;
    this.composing=false;
    this.publish({ record: this.snapshot.isNew ? this.initial : this.baseline, dirty: false, status: this.snapshot.isNew ? 'draft' : 'saved', error: '', resetVersion:this.snapshot.resetVersion+1 });
    return true;
  }

  dispose() { this.disposed = true; if(this.recoveryTimer)clearTimeout(this.recoveryTimer); this.listeners.clear(); }
}
