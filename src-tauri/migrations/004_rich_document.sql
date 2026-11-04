ALTER TABLE records ADD COLUMN document_json TEXT NOT NULL DEFAULT 'null';
PRAGMA user_version = 4;
