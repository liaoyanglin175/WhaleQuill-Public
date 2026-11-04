import {describe,it,expect} from 'vitest';
import {activityDelay,chooseAction,touchActions,autonomousActions} from '../../src/companion/actions';
import {companionReply} from '../../src/companion/replies';
import {createRecord} from '../../src/domain/models';

describe('伙伴活动与回应',()=>{
  it('四种自主活动、六种点击动作，随机选择避开最近两次',()=>{
    expect(autonomousActions).toHaveLength(4);expect(touchActions).toHaveLength(6);
    const recent:string[]=[];for(let i=0;i<30;i++){const action=chooseAction<string>(touchActions,recent,()=>i/30);expect(recent.slice(-2)).not.toContain(action);recent.push(action);}
  });
  it('活动间隔在8到15秒之间',()=>{expect(activityDelay(()=>0)).toBe(8000);expect(activityDelay(()=>.99999)).toBeLessThanOrEqual(15000);});
  it('结合当前已保存内容给出有依据的回应，并避开最近台词',()=>{
    const record={...createRecord(),body:'今天要记英语单词。'};const first=companionReply(record,'zh',[],()=>0);expect(first.source).toBe(true);expect(first.text).toContain('今天要记英语单词');
    const second=companionReply(record,'zh',[first.text],()=>0);expect(second.text).not.toBe(first.text);
    expect(companionReply(null,'en',[],()=>0)).toEqual({text:'Here with you.',source:false});
  });
});
