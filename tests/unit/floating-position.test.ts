import {describe,it,expect} from 'vitest';
import {clampPoint,nearAnchor,validPoint,avoidRects} from '../../src/domain/floating-position';
import {withoutInlineTags,documentTags} from '../../src/domain/inline-tags';
import {plainDocument,documentText} from '../../src/domain/rich-document';

describe('浮动工具的可达性与旧标签原稿',()=>{
 it('floating controls avoid protected actions while staying inside resized windows',()=>{
  const size={width:110,height:38},obstacles=[{x:650,y:520,width:98,height:36},{x:400,y:520,width:90,height:36}];
  for(const viewport of [{width:780,height:620},{width:780,height:560}]){
   const p=avoidRects({x:650,y:520},size,viewport,obstacles);expect(p.x).toBeGreaterThanOrEqual(8);expect(p.y+size.height).toBeLessThanOrEqual(viewport.height-8);
   for(const r of obstacles)expect(p.x+size.width<=r.x-8||p.x>=r.x+r.width+8||p.y+size.height<=r.y-8||p.y>=r.y+r.height+8).toBe(true);
  }
  expect(avoidRects({x:20,y:30},size,{width:780,height:620},obstacles)).toEqual({x:20,y:30});
 });
 it('拒绝损坏和无限的持久化坐标',()=>{for(const value of [null,{x:NaN,y:4},{x:Infinity,y:0},{x:'1',y:2},{x:1e9,y:3}])expect(validPoint(value)).toBe(false);expect(validPoint({x:0,y:100})).toBe(true);});
 it('缩小窗口后保留整个工具，超大工具仍可触及标题栏',()=>{expect(clampPoint({x:900,y:800},{width:360,height:420},{width:390,height:600})).toEqual({x:22,y:172});expect(clampPoint({x:-60,y:99},{width:400,height:700},{width:300,height:400})).toEqual({x:8,y:8});});
 it('移动入口后工具优先向上展开，顶部入口则向下展开',()=>{const size={width:300,height:200},viewport={width:800,height:600};expect(nearAnchor({x:700,y:500,width:80,height:30},size,viewport)).toEqual({x:480,y:288});expect(nearAnchor({x:10,y:10,width:80,height:30},size,viewport)).toEqual({x:8,y:52});});
 it('旧关联移除不删除#或用户样式，不修改原文档和块ID',()=>{const document=plainDocument('#旧标签');document.content[0].attrs={id:'original-block'};document.content[0].content![0].marks=[{type:'tag',attrs:{id:'88445bbc-9831-42c2-a218-e68079fe91fd'}},{type:'bold'},{type:'textStyle',attrs:{color:'#315eab'}}];const before=JSON.stringify(document),next=withoutInlineTags(document);expect(documentText(next)).toBe('#旧标签');expect(next.content[0].attrs?.id).toBe('original-block');expect(next.content[0].content![0].marks).toEqual([{type:'bold'},{type:'textStyle',attrs:{color:'#315eab'}}]);expect(documentTags(next)).toEqual([]);expect(JSON.stringify(document)).toBe(before);});
});
