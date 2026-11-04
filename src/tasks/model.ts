import type {Task} from '../domain/models';
import {taskDeadline} from '../domain/reminders';

export function taskOrder(a:Task,b:Task):number {
  return Number(b.priority==='high')-Number(a.priority==='high') || (taskDeadline(a)??Number.MAX_SAFE_INTEGER)-(taskDeadline(b)??Number.MAX_SAFE_INTEGER) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}
// Rows completed during this appearance stay where the user checked them.
export function retainRows(ids:string[],tasks:Task[]):string[] {
  tasks=tasks.filter(task=>task.kind==='task');
  const existing=new Set(tasks.map(task=>task.id));
  const next=ids.filter(id=>existing.has(id));
  const known=new Set(next);
  return [...next,...tasks.filter(task=>task.status==='todo'&&!known.has(task.id)).sort(taskOrder).map(task=>task.id)];
}
