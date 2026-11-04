import {describe,it,expect} from 'vitest';
import {createRecord} from '../../src/domain/models';
import {collectTags,hasTag,parseTags} from '../../src/domain/tags';

describe('关联标签',()=>{
  it('整理全半角、重复项与大小写，保留标签显示名称',()=>{
    expect(parseTags(' #旅行，旅行, ＡＩ ,ai,  小林  ')).toEqual(['旅行','AI','小林']);
  });
  it('只匹配实际标签，不混入正文关键词或相似前缀',()=>{
    const record={...createRecord(),body:'这篇正文提到了旅行',tags:['AI设计','小林']};
    expect(hasTag(record,'旅行')).toBe(false);expect(hasTag(record,'AI')).toBe(false);
    expect(hasTag(record,'ａｉ设计')).toBe(true);
  });
  it('一篇多标签归入多个话题，同一篇不重复计数',()=>{
    const records=[{...createRecord(),tags:['旅行','小林','旅行']},{...createRecord(),tags:['旅行']}];
    expect(collectTags(records)).toEqual([{name:'旅行',count:2},{name:'小林',count:1}]);
  });
});
