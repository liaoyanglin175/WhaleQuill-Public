import {Tag,X} from 'lucide-react';
import {useI18n} from '../i18n';
import {tagKey,tagName} from '../domain/tags';
import TagActions from './TagActions';
import {useState} from 'react';

export function RecordTags({tags,onTag,onChange,disabled=false}:{tags:string[];onTag:(tag:string)=>void;onChange?:(tag:string,next:string|null)=>string|null;disabled?:boolean}) {
  const {t}=useI18n();
  const [expanded,setExpanded]=useState(false);
  const unique=[...new Map(tags.map(tag=>[tagKey(tag),tagName(tag)])).values()];
  if(!unique.length)return null;
  return <div className="record-tags" aria-label={t('关联标签')}>{(expanded?unique:unique.slice(0,6)).map(tag=><span className="record-tag" key={tagKey(tag)}><button className="tag-link" aria-label={t('查看标签：{0}',tag)} title={t('查看标签：{0}',tag)} onClick={()=>onTag(tag)}><span aria-hidden="true">#</span>{tag}</button>{onChange&&<TagActions tag={tag} disabled={disabled} onChange={onChange}/>}</span>)}{unique.length>6&&<button className="text-button tag-expand" aria-expanded={expanded} onClick={()=>setExpanded(!expanded)}>{expanded?t('收起'):t('还有 {0} 个',unique.length-6)}</button>}</div>;
}

export function TagFilter({tags,value,onChange,disabled=false}:{tags:{name:string;count:number}[];value:string|null;onChange:(tag:string|null)=>void;disabled?:boolean}) {
  const {t}=useI18n();
  return <label className="tag-filter"><Tag size={14}/><span>{t('关联标签')}</span><select aria-label={t('按标签查看记录')} value={value?tagKey(value):''} disabled={disabled} onChange={event=>onChange(tags.find(tag=>tagKey(tag.name)===event.target.value)?.name??null)}><option value="">{t('全部标签')}</option>{tags.map(tag=><option key={tagKey(tag.name)} value={tagKey(tag.name)}>{tag.name} ({tag.count})</option>)}</select></label>;
}

export function ActiveTag({value,onClear,disabled=false}:{value:string|null;onClear:()=>void;disabled?:boolean}) {
  const {t}=useI18n();
  return value?<div className="active-tag" role="status"><Tag size={13}/><span>{value}</span><button className="icon-button" aria-label={t('退出标签筛选')} disabled={disabled} onClick={onClear}><X size={13}/></button></div>:null;
}
