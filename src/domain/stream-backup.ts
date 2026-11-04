import {recordSchema,taskSchema,fullSnapshotSchema,decodeArchive} from './models';
import type {Archive,FullSnapshot} from './models';
import {z} from 'zod';
export const backupLineLimit=64*1024*1024;
export type StreamArchive={application:'whale-quill-stream';version:8;exportedAt:string;snapshot:FullSnapshot};
export type BackupArchive=Archive|StreamArchive;
export type BackupProgress={done:number;total:number;bytes:number};
const utf8=new TextEncoder();
const hex=(bytes:Uint8Array)=>Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
async function digest(previous:Uint8Array,text:string){const bytes=utf8.encode(text);if(bytes.length>backupLineLimit)throw Error('单条备份内容超过64MB，请检查排版内容。');const input=new Uint8Array(32+bytes.length);input.set(previous);input.set(bytes,32);return new Uint8Array(await crypto.subtle.digest('SHA-256',input));}
function cancelled(signal?:AbortSignal){if(signal?.aborted)throw new DOMException('已取消','AbortError');}
export async function* backupLines(snapshot:FullSnapshot,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void):AsyncGenerator<string>{
 const value=fullSnapshotSchema.parse(snapshot),total=value.records.length+value.tasks.length;let chain:Uint8Array=new Uint8Array(32),done=0,bytes=0;
 const header=JSON.stringify({application:'whale-quill-stream',version:8,exportedAt:new Date().toISOString(),records:value.records.length,tasks:value.tasks.length})+'\n';chain=await digest(chain,header);bytes+=utf8.encode(header).length;yield header;
 for(const kind of ['record','task'] as const)for(const item of kind==='record'?value.records:value.tasks){cancelled(signal);const line=JSON.stringify({kind,value:item})+'\n';chain=await digest(chain,line);bytes+=utf8.encode(line).length;yield line;onProgress?.({done:++done,total,bytes});if(done%64===0)await new Promise(resolve=>setTimeout(resolve,0));}
 cancelled(signal);yield JSON.stringify({kind:'end',records:value.records.length,tasks:value.tasks.length,sha256:hex(chain)})+'\n';
}
export async function backupBlob(snapshot:FullSnapshot,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void):Promise<Blob>{const parts:BlobPart[]=[];for await(const line of backupLines(snapshot,signal,onProgress))parts.push(line);return new Blob(parts,{type:'application/x-whale-quill-backup;charset=utf-8'});}
/** Read one bounded line at a time, checking the footer before returning any importable content. */
export async function readBackupStream(chunks:AsyncIterable<Uint8Array>,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void):Promise<BackupArchive>{
 const decoder=new TextDecoder('utf-8',{fatal:true});let pending:string[]=[],pendingLength=0,header:Record<string,unknown>|null=null,legacy=false,legacyBytes=0,legacyText='',ended=false,chain:Uint8Array=new Uint8Array(32),bytes=0;
 const records:FullSnapshot['records']=[],tasks:FullSnapshot['tasks']=[];
 async function line(raw:string){cancelled(signal);if(ended)throw Error('备份结束标记后仍有内容。');if(!header){let value;try{value=JSON.parse(raw);}catch{legacy=true;legacyText=raw;legacyBytes=utf8.encode(raw).length;return;}
  if(!value||typeof value!=='object'||value.application!=='whale-quill-stream'){legacy=true;legacyText=raw;legacyBytes=utf8.encode(raw).length;return;}
  if(value.version!==8||!Number.isInteger(value.records)||!Number.isInteger(value.tasks)||value.records<0||value.records>50000||value.tasks<0||value.tasks>50000||!Number.isFinite(Date.parse(value.exportedAt)))throw Error('备份头信息不正确。');header=value;chain=await digest(chain,raw);return;
 }
 let value;try{value=JSON.parse(raw);}catch{throw Error('备份行格式不正确。');}
 if(value.kind==='end'){if(value.records!==records.length||value.tasks!==tasks.length||header.records!==records.length||header.tasks!==tasks.length||value.sha256!==hex(chain))throw Error('备份不完整或校验失败，未导入任何内容。');ended=true;return;}
 if(value.kind==='record'){if(tasks.length||records.length>=Number(header.records))throw Error('备份记录顺序或数量不正确。');records.push(recordSchema.safeExtend({deletedAt:taskDeleted}).parse(value.value));}
 else if(value.kind==='task'){if(records.length!==header.records||tasks.length>=Number(header.tasks))throw Error('备份任务顺序或数量不正确。');tasks.push(taskSchema.safeExtend({deletedAt:taskDeleted}).parse(value.value));}else throw Error('备份条目类型不正确。');
 chain=await digest(chain,raw);onProgress?.({done:records.length+tasks.length,total:Number(header.records)+Number(header.tasks),bytes});
 }
 for await(const chunk of chunks){cancelled(signal);bytes+=chunk.length;let text=decoder.decode(chunk,{stream:true});if(legacy){legacyText+=text;legacyBytes+=chunk.length;if(legacyBytes>20*1024*1024)throw Error('旧JSON备份不能超过20MB，请使用逐条备份格式。');continue;}
  let start=0;for(let index=0;index<text.length;index++)if(text[index]==='\n'){const segment=text.slice(start,index+1);pending.push(segment);pendingLength+=segment.length;if(pendingLength>backupLineLimit)throw Error('备份行过大。');const raw=pending.join('');pending=[];pendingLength=0;await line(raw);start=index+1;if(legacy){const rest=text.slice(start);legacyText+=rest;legacyBytes+=utf8.encode(rest).length;break;}}
  if(!legacy){const rest=text.slice(start);pending.push(rest);pendingLength+=rest.length;if(pendingLength>backupLineLimit)throw Error('备份行过大。');}
 }
 const tail=decoder.decode();if(legacy){legacyText+=tail;return decodeArchive(legacyText);}
 if(pendingLength||tail){const rest=pending.join('')+tail;if(!header)return decodeArchive(rest);throw Error('备份缺少完整的结束标记。');}
 if(!header||!ended)throw Error('备份不完整，未导入任何内容。');cancelled(signal);const snapshot=fullSnapshotSchema.parse({records,tasks});return {application:'whale-quill-stream',version:8,exportedAt:String((header as Record<string,unknown>).exportedAt),snapshot};
}
const taskDeleted=z.string().datetime({offset:true}).nullable();
export async function readBackupBlob(file:Blob,signal?:AbortSignal,onProgress?:(p:BackupProgress)=>void){async function* chunks(){// Blob.slice also works in the unit-test DOM and releases each bounded read.
 for(let offset=0;offset<file.size;offset+=256*1024){cancelled(signal);yield new Uint8Array(await file.slice(offset,offset+256*1024).arrayBuffer());}}
 return readBackupStream(chunks(),signal,onProgress);
}
