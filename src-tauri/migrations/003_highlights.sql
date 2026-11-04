ALTER TABLE records ADD COLUMN highlights_json TEXT NOT NULL DEFAULT '[]';
PRAGMA user_version = 3;
