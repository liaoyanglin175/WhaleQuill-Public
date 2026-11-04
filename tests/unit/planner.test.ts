import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {createTask,encodeCompleteArchive,decodeArchive,taskSchema} from '../../src/domain/models';
import {blankPlannerDraft,buildPlannerTask} from '../../src/domain/planner-draft';
import {cleanupDue,completion,importedTask,isTodayEvent,nextPlannerDay} from '../../src/domain/planner';
import {BrowserRepository} from '../../src/storage/browser';

it('completion follows the next local calendar day; edits keep it and undo removes it',()=>{
 const now=new Date(2026,9,30,23,55),task=createTask('完成后清理');const done=completion({...task,status:'done'},task,now);
 expect(done.cleanupOn).toBe('2026-10-31');expect(cleanupDue(done,'2026-10-30')).toBe(false);expect(cleanupDue(done,'2026-10-31')).toBe(true);
 const edited=completion({...done,title:'名称更新'},done,new Date(2026,9,31,2));expect(edited.completedAt).toBe(done.completedAt);expect(edited.cleanupOn).toBe(done.cleanupOn);
 expect(completion({...done,status:'todo'},done).cleanupOn).toBeNull();expect(nextPlannerDay(new Date(2026,11,31,23))).toBe('2027-01-01');
});
it('legacy completed tasks receive a grace date without an invented completion timestamp',()=>{
 const legacy={...createTask('旧任务'),status:'done' as const};const value=importedTask(legacy,new Date(2026,9,30,8));expect(value.completedAt).toBeNull();expect(value.cleanupOn).toBe('2026-10-31');expect(importedTask(value,new Date(2026,10,1)).cleanupOn).toBe('2026-10-31');
});
it('events support all-day and overnight times and reject a backwards range or completion status',()=>{
 const draft={...blankPlannerDraft(),title:'夜间出行',date:'2026-10-30',allDay:false,startTime:'23:30',endDate:'2026-10-31',endTime:'01:00'};
 const event=buildPlannerTask(draft,'event');expect(isTodayEvent(event,'2026-10-30')).toBe(true);expect(isTodayEvent(event,'2026-10-31')).toBe(true);expect(isTodayEvent(event,'2026-11-01')).toBe(false);
 expect(()=>buildPlannerTask({...draft,endDate:'',endTime:'22:00'},'event')).toThrow('结束');expect(()=>taskSchema.parse({...event,status:'done'})).toThrow('行程');expect(cleanupDue(event,'2027-01-01')).toBe(false);
});
it('planner backup uses version 6 and round-trips event and completion information',()=>{
 const event=buildPlannerTask({...blankPlannerDraft(),title:'去看展',location:'美术馆'},'event');const done=completion({...createTask('已完成'),status:'done'},undefined,new Date(2026,9,30));
 const decoded=decodeArchive(encodeCompleteArchive({records:[],tasks:[{...event,deletedAt:null},{...done,deletedAt:null}]}));expect(decoded.version).toBe(6);if(decoded.version!==1)expect(decoded.snapshot.tasks).toEqual([{...event,deletedAt:null},{...done,deletedAt:null}]);
});
it('maintenance moves only due completed tasks to Trash and restore clears the cleanup plan',async()=>{
 const repo=new BrowserRepository('planner-'+crypto.randomUUID()),task=createTask('保留'),done=completion({...createTask('完成'),status:'done'},undefined,new Date(2020,0,1)),event=buildPlannerTask({...blankPlannerDraft(),title:'行程'},'event');
 await repo.mergeWorkspace({records:[],tasks:[task,done,event]});expect(await repo.maintainTasks()).toBe(true);const data=await repo.load();expect(data.tasks.map(task=>task.title).sort()).toEqual(['保留','行程']);expect((await repo.loadTrash())[0].kind).toBe('task');
 await repo.restore('task',done.id);const restored=(await repo.load()).tasks.find(task=>task.id===done.id)!;expect(restored.status).toBe('todo');expect(restored.completedAt).toBeNull();expect(restored.cleanupOn).toBeNull();expect(await repo.maintainTasks()).toBe(false);
});
