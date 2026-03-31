-- Migration: 059_add_starred_content
-- Allows users to star/unstar content items (movies, series, books)
-- Enables "starred content" filter in ContentSelector

CREATE TABLE IF NOT EXISTS user_starred_content (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_item_id  TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  created_at       INTEGER DEFAULT (unixepoch() * 1000),
  updated_at       INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(user_id, content_item_id)
);

CREATE INDEX IF NOT EXISTS idx_starred_user
  ON user_starred_content(user_id);

CREATE INDEX IF NOT EXISTS idx_starred_content
  ON user_starred_content(content_item_id);
