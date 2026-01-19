-- Migration 041: Add search_terms table for autocomplete suggestions
-- This creates an inverted index of searchable terms/phrases from card_subtitles
-- to enable fast autocomplete suggestions without running full FTS5 searches

CREATE TABLE IF NOT EXISTS search_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,                    -- The searchable term/phrase
  language TEXT NOT NULL,                 -- Language code (e.g., 'en', 'ja', 'zh')
  frequency INTEGER NOT NULL DEFAULT 1,  -- How many times this term appears (for ranking)
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  UNIQUE(term, language)                  -- One entry per term+language combination
);

-- Index for fast prefix matching (autocomplete queries)
CREATE INDEX IF NOT EXISTS idx_search_terms_term_language 
  ON search_terms(language, term);

-- Index for frequency-based ranking
CREATE INDEX IF NOT EXISTS idx_search_terms_frequency 
  ON search_terms(frequency DESC, term ASC);

-- Composite index optimized for autocomplete: language + term prefix + frequency
CREATE INDEX IF NOT EXISTS idx_search_terms_autocomplete 
  ON search_terms(language, term, frequency DESC);
