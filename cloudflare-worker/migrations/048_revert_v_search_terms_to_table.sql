-- Migration 048: Revert v_search_terms VIEW back to search_terms TABLE
-- This reverses migration 047 which dropped the table and created a VIEW
-- The search_terms table is needed for proper autocomplete functionality

-- Drop the VIEW first
DROP VIEW IF EXISTS v_search_terms;

-- Recreate the search_terms table with proper schema
CREATE TABLE IF NOT EXISTS search_terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL,                    -- The searchable term/phrase (can be full sentence or word)
  language TEXT NOT NULL,                 -- Language code (e.g., 'en', 'ja', 'zh')
  frequency INTEGER NOT NULL DEFAULT 1,   -- How many times this term appears (for ranking)
  context_count INTEGER NOT NULL DEFAULT 1, -- Number of unique cards containing this term
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

-- Index for context_count-based ranking
CREATE INDEX IF NOT EXISTS idx_search_terms_context
  ON search_terms(context_count DESC, frequency DESC);

-- Note: After this migration, you should populate search_terms using:
-- - Run migration 051: Populate search_terms from card_subtitles
-- - Or the /api/admin/populate-search-terms endpoint
-- - And then populate search_words using: POST /api/admin/populate-search-words

