import {useLayoutEffect,useRef,useState,type RefObject,type PointerEvent,type KeyboardEvent,type CSSProperties} from 'react';
import {clampPoint,nearAnchor,validPoint,avoidRects,type Point} from '../domain/floating-position';

export function useFloatingTool<T extends HTMLElement>({element,key,active,anchor,avoid}:{element:RefObject<T|null>;key:string;active:boolean;anchor?:(Point&{width:number;height:number})|null;avoid?:string}){
  const [manual,setManual]=useState<Point|null>(()=>{try{const value=JSON.parse(localStorage.getItem(key)??'null');return validPoint(value)?value:null;}catch{return null;}});
  const [size,setSize]=useState({width:0,height:0}),[viewport,setViewport]=useState({width:innerWidth,height:innerHeight});
  const gesture=useRef<{id:number;x:number;y:number;start:Point}|null>(null),moved=useRef(false),latest=useRef(manual);
  const bounds=(value:Point)=>{
    const obstacles=avoid?[...document.querySelectorAll<HTMLElement>(avoid)].filter(node=>node.getClientRects().length&&!element.current?.contains(node)).map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}):[];
    return avoidRects(value,{width:element.current?.offsetWidth??size.width,height:element.current?.offsetHeight??size.height},{width:innerWidth,height:innerHeight},obstacles);
  };
  const persist=(value:Point|null)=>{try{if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);}catch{/* Position persistence must not interrupt writing. */}};
  useLayoutEffect(()=>{latest.current=manual;persist(manual);},[manual,key]);
  const point=manual?clampPoint(manual,size,viewport):anchor?nearAnchor(anchor,size,viewport):null;
  useLayoutEffect(()=>{
    if(!active||!element.current)return;
    const measure=()=>{const node=element.current;if(!node)return;setSize(previous=>previous.width===node.offsetWidth&&previous.height===node.offsetHeight?previous:{width:node.offsetWidth,height:node.offsetHeight});setViewport(previous=>previous.width===innerWidth&&previous.height===innerHeight?previous:{width:innerWidth,height:innerHeight});setManual(previous=>{if(!previous)return null;const next=bounds(previous);return previous.x===next.x&&previous.y===next.y?previous:next;});};
    let frame=0;const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(measure);};
    measure();const observer=new ResizeObserver(schedule);observer.observe(element.current);const layout=avoid?new MutationObserver(schedule):null;
    layout?.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden','class']});
    window.addEventListener('resize',schedule);return()=>{cancelAnimationFrame(frame);observer.disconnect();layout?.disconnect();window.removeEventListener('resize',schedule);};
  },[active,avoid]);
  function reset(){latest.current=null;setManual(null);}
  function end(event:PointerEvent<HTMLElement>){if(!gesture.current||gesture.current.id!==event.pointerId)return;gesture.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}
  const drag={
    onPointerDown(event:PointerEvent<HTMLElement>){if(!active||event.button!==0)return;const target=event.target as Element,control=target.closest('button,input,select,a');if(control&&control!==event.currentTarget&&!control.hasAttribute('data-floating-grip'))return;
      event.preventDefault();const rect=element.current!.getBoundingClientRect();moved.current=false;gesture.current={id:event.pointerId,x:event.clientX,y:event.clientY,start:{x:rect.left,y:rect.top}};event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove(event:PointerEvent<HTMLElement>){const drag=gesture.current;if(!drag||drag.id!==event.pointerId)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;if(!moved.current&&Math.hypot(dx,dy)<6)return;event.preventDefault();moved.current=true;latest.current=bounds({x:drag.start.x+dx,y:drag.start.y+dy});setManual(latest.current);},
    onPointerUp:end,onPointerCancel:end,
  };
  function keyboard(event:KeyboardEvent<HTMLElement>){if(!active)return;const delta:Record<string,Point>={ArrowLeft:{x:-1,y:0},ArrowRight:{x:1,y:0},ArrowUp:{x:0,y:-1},ArrowDown:{x:0,y:1}};if(event.key==='Home'){event.preventDefault();event.stopPropagation();reset();return;}const movement=delta[event.key];if(!movement)return;event.preventDefault();event.stopPropagation();const rect=element.current!.getBoundingClientRect(),step=event.shiftKey?32:8;latest.current=bounds({x:rect.left+movement.x*step,y:rect.top+movement.y*step});setManual(latest.current);}
  return {manual,point,size,drag,keyboard,reset,consumeClick(){const value=moved.current;moved.current=false;return value;},style:active&&point?{left:point.x,top:point.y,right:'auto',bottom:'auto'} as CSSProperties:undefined};
}
