import { readLanguage, translate } from '../i18n';
import { isTauri } from '@tauri-apps/api/core';
import {backupBlob,readBackupBlob} from '../domain/stream-backup';
import type {FullSnapshot} from '../domain/models';
import type {BackupProgress} from '../domain/stream-backup';

export async function downloadCompleteBackup(snapshot:FullSnapshot,signal:AbortSignal,onProgress:(p:BackupProgress)=>void):Promise<boolean>{
 const blob=await backupBlob(snapshot,signal,onProgress);if(signal.aborted)return false;
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`Whale-Quill-${new Date().toLocaleDateString('sv-SE')}.wqbackup`;link.click();setTimeout(()=>URL.revokeObjectURL(url),30_000);return true;
}
export const readBackupFile=readBackupBlob;

export async function downloadText(text: string, filename: string, mime = 'text/markdown;charset=utf-8', extensions = ['md']): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const path = await save({ title: translate(extensions[0] === 'json' ? '完整备份' : '导出当前记录为 Markdown', readLanguage()), defaultPath: filename, filters: [{ name: translate(extensions[0] === 'json' ? '记事本完整备份' : 'Markdown 文档', readLanguage()), extensions }] });
    if (!path) return false;
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return true;
}

