CREATE TABLE records (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    body TEXT NOT NULL,
    record_type TEXT NOT NULL CHECK (record_type IN ('note', 'work', 'diary')),
    tags_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE tasks (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('todo', 'done')),
    priority TEXT NOT NULL CHECK (priority IN ('normal', 'high')),
    due_date TEXT,
    source_record_id TEXT REFERENCES records(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX records_updated_at ON records(updated_at);
CREATE INDEX tasks_source_record ON tasks(source_record_id);
CREATE INDEX tasks_status_due_date ON tasks(status, due_date);
PRAGMA user_version = 1;
