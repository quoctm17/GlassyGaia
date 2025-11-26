-- Migration 004: Remove landscape cover from episodes
-- Episodes will only use portrait cover (cover_key)
-- Content items retain both portrait and landscape covers

-- CRITICAL: Disable foreign keys temporarily to prevent CASCADE deletion of cards
PRAGMA foreign_keys = OFF;

-- 1. Create new episodes table without cover_landscape_key
CREATE TABLE episodes_new (
  id TEXT PRIMARY KEY NOT NULL,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  slug TEXT,
  title TEXT,
  cover_key TEXT,
  full_audio_key TEXT,
  full_video_key TEXT,
  num_cards INTEGER NOT NULL DEFAULT 0,
  avg_difficulty_score REAL,
  level_framework_stats TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- 2. Copy data from old table (excluding cover_landscape_key)
INSERT INTO episodes_new (
  id, content_item_id, episode_number, slug, title, 
  cover_key, full_audio_key, full_video_key,
  num_cards, avg_difficulty_score, level_framework_stats,
  created_at, updated_at
)
SELECT 
  id, content_item_id, episode_number, slug, title,
  cover_key, full_audio_key, full_video_key,
  num_cards, avg_difficulty_score, level_framework_stats,
  created_at, updated_at
FROM episodes;

-- 3. Drop old table
DROP TABLE episodes;

-- 4. Rename new table
ALTER TABLE episodes_new RENAME TO episodes;

-- 5. Recreate indexes
CREATE INDEX IF NOT EXISTS idx_episodes_item ON episodes(content_item_id);
CREATE INDEX IF NOT EXISTS idx_episodes_slug ON episodes(slug);

-- 6. Re-enable foreign keys
PRAGMA foreign_keys = ON;
