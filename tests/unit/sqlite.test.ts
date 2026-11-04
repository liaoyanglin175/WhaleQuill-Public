import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../src-tauri/migrations/001_initial.sql', import.meta.url), 'utf8');
const trashMigration = readFileSync(new URL('../../src-tauri/migrations/002_trash.sql', import.meta.url), 'utf8');
function database() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON; BEGIN;');
  db.exec(migration);
  db.exec('COMMIT;');
  return db;
}

describe('桌面 SQLite 迁移的数据约束', () => {
  it('v1 旧库升级保留正文和任务原始关联，删除标记可恢复', () => {
    const db = database();
    try {
      db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run('record-1', '旧库笔记', '旧正文', 'work', '["标签"]', 'now', 'now');
      db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('task-1', '原任务', 'done', 'high', null, 'record-1', 'now', 'now');
      db.exec('BEGIN;'); db.exec(trashMigration); db.exec('COMMIT;');
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 2 });
      expect(db.prepare('SELECT title,body,deleted_at FROM records').get()).toMatchObject({ title: '旧库笔记', body: '旧正文', deleted_at: null });
      db.prepare('UPDATE records SET deleted_at=?').run('2026-10-26T01:00:00Z');
      expect(db.prepare('SELECT source_record_id,status,priority FROM tasks').get()).toMatchObject({ source_record_id: 'record-1', status: 'done', priority: 'high' });
    } finally { db.close(); }
  });
  it('设置迁移版本并在删除来源时保留任务', () => {
    const db = database();
    try {
      expect(db.prepare('PRAGMA user_version').get()).toMatchObject({ user_version: 1 });
      db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run('record-1', '论文', '正文', 'work', '[]', 'now', 'now');
      db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('task-1', '继续实验', 'todo', 'normal', null, 'record-1', 'now', 'now');
      db.prepare('DELETE FROM records WHERE id=?').run('record-1');
      expect(db.prepare('SELECT source_record_id,title FROM tasks').get()).toMatchObject({ source_record_id: null, title: '继续实验' });
      expect(() => db.prepare('UPDATE tasks SET status=?').run('unknown')).toThrow();
    } finally { db.close(); }
  });
  it('外键错误时能够回滚整批写入', () => {
    const db = database();
    try {
      db.exec('BEGIN;');
      db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?)').run('record-1', '不应保留', '', 'note', '[]', 'now', 'now');
      expect(() => db.prepare('INSERT INTO tasks VALUES (?,?,?,?,?,?,?,?)').run('task-1', '任务', 'todo', 'normal', null, 'missing', 'now', 'now')).toThrow();
      db.exec('ROLLBACK;');
      expect(db.prepare('SELECT COUNT(*) AS total FROM records').get()).toMatchObject({ total: 0 });
    } finally { db.close(); }
  });
});
