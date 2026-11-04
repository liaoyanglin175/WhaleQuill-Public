import type {RetentionDays,TrashRetentionInfo} from '../domain/trash-retention';
import {forgetPurgedRecovery,allowImportedRecovery} from './recovery';
import { invoke } from '@tauri-apps/api/core';
import { fullSnapshotSchema, recordSchema, taskSchema, trashEntrySchema, workspaceSchema } from '../domain/models';
import type { FullSnapshot, NoteRecord, Task, TrashEntry, Workspace } from '../domain/models';
import type { NotebookRepository } from './repository';
import {creationProposalSchema} from '../domain/creation';
import type {CreationItem,CreationBatch} from '../domain/creation';

export class DesktopRepository implements NotebookRepository {
  readonly mode = 'desktop' as const;
  async commitCreation(requestId:string,items:CreationItem[]):Promise<CreationBatch>{const result=await invoke<CreationBatch>('commit_creation',{requestId,proposal:creationProposalSchema.parse({items})});return {...result,...workspaceSchema.parse(result)};}
  async undoCreation(requestId:string):Promise<void>{await invoke('undo_creation',{requestId});}
  async load(): Promise<Workspace> { const result=workspaceSchema.parse(await invoke('load_workspace'));forgetPurgedRecovery('desktop',await invoke<string[]>('purged_record_ids'));allowImportedRecovery('desktop',result.records.map(record=>record.id));return result; }
  async loadTrash(): Promise<TrashEntry[]> { return trashEntrySchema.array().parse(await invoke('load_trash')); }
  async restore(kind: TrashEntry['kind'], id: string): Promise<void> { await invoke('restore_item', { kind, id }); }
  async saveRecord(record: NoteRecord): Promise<void> { await invoke('save_record', { record: recordSchema.parse(record) }); }
  async deleteRecord(id: string): Promise<void> { await invoke('delete_record', { id }); }
  async saveTask(task: Task, expectedUpdatedAt?:string): Promise<void> { await invoke('save_task', { task: taskSchema.parse(task), expectedUpdatedAt }); }
  async deleteTask(id: string): Promise<void> { await invoke('delete_task', { id }); }
  async maintainTasks():Promise<boolean>{const changed=await invoke<boolean>('maintain_tasks');forgetPurgedRecovery('desktop',await invoke<string[]>('purged_record_ids'));return changed;}
  async trashRetentionInfo():Promise<TrashRetentionInfo>{return invoke('trash_retention_info');}
  async previewTrashRetention(days:RetentionDays):Promise<number>{return invoke('preview_trash_retention',{days});}
  async setTrashRetention(days:RetentionDays,confirmedCount:number):Promise<TrashRetentionInfo>{return invoke('set_trash_retention',{days,confirmedCount});}
  async mergeWorkspace(workspace: Workspace): Promise<void> { await invoke('merge_workspace', { workspace: workspaceSchema.parse(workspace) });allowImportedRecovery('desktop',workspace.records.map(r=>r.id)); }
  async exportSnapshot(): Promise<FullSnapshot> { return fullSnapshotSchema.parse(await invoke('export_snapshot')); }
  async mergeSnapshot(snapshot: FullSnapshot): Promise<void> { await invoke('merge_snapshot', { snapshot: fullSnapshotSchema.parse(snapshot) });allowImportedRecovery('desktop',snapshot.records.map(r=>r.id)); }
}
