import type {NoteRecord} from '../domain/models';

export function companionReply(record:NoteRecord|null,language:'zh'|'en',recent:string[],random=Math.random){
  const base=language==='en'?['Here with you.','Take your time.','One thought at a time.','A little pause is fine.','Still here, keeping you company.']:['我在呀。','慢慢写，不着急。','想到哪儿，写到哪儿。','歇一小会儿也可以。','陪你待一会儿。'];
  const candidates=base.map(text=>({text,source:false}));
  if(record){
    const text=record.highlights.find(item=>!item.stale)?.text??record.body.trim().split(/\r?\n/).find(Boolean)??'';
    const quote=Array.from(text.trim()).slice(0,24).join('');
    if(quote){
      const related=language==='en'?[`“${quote}” — I noticed that line.`,`We can stay with “${quote}” for a moment.`,`Your note is here whenever you want to return to it.`]:[`你写的「${quote}」，我看见啦。`,`「${quote}」这句，慢慢想也没关系。`,'刚才记下的事，可以留着以后再看看。'];
      if(/单词|英语|vocabulary|english|study/i.test(record.body))related.push(...(language==='en'?['One word at a time. I’ll keep you company.','A small bit of practice counts too.']:['今天的单词，咱们一个个来。','先记住一个，也算有进展。','记累了就缓一缓，我在旁边。']));
      candidates.unshift(...related.map(text=>({text,source:true})));
    }
  }
  const available=candidates.filter(item=>!recent.slice(-3).includes(item.text));
  const pool=available.length?available:candidates;
  return pool[Math.min(pool.length-1,Math.floor(random()*pool.length))];
}
