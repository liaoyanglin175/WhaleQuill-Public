import { afterEach,describe,expect,it,vi } from 'vitest';
import { characters,getCharacter } from '../../src/companion/catalog';
import { clampPoint,clearRoute,nextDestination } from '../../src/companion/movement';
import { companionKey,readCompanion } from '../../src/companion/preferences';
import { translate } from '../../src/i18n';
afterEach(()=>vi.unstubAllGlobals());
describe('小角色与记录空间',()=>{
 it('首次默认56px大肥鱼，错误偏好不会产生超大角色',()=>{vi.stubGlobal('localStorage',{getItem:()=>'{bad'});expect(readCompanion()).toMatchObject({size:56,character:'lanxi',visible:true});vi.stubGlobal('localStorage',{getItem:(key:string)=>key===companionKey?JSON.stringify({size:500,character:'unknown'}):null});expect(readCompanion()).toMatchObject({size:72,character:'lanxi'});});
 it('旧角色与服装偏好迁移成固定大肥鱼，同时保留位置和活动设置',()=>{vi.stubGlobal('localStorage',{getItem:()=>JSON.stringify({size:2,character:'lumi',outfit:'casual',renderer:'3d',wandering:false,visible:false,position:{x:4,y:5}})});expect(readCompanion()).toEqual({size:40,character:'lanxi',outfit:'dress',wandering:false,visible:false,reduced:false,recordReplies:true,onlineReplies:false,position:{x:4,y:5}});});
 it('固定一个大肥鱼，不再提供其他形象或换装',()=>{expect(characters).toHaveLength(1);expect(Object.keys(getCharacter('lanxi').costumes)).toEqual(['dress']);expect(getCharacter('lanxi').name.zh).toBe('大肥鱼');});
 it('缩放和移动后角色始终留在窗口内',()=>{expect(clampPoint({x:1000,y:-10},390,844,56)).toEqual({x:326,y:8});expect(clampPoint({x:-50,y:1000},390,844,56)).toEqual({x:8,y:780});});
 it('路径途中遇到输入框也会拒绝，不只检查落点',()=>{const obstacle={x:110,y:20,width:50,height:200};expect(clearRoute({x:10,y:40},{x:220,y:40},56,[obstacle])).toBe(false);expect(clearRoute({x:10,y:270},{x:220,y:270},56,[obstacle])).toBe(true);});
 it('没有可行路径就保持原位，不强行穿过按钮',()=>{expect(nextDestination({x:30,y:100},390,844,56,[{x:0,y:0,width:390,height:844}],()=>.9)).toBeNull();});
});
describe('双语界面与原文边界',()=>{
 it('翻译界面及保存错误，保留参数中的用户标题原话',()=>{expect(translate('保存记录','en')).toBe('Save');expect(translate('保存记录','zh')).toBe('保存记录');expect(translate('恢复记录：{0}','en','保存记录')).toBe('Restore note: 保存记录');expect(translate('保存失败：磁盘不可用。内容仍在编辑器中，请重试。','en')).toContain('Your edits are still here');});
 it('时间分组随语言显示，不改动原始日期和未知正文',()=>{expect(translate('2026 年 10 月','en')).toBe('October 2026');expect(translate('用户自己写的内容','en')).toBe('用户自己写的内容');});
});
