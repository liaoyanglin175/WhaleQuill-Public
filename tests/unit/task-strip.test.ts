import 'fake-indexeddb/auto';
import {expect,it} from 'vitest';
import {createTask} from '../../src/domain/models';
import {BrowserRepository} from '../../src/storage/browser';
import {retainRows,taskOrder} from '../../src/tasks/model';
import {isTaskOverdue} from '../../src/domain/reminders';
import {taskGroup} from '../../src/domain/planner';

it('same-day deadlines sort by time, preserve importance and share the overdue boundary',()=>{
 const now=new Date(2026,10,1,12).getTime(),early={...createTask('较早','2026-11-01'),dueTime:'09:00',createdAt:'2026-10-31T00:00:00Z'},late={...createTask('较晚','2026-11-01'),dueTime:'18:00',createdAt:'2026-11-01T00:00:00Z'},undated=createTask('无日期',null);
 expect([late,undated,early].sort(taskOrder).map(x=>x.title)).toEqual(['较早','较晚','无日期']);
 expect([{...undated,priority:'high' as const},early].sort(taskOrder)[0].title).toBe('无日期');
 expect(taskGroup(early,now)).toBe('逾期');expect(isTaskOverdue(early,now)).toBe(true);expect(taskGroup(late,now)).toBe('今天');
 const deadline=new Date('2026-11-01T18:00').getTime();expect(isTaskOverdue(late,deadline-1)).toBe(false);expect(taskGroup(late,deadline)).toBe('逾期');
 expect(isTaskOverdue({...early,status:'done'},now)).toBe(false);expect(taskGroup(undated,now)).toBe('未定日期');
});
it('legacy date-only tasks use the same 23:59 deadline as reminders',()=>{
 const task={...createTask('旧任务','2026-11-01'),dueTime:null};
 expect(taskGroup(task,new Date(2026,10,1,23,58).getTime())).toBe('今天');
 expect(taskGroup(task,new Date(2026,10,1,23,59).getTime())).toBe('逾期');
});

it('completed rows retain their position until the next appearance, new tasks join and deleted tasks leave',()=>{
  const first=createTask('先做',null),second=createTask('再做','2026-10-30'),third={...createTask('重要',null),priority:'high' as const};
  const initial=retainRows([],[first,second,third]);expect(initial).toEqual([third.id,second.id,first.id]);
  const done={...third,status:'done' as const};expect(retainRows(initial,[first,second,done])).toEqual(initial);
  expect(retainRows([],[first,second,done])).toEqual([second.id,first.id]);
  const added=createTask('后来加入',null);expect(retainRows(initial,[first,done,added])).toEqual([third.id,first.id,added.id]);
  expect(taskOrder(second,first)).toBeLessThan(0);
});
it('a stale task editor cannot overwrite a completion saved from another window',async()=>{
  const name=`strip-${crypto.randomUUID()}`,repo=new BrowserRepository(name),other=new BrowserRepository(name);
  const task={...createTask('原名称',null),updatedAt:'2026-10-28T10:00:00.000Z'};await repo.saveTask(task);
  await other.saveTask({...task,status:'done',updatedAt:'2026-10-29T11:00:00.000Z'},task.updatedAt);
  await expect(repo.saveTask({...task,title:'旧编辑器的内容'},task.updatedAt)).rejects.toThrow('任务已变化');
  expect((await repo.load()).tasks[0]).toMatchObject({title:'原名称',status:'done'});
});
