import type { Point } from './preferences';
export type Rect={x:number;y:number;width:number;height:number};
export function clampPoint(point:Point,width:number,height:number,size:number):Point {return {x:Math.round(Math.max(8,Math.min(point.x,width-size-8))),y:Math.round(Math.max(8,Math.min(point.y,height-size-8)))};}
export function edgeSpots(width:number,height:number,size:number):Point[]{
 const spots:Point[]=[];for(let x=8;x<=width-size-8;x+=4){spots.push({x,y:8},{x,y:height-size-8});}
 for(let y=8;y<=height-size-8;y+=12)spots.push({x:8,y},{x:width-size-8,y});return spots;
}
function overlaps(point:Point,size:number,rect:Rect):boolean{return point.x<rect.x+rect.width+6&&point.x+size>rect.x-6&&point.y<rect.y+rect.height+6&&point.y+size>rect.y-6;}
export function clearRoute(from:Point,to:Point,size:number,obstacles:Rect[]):boolean {
  const steps=Math.max(1,Math.ceil(Math.hypot(to.x-from.x,to.y-from.y)/12));
  for(let i=0;i<=steps;i++){const point={x:from.x+(to.x-from.x)*i/steps,y:from.y+(to.y-from.y)*i/steps};if(obstacles.some(rect=>overlaps(point,size,rect)))return false;}return true;
}
export function nextDestination(from:Point,width:number,height:number,size:number,obstacles:Rect[],random= Math.random):Point|null {
  for(let attempt=0;attempt<18;attempt++){const point=clampPoint({x:from.x+(random()-.5)*300,y:from.y+(random()-.5)*200},width,height,size);if(Math.hypot(point.x-from.x,point.y-from.y)>30&&clearRoute(from,point,size,obstacles))return point;}return null;
}
