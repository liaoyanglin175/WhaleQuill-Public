import {parseRecallQuery} from '../domain/recall-query';
import {useI18n} from '../i18n';
export default function RecallClues({question,now,tags=[],relaxed=false}:{question:string;now:number;tags?:string[];relaxed?:boolean}){
 const {t}=useI18n(),query=parseRecallQuery(question,now,tags);
 if(query.error)return <p className="recall-query-error" role="alert">{t(query.error)}</p>;
 if(!query.time&&!query.tags.length&&!query.required.length&&!query.relation&&!relaxed)return null;
 return <div className="recall-clues" aria-label={t('本次查找线索')}>{query.time&&<span>{t('记录时间：{0}',query.time.label)}</span>}{(relaxed?query.quoted:query.required).map(value=><span key={value}>{t('文字线索：{0}',value)}</span>)}{query.tags.map(value=><span key={value}>#{value}</span>)}{!relaxed&&query.relation&&<span>{t(query.relation.direction==='received'?'往来：收到':'往来：发出')}</span>}{relaxed&&<span>{t('已放宽人物与词组线索，时间和标签仍保留。')}</span>}</div>;
}
