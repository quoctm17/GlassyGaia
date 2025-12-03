-- Migration 007: Add user progress tracking
-- Track learning progress for each user per episode

CREATE TABLE IF NOT EXISTS user_progress (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,                    -- Firebase UID or 'local' for guest users
  film_id TEXT NOT NULL,                    -- Film/content slug
  episode_slug TEXT NOT NULL,               -- Episode identifier (e.g., 'e1')
  card_id TEXT NOT NULL,                    -- Card identifier
  card_index INTEGER NOT NULL,              -- Card position in episode (0-based)
  completed_at INTEGER NOT NULL,            -- Unix timestamp (milliseconds)
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Index for efficient lookups by user and episode
CREATE INDEX IF NOT EXISTS idx_user_progress_lookup 
  ON user_progress(user_id, film_id, episode_slug);

-- Index for efficient card lookup
CREATE INDEX IF NOT EXISTS idx_user_progress_card 
  ON user_progress(user_id, film_id, episode_slug, card_id);

-- Composite unique constraint: one progress record per user per card
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_progress_unique 
  ON user_progress(user_id, film_id, episode_slug, card_id);

-- Table for storing episode-level progress summary (optional, for performance)
CREATE TABLE IF NOT EXISTS user_episode_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  film_id TEXT NOT NULL,
  episode_slug TEXT NOT NULL,
  total_cards INTEGER NOT NULL DEFAULT 0,       -- Total cards in episode
  completed_cards INTEGER NOT NULL DEFAULT 0,   -- Number of completed cards
  last_card_index INTEGER NOT NULL DEFAULT 0,   -- Last card viewed (for resume)
  completion_percentage REAL NOT NULL DEFAULT 0.0,
  last_accessed_at INTEGER NOT NULL,            -- Last time user studied this episode
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Index for episode stats lookup
CREATE INDEX IF NOT EXISTS idx_episode_stats_lookup 
  ON user_episode_stats(user_id, film_id, episode_slug);

-- Unique constraint for episode stats
CREATE UNIQUE INDEX IF NOT EXISTS idx_episode_stats_unique 
  ON user_episode_stats(user_id, film_id, episode_slug);
