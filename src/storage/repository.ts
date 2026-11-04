import { isTauri } from '@tauri-apps/api/core';
import type { FullSnapshot, NoteRecord, Task, TrashEntry, Workspace } from '../domain/models';
import type {CreationItem,CreationBatch} from '../domain/creation';
import type {RetentionDays,TrashRetentionInfo} from '../domain/trash-retention';

export interface NotebookRepository {
  readonly mode: 'browser' | 'desktop';
  load(): Promise<Workspace>;
  loadTrash(): Promise<TrashEntry[]>;
  restore(kind: TrashEntry['kind'], id: string): Promise<void>;
  saveRecord(record: NoteRecord): Promise<void>;
  deleteRecord(id: string): Promise<void>;
  saveTask(task: Task, expectedUpdatedAt?:string): Promise<void>;
  deleteTask(id: string): Promise<void>;
  maintainTasks():Promise<boolean>;
  trashRetentionInfo():Promise<TrashRetentionInfo>;
  previewTrashRetention(days:RetentionDays):Promise<number>;
  setTrashRetention(days:RetentionDays,confirmedCount:number):Promise<TrashRetentionInfo>;
  commitCreation(requestId:string,items:CreationItem[]):Promise<CreationBatch>;
  undoCreation(requestId:string):Promise<void>;
  mergeWorkspace(workspace: Workspace): Promise<void>;
  exportSnapshot(): Promise<FullSnapshot>;
  mergeSnapshot(snapshot: FullSnapshot): Promise<void>;
}

let repositoryPromise: Promise<NotebookRepository> | undefined;

export function getRepository(): Promise<NotebookRepository> {
  repositoryPromise ??= (async () => {
    if (isTauri()) {
      const { DesktopRepository } = await import('./desktop');
      return new DesktopRepository();
    }
    const { BrowserRepository } = await import('./browser');
    return new BrowserRepository();
  })();
  return repositoryPromise;
}
