-- Migration 008: Add Users Management System
-- Create users table and related tables for user preferences and favorites
-- Update user_progress to have proper foreign key relationship

-- ==================== USERS TABLE ====================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY NOT NULL,              -- Firebase UID or 'local' for guest
  email TEXT,                                -- User email (from Firebase Auth)
  display_name TEXT,                         -- User display name
  photo_url TEXT,                            -- User profile photo URL
  auth_provider TEXT DEFAULT 'firebase',     -- 'firebase', 'google', 'local', etc.
  
  -- User status
  is_active INTEGER NOT NULL DEFAULT 1,      -- 1 = active, 0 = deactivated
  is_admin INTEGER NOT NULL DEFAULT 0,       -- 1 = admin, 0 = regular user
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  last_login_at INTEGER                      -- Track last login time
);

-- Index for email lookup
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Index for active users
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);


-- ==================== USER PREFERENCES TABLE ====================
CREATE TABLE IF NOT EXISTS user_preferences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Language preferences
  main_language TEXT DEFAULT 'en',                    -- User's primary learning language
  subtitle_languages TEXT,                            -- JSON array of subtitle languages ['en', 'ja']
  require_all_languages INTEGER NOT NULL DEFAULT 0,   -- 1 = require all selected languages, 0 = any language
  
  -- Learning preferences
  difficulty_min REAL,                                -- Preferred minimum difficulty (0-100)
  difficulty_max REAL,                                -- Preferred maximum difficulty (0-100)
  auto_play INTEGER NOT NULL DEFAULT 1,               -- 1 = auto-play next card, 0 = manual
  playback_speed REAL DEFAULT 1.0,                    -- Audio playback speed (0.5 - 2.0)
  
  -- UI preferences
  theme TEXT DEFAULT 'dark',                          -- 'dark', 'light'
  show_romanization INTEGER NOT NULL DEFAULT 1,       -- For languages like Japanese
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id)
);


-- ==================== USER FAVORITES TABLE ====================
CREATE TABLE IF NOT EXISTS user_favorites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- What is favorited
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  film_id TEXT,                                       -- Denormalized for quick filtering
  episode_id TEXT,                                    -- Denormalized for quick filtering
  
  -- Metadata
  notes TEXT,                                         -- User's personal notes for this card
  tags TEXT,                                          -- JSON array of user-defined tags
  
  -- Timestamps
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  
  UNIQUE(user_id, card_id)
);

-- Index for quick user favorites lookup
CREATE INDEX IF NOT EXISTS idx_favorites_user ON user_favorites(user_id);

-- Index for film/episode filtering
CREATE INDEX IF NOT EXISTS idx_favorites_film ON user_favorites(user_id, film_id);


-- ==================== USER STUDY SESSIONS TABLE ====================
-- Track individual study sessions for analytics
CREATE TABLE IF NOT EXISTS user_study_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  
  -- Session info
  film_id TEXT,
  episode_slug TEXT,
  
  -- Session metrics
  cards_studied INTEGER NOT NULL DEFAULT 0,           -- Number of cards studied in this session
  total_duration INTEGER NOT NULL DEFAULT 0,          -- Total study time in seconds
  
  -- Timestamps
  started_at INTEGER NOT NULL,                        -- Session start time (milliseconds)
  ended_at INTEGER,                                   -- Session end time (milliseconds)
  created_at INTEGER DEFAULT (unixepoch() * 1000)
);

-- Index for user sessions lookup
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_study_sessions(user_id);

-- Index for date-based queries
CREATE INDEX IF NOT EXISTS idx_sessions_started ON user_study_sessions(started_at);


-- ==================== UPDATE EXISTING TABLES ====================

-- Add foreign key check to user_progress (but D1 doesn't support ALTER TABLE ADD CONSTRAINT)
-- Instead, we'll handle this at application level and add comment

-- Note: user_progress.user_id should reference users.id
-- But since D1 doesn't support adding foreign keys after table creation,
-- we'll ensure referential integrity at the application level

-- Create index to improve user_progress queries
CREATE INDEX IF NOT EXISTS idx_user_progress_user ON user_progress(user_id);

-- Create index to improve user_episode_stats queries  
CREATE INDEX IF NOT EXISTS idx_user_episode_stats_user ON user_episode_stats(user_id);
