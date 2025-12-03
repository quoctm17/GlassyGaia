-- Migration 009: Rename last_accessed_at to last_completed_at in user_episode_stats
-- Fix column name to match API expectations

-- SQLite doesn't support RENAME COLUMN directly in older versions
-- We need to recreate the table

-- Step 1: Create new table with correct column name
CREATE TABLE IF NOT EXISTS user_episode_stats_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  film_id TEXT NOT NULL,
  episode_slug TEXT NOT NULL,
  total_cards INTEGER NOT NULL DEFAULT 0,
  completed_cards INTEGER NOT NULL DEFAULT 0,
  last_card_index INTEGER NOT NULL DEFAULT 0,
  completion_percentage REAL NOT NULL DEFAULT 0.0,
  last_completed_at INTEGER NOT NULL,           -- Renamed from last_accessed_at
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Step 2: Copy data from old table to new table
INSERT INTO user_episode_stats_new 
  (id, user_id, film_id, episode_slug, total_cards, completed_cards, 
   last_card_index, completion_percentage, last_completed_at, created_at, updated_at)
SELECT 
  id, user_id, film_id, episode_slug, total_cards, completed_cards,
  last_card_index, completion_percentage, last_accessed_at, created_at, updated_at
FROM user_episode_stats;

-- Step 3: Drop old table
DROP TABLE user_episode_stats;

-- Step 4: Rename new table to original name
ALTER TABLE user_episode_stats_new RENAME TO user_episode_stats;

-- Step 5: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_episode_stats_lookup 
  ON user_episode_stats(user_id, film_id, episode_slug);

CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_stats_unique 
  ON user_episode_stats(user_id, film_id, episode_slug);

-- Step 6: Create index on last_completed_at for sorting
CREATE INDEX IF NOT EXISTS idx_episode_stats_last_completed 
  ON user_episode_stats(user_id, last_completed_at DESC);
