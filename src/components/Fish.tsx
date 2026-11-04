export type FishMood='idle'|'happy'|'pout'|'sleep';
export default function Fish({className=''}:{className?:string;mood?:FishMood}) {return <span className={`fixed-whale-portrait ${className}`} aria-hidden="true"><img src="/mascot/dafeiyu/poster.png" alt=""/></span>;}
