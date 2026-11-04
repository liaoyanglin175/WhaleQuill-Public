CREATE TABLE trash_policy (
 id INTEGER PRIMARY KEY CHECK(id=1),
 days INTEGER CHECK(days IS NULL OR days IN(7,30,90)),
 enabled_at TEXT NOT NULL
);
INSERT INTO trash_policy VALUES(1,30,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
CREATE TABLE trash_retention (
 kind TEXT NOT NULL CHECK(kind IN('record','task')),
 item_id TEXT NOT NULL,
 started_at TEXT NOT NULL,
 PRIMARY KEY(kind,item_id)
);
INSERT INTO trash_retention SELECT 'record',id,(SELECT enabled_at FROM trash_policy) FROM records WHERE deleted_at IS NOT NULL;
INSERT INTO trash_retention SELECT 'task',id,(SELECT enabled_at FROM trash_policy) FROM tasks WHERE deleted_at IS NOT NULL;
CREATE TABLE purged_items(kind TEXT NOT NULL,item_id TEXT NOT NULL,PRIMARY KEY(kind,item_id));
PRAGMA user_version = 8;
