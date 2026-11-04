export type CharacterId='lanxi';
export type Outfit='dress';
export type Mood='idle'|'happy'|'pout'|'sleep';
export type Languages={zh:string;en:string};
export type Atlas={src:string;rows:number;rowOffset:number};
export type Character={id:CharacterId;name:Languages;personality:Languages;speed:number;rest:number;costumes:Record<Outfit,{name:Languages;atlas:Atlas}>;lines:Record<'ask'|'saved'|'pat'|'pout'|'wake',Languages>};
const dafeiyu:Character={id:'lanxi',name:{zh:'大肥鱼',en:'Dafeiyu'},personality:{zh:'安静陪你记着',en:'Here with your thoughts'},speed:17,rest:35_000,costumes:{dress:{name:{zh:'女仆装',en:'Maid'},atlas:{src:'/mascot/lanxi-dress-atlas.png',rows:2,rowOffset:0}}},lines:{ask:{zh:'这段要收好吗？',en:'Keep this thought?'},saved:{zh:'收好啦。',en:'Saved.'},pat:{zh:'我在呀。',en:'I am here.'},pout:{zh:'轻一点点。',en:'Gently, please.'},wake:{zh:'醒啦。',en:'Awake.'}}};
export const characters=[dafeiyu];
export const getCharacter=(_id:CharacterId)=>dafeiyu;
