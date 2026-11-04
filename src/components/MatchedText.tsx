export default function MatchedText({text,terms}:{text:string;terms:string[]}) {
  if(!terms.length)return <>{text}</>;
  const pattern=new RegExp(`(${terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')})`,'giu');
  return <>{text.split(pattern).map((part,index)=>index%2?<mark key={index}>{part}</mark>:part)}</>;
}
