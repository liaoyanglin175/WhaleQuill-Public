import { useEffect,useLayoutEffect,useRef,useState } from 'react';
import { getCharacter } from '../companion/catalog';
import type { CharacterId,Mood,Outfit } from '../companion/catalog';

const decodedAtlases=new Map<string,Promise<HTMLImageElement>>();
function loadAtlas(src:string):Promise<HTMLImageElement> {
  let pending=decodedAtlases.get(src);
  if(!pending){const image=new Image();image.decoding='async';image.src=src;pending=image.decode().then(()=>image).catch(error=>{decodedAtlases.delete(src);throw error;});decodedAtlases.set(src,pending);}
  return pending;
}

export default function CharacterSprite({character='lanxi',outfit='dress',mood='idle',walking=false,direction='right',reduced=false,className=''}:{character?:CharacterId;outfit?:Outfit;mood?:Mood;walking?:boolean;direction?:'left'|'right';reduced?:boolean;className?:string}) {
  const [step,setStep]=useState(0),[decoded,setDecoded]=useState<{src:string;image:HTMLImageElement}|null>(null),[painted,setPainted]=useState('');const canvas=useRef<HTMLCanvasElement>(null),atlas=getCharacter(character).costumes[outfit].atlas;
  useEffect(()=>{setStep(0);if(!walking||reduced)return;const timer=setInterval(()=>setStep(current=>1-current),280);return()=>clearInterval(timer);},[walking,reduced,character,outfit]);
  useEffect(()=>{let cancelled=false;void loadAtlas(atlas.src).then(image=>{if(!cancelled)setDecoded({src:atlas.src,image});}).catch(()=>{if(!cancelled)setDecoded(null);});return()=>{cancelled=true;};},[atlas.src]);
  const frame=walking&&!reduced?step+1:mood==='happy'?3:mood==='pout'?4:mood==='sleep'?5:0;
  const imageReady=decoded?.src===atlas.src,paintKey=`${atlas.src}:${atlas.rows}:${atlas.rowOffset}:${frame}`,loaded=imageReady&&painted===paintKey;
  useLayoutEffect(()=>{
    const surface=canvas.current;if(!surface||!imageReady||!decoded)return;let cancelled=false,revision=0;
    const draw=()=>{
      const request=++revision;setPainted('');
      const rect=surface.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
      const width=Math.max(1,Math.round(rect.width*ratio)),height=Math.max(1,Math.round(rect.height*ratio));
      const cellWidth=decoded.image.naturalWidth/3,cellHeight=decoded.image.naturalHeight/atlas.rows;
      // Resize the source frame once at high quality, then paint 1:1 into physical pixels.
      // Both CSS background scaling and drawImage minification can use a softer cached mipmap.
      void createImageBitmap(decoded.image,Math.round((frame%3)*cellWidth),Math.round((Math.floor(frame/3)+atlas.rowOffset)*cellHeight),Math.round(cellWidth),Math.round(cellHeight),{resizeWidth:width,resizeHeight:height,resizeQuality:'high'}).then(bitmap=>{
        try{
          if(cancelled||request!==revision)return;
          if(surface.width!==width)surface.width=width;if(surface.height!==height)surface.height=height;
          const context=surface.getContext('2d');if(!context)return;
          context.clearRect(0,0,width,height);context.imageSmoothingEnabled=false;context.drawImage(bitmap,0,0);setPainted(paintKey);
        }finally{bitmap.close();}
      }).catch(()=>{if(!cancelled&&request===revision)setPainted('');});
    };
    draw();const observer=new ResizeObserver(draw);observer.observe(surface);
    let resolution:MediaQueryList;
    const watchResolution=()=>{resolution?.removeEventListener('change',changed);resolution=matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);resolution.addEventListener('change',changed);};
    const changed=()=>{draw();watchResolution();};watchResolution();window.addEventListener('resize',draw);
    return()=>{cancelled=true;observer.disconnect();resolution.removeEventListener('change',changed);window.removeEventListener('resize',draw);};
  },[imageReady,decoded,frame,atlas.rows,atlas.rowOffset,paintKey]);
  return <canvas ref={canvas} className={`character-sprite ${walking&&!reduced?'is-stepping':''} ${className}`} aria-hidden="true" data-character={character} data-outfit={outfit} data-frame={frame} data-loaded={loaded} data-rendering="3d-rendered-sprite" style={{opacity:loaded?1:0,transform:walking&&direction==='left'?'scaleX(-1)':undefined}} />;
}
