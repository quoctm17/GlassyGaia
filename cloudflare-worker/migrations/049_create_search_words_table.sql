-- Migration 049: Create search_words table for word-level autocomplete
-- This creates a separate table that stores individual words extracted from subtitles
-- for fast word-level autocomplete (matching partial words in sentences)

-- Create table to store individual searchable words
CREATE TABLE IF NOT EXISTS search_words (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,                     -- The individual word (lowercase, trimmed)
  language TEXT NOT NULL,                 -- Language code (e.g., 'en', 'ja', 'zh')
  frequency INTEGER NOT NULL DEFAULT 1,   -- How many times this word appears across all subtitles
  context_count INTEGER NOT NULL DEFAULT 1, -- Number of unique cards containing this word
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(word, language)                  -- One entry per word+language combination
);

-- Index for fast prefix matching (autocomplete: word LIKE 'query%')
CREATE INDEX IF NOT EXISTS idx_search_words_word_language
  ON search_words(language, word);

-- Index for word-in-sentence matching (autocomplete: word LIKE '%query%')
-- This is slower but needed for finding words within sentences
CREATE INDEX IF NOT EXISTS idx_search_words_contains
  ON search_words(language, word);

-- Index for frequency-based ranking
CREATE INDEX IF NOT EXISTS idx_search_words_frequency
  ON search_words(frequency DESC, word ASC);

-- Index for context_count-based ranking
CREATE INDEX IF NOT EXISTS idx_search_words_context
  ON search_words(context_count DESC, frequency DESC);

-- Composite index optimized for autocomplete by prefix
CREATE INDEX IF NOT EXISTS idx_search_words_autocomplete_prefix
  ON search_words(language, word, frequency DESC);

-- Composite index optimized for autocomplete by contains
CREATE INDEX IF NOT EXISTS idx_search_words_autocomplete_contains
  ON search_words(language, word COLLATE NOCASE, frequency DESC);

-- Note: This table should be populated via /api/admin/populate-search-words endpoint
-- The population script will:
-- 1. Extract individual words from card_subtitles.text
-- 2. Use regex or string functions to split text into words
-- 3. Count frequency and context (unique cards) for each word
-- 4. Insert/update records in this table

-- This is different from search_terms which stores complete phrases/sentences
-- search_words stores individual words for when users want to find cards
-- containing any word that matches their search query

