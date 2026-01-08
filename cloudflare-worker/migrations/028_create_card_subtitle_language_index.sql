-- Migration 028: Create normalized mapping table for ultra-fast subtitle language filtering
-- This is a normalized table: one row per (card_id, language) combination
-- Much faster than LIKE patterns on comma-separated strings - uses index efficiently
--
-- NOTE: This table mirrors card_subtitles but only stores (card_id, language) pairs
-- for fast filtering. Data is populated via triggers/maintenance in worker code.

CREATE TABLE IF NOT EXISTS card_subtitle_language_map (
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  PRIMARY KEY (card_id, language)
);

-- Critical composite index for fast language filtering - covers WHERE language IN (...) efficiently
CREATE INDEX IF NOT EXISTS idx_card_subtitle_language_map_lang_card 
  ON card_subtitle_language_map(language, card_id);

-- Reverse index for card lookup
CREATE INDEX IF NOT EXISTS idx_card_subtitle_language_map_card 
  ON card_subtitle_language_map(card_id);

-- NOTE: Initial data population is done lazily by worker code to avoid migration timeout.
-- The table will be automatically populated when cards are queried/updated.
-- See populateMappingTableAsync() function in worker.js

