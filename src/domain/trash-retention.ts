export type RetentionDays=7|30|90|null;
export type TrashPolicy={days:RetentionDays;enabledAt:string};
export type TrashRetentionInfo={policy:TrashPolicy;entries:{kind:'record'|'task';id:string;expiresAt:string|null}[]};
export const retentionKey=(kind:string,id:string)=>`${kind}:${id}`;
export function retentionExpiry(deletedAt:string,startedAt:string,policy:TrashPolicy):string|null{
 if(policy.days===null)return null;
 const times=[deletedAt,startedAt,policy.enabledAt].map(Date.parse);if(times.some(time=>!Number.isFinite(time)))return null;
 return new Date(Math.max(...times)+policy.days*86_400_000).toISOString();
}
export function retentionDays(value:unknown):RetentionDays{if(value===null||value===7||value===30||value===90)return value;throw new Error('保留期限不正确');}
