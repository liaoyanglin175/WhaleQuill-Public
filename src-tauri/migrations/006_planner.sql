ALTER TABLE tasks ADD COLUMN planner_json TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(planner_json));
CREATE INDEX tasks_cleanup_on ON tasks(json_extract(planner_json,'$.cleanupOn')) WHERE deleted_at IS NULL;
PRAGMA user_version = 6;
