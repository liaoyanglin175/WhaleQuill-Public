import type { Rect } from './movement';
// Closed details retain layout boxes in Chromium; they must not block a route.
export function visibleObstacles(exclude:HTMLElement|null):Rect[] {
 return [...document.querySelectorAll<HTMLElement>('textarea,input,select,button,a,summary,[role="toolbar"],[contenteditable="true"],dialog[open],h1,h2,h3,h4,p,blockquote,.app-footer,.storage-status,.version,.note-inquiry')].filter(element=>{
  if(exclude?.contains(element)||element.closest('#companion-slot'))return false;
  if(typeof element.checkVisibility==='function'&&!element.checkVisibility())return false;
  for(let parent=element.parentElement;parent;parent=parent.parentElement)if(parent instanceof HTMLDetailsElement&&!parent.open&&!parent.querySelector(':scope > summary')?.contains(element))return false;
  const style=getComputedStyle(element);return style.visibility!=='hidden'&&style.display!=='none';
 }).map(element=>element.getBoundingClientRect()).filter(rect=>rect.width>1&&rect.height>1&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth).map(rect=>({x:rect.x,y:rect.y,width:rect.width,height:rect.height}));
}
