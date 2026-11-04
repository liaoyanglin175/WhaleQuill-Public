import type {NoteRecord} from './models';

export function tagName(value:string):string {
  return value.normalize('NFKC').trim().replace(/^#+/, '').trim().replace(/\s+/g,' ');
}
export function tagKey(value:string):string {return tagName(value).toLocaleLowerCase();}
export function parseTags(value:string):string[] {
  const seen=new Set<string>();
  return value.split(/[,，]/).map(tagName).filter(name=>{
    const key=tagKey(name);if(!key||seen.has(key))return false;seen.add(key);return true;
  });
}
export function hasTag(record:Pick<NoteRecord,'tags'>,tag:string):boolean {
  return record.tags.some(value=>tagKey(value)===tagKey(tag));
}
export function collectTags(records:NoteRecord[]):{name:string;count:number}[] {
  const tags=new Map<string,{name:string;count:number}>();
  for(const record of records){
    const seen=new Set<string>();
    for(const value of record.tags){
      const key=tagKey(value);if(!key||seen.has(key))continue;seen.add(key);
      const existing=tags.get(key);if(existing)existing.count++;else tags.set(key,{name:tagName(value),count:1});
    }
  }
  return [...tags.values()].sort((a,b)=>b.count-a.count||a.name.localeCompare(b.name));
}
