export type Point={x:number;y:number};
export function validPoint(value:unknown):value is Point {
  return !!value&&typeof value==='object'&&['x','y'].every(key=>typeof (value as Record<string,unknown>)[key]==='number'&&Number.isFinite((value as Record<string,number>)[key])&&Math.abs((value as Record<string,number>)[key])<1_000_000);
}
export function clampPoint(point:Point,size:{width:number;height:number},viewport:{width:number;height:number}):Point {
  return {x:Math.max(8,Math.min(point.x,viewport.width-size.width-8)),y:Math.max(8,Math.min(point.y,viewport.height-size.height-8))};
}
export function nearAnchor(anchor:Point&{width:number;height:number},size:{width:number;height:number},viewport:{width:number;height:number}):Point {
  const above=anchor.y-size.height-12;
  return clampPoint({x:anchor.x+anchor.width-size.width,y:above>=8?above:anchor.y+anchor.height+12},size,viewport);
}
export type Rect=Point&{width:number;height:number};
// Prefer the closest usable position; large panels still keep their heading reachable.
export function avoidRects(point:Point,size:{width:number;height:number},viewport:{width:number;height:number},obstacles:Rect[]):Point {
  const origin=clampPoint(point,size,viewport),gap=8;
  const overlaps=(p:Point)=>obstacles.some(r=>p.x<r.x+r.width+gap&&p.x+size.width>r.x-gap&&p.y<r.y+r.height+gap&&p.y+size.height>r.y-gap);
  if(!overlaps(origin))return origin;
  const xs=[origin.x,8,viewport.width-size.width-8,...obstacles.flatMap(r=>[r.x-size.width-gap,r.x+r.width+gap])];
  const ys=[origin.y,8,viewport.height-size.height-8,...obstacles.flatMap(r=>[r.y-size.height-gap,r.y+r.height+gap])];
  return xs.flatMap(x=>ys.map(y=>clampPoint({x,y},size,viewport))).filter(p=>!overlaps(p)).sort((a,b)=>Math.hypot(a.x-origin.x,a.y-origin.y)-Math.hypot(b.x-origin.x,b.y-origin.y))[0]??origin;
}
