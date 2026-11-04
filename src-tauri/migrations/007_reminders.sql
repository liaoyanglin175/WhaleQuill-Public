CREATE TABLE reminder_plans (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
 due_key TEXT NOT NULL,
 due_at INTEGER NOT NULL,
 first_at INTEGER NOT NULL,
 second_at INTEGER NOT NULL,
 sent_mask INTEGER NOT NULL DEFAULT 0 CHECK(sent_mask BETWEEN 0 AND 3),
 last_sent_at INTEGER
);
PRAGMA user_version = 7;
CREATE TABLE creation_batches (
 request_id TEXT PRIMARY KEY,
 result_json TEXT NOT NULL CHECK(json_valid(result_json)),
 proposal_json TEXT NOT NULL CHECK(json_valid(proposal_json)),
 undone INTEGER NOT NULL DEFAULT 0 CHECK(undone IN (0,1))
);
