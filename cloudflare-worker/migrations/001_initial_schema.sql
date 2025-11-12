-- Migration 001: Initial Schema for GlassyGaia (v2 - Scalable Difficulty)
-- This is the baseline schema, using generic "content" terminology for future scalability.
-- It is designed to be safe to run on an empty database.

-- Foreign keys are enabled by default in D1; omit PRAGMA for remote migrations

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  main_language TEXT NOT NULL,
  type TEXT NOT NULL, -- e.g., 'movie', 'series', 'book', 'audio'
  description TEXT,
  cover_key TEXT,
  full_audio_key TEXT, -- full audio file key (optional)
  full_video_key TEXT, -- full video file key (optional)
  release_year INTEGER,
  -- Total intended episodes for this content (business metadata, can exceed currently uploaded episodes).
  total_episodes INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS content_item_languages (
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  PRIMARY KEY (content_item_id, language)
);

CREATE TABLE IF NOT EXISTS episodes (
  id TEXT PRIMARY KEY NOT NULL,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  episode_number INTEGER NOT NULL,
  slug TEXT, -- stable public identifier like filmSlug_1
  title TEXT,
  full_audio_key TEXT,
  full_video_key TEXT,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY NOT NULL,
  episode_id TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  card_number INTEGER NOT NULL,
  start_time_ms INTEGER NOT NULL,
  end_time_ms INTEGER NOT NULL,
  image_key TEXT,
  audio_key TEXT,
  difficulty_score REAL, -- 0-100 float score for fine-grained recommendations
  sentence TEXT,
  card_type TEXT,
  length INTEGER, -- normalized type length for matching/speaking features
  -- REMOVED: cefr_level TEXT. This is now handled in the card_difficulty_levels table.
  created_at INTEGER DEFAULT (strftime('%s','now')),
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- NEW TABLE: To store difficulty levels from various frameworks (CEFR, JLPT, HSK, etc.)
CREATE TABLE IF NOT EXISTS card_difficulty_levels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  framework TEXT NOT NULL, -- e.g., 'CEFR', 'JLPT', 'HSK'
  level TEXT NOT NULL, -- e.g., 'A2', 'N5', 'HSK 3'
  language TEXT, -- optional: e.g., 'en', 'ja', 'zh'
  UNIQUE(card_id, framework, language) -- A card can only have one level per framework-language pair
);

CREATE TABLE IF NOT EXISTS card_subtitles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  text TEXT NOT NULL,
  UNIQUE (card_id, language)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_episodes_item ON episodes(content_item_id);
CREATE INDEX IF NOT EXISTS idx_episodes_slug ON episodes(slug);
CREATE INDEX IF NOT EXISTS idx_cards_episode ON cards(episode_id);
CREATE INDEX IF NOT EXISTS idx_cards_difficulty_score ON cards(difficulty_score);
CREATE INDEX IF NOT EXISTS idx_subtitles_card ON card_subtitles(card_id);
CREATE INDEX IF NOT EXISTS idx_card_difficulty_levels_card ON card_difficulty_levels(card_id);