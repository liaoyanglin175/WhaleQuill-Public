ALTER TABLE records ADD COLUMN deleted_at TEXT;
ALTER TABLE tasks ADD COLUMN deleted_at TEXT;
CREATE INDEX records_deleted_at ON records(deleted_at);
CREATE INDEX tasks_deleted_at ON tasks(deleted_at);
CREATE TABLE recovery_drafts (
    id TEXT PRIMARY KEY NOT NULL,
    record_json TEXT NOT NULL,
    saved_at TEXT NOT NULL
);
PRAGMA user_version = 2;
