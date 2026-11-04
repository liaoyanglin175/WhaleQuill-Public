import {describe,it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {recallRecords} from '../../src/domain/recall';
import {recallNow,recallNotes,recallKeys,recallScenarios} from '../fixtures/recall-scenarios';

describe('找回表达对照',()=>{
 it('典型提问命中正确记录，排除同人物、不同时间和无关内容',()=>{
   const cases=recallScenarios.map(item=>{
     const actual=recallRecords(recallNotes,item.question,{now:recallNow}).map(result=>recallKeys.get(result.record.id)!);
     return {...item,actual,correct:[...actual].sort().join('|')===[...item.expected].sort().join('|')};
   });
   if(process.env.DAFEIYU_CAPTURE_RECALL){writeFileSync(`docs/evidence/0.2.6-recall-${process.env.DAFEIYU_CAPTURE_RECALL}.json`,JSON.stringify({now:new Date(recallNow).toISOString(),synthetic:true,cases,correct:cases.filter(item=>item.correct).length,total:cases.length},null,2)+'\n');}
   if(process.env.DAFEIYU_CAPTURE_RECALL==='before')return;
   for(const item of cases)expect(item.actual.sort(),item.question).toEqual([...item.expected].sort());
 });
});
