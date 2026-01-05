-- Migration 025: Reference tables for Automated Language Level Assessment
-- Creates tables for CEFR reference list, word frequency data, and system configs
-- SAFE: Creates new tables only (no data loss)

-- CEFR reference list for vocabulary-based level assessment
CREATE TABLE IF NOT EXISTS reference_cefr_list (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  headword TEXT NOT NULL,
  pos TEXT, -- part of speech (e.g., 'n', 'v', 'adj')
  cefr_level TEXT NOT NULL, -- e.g., 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Word frequency reference for fallback level assessment
CREATE TABLE IF NOT EXISTS reference_word_frequency (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  rank INTEGER NOT NULL, -- frequency rank (lower = more frequent)
  stem TEXT, -- stem/lemma form (optional)
  created_at INTEGER DEFAULT (strftime('%s','now'))
);

-- System configuration table for storing global hyperparameters
CREATE TABLE IF NOT EXISTS system_configs (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL, -- JSON string for complex configs
  updated_at INTEGER DEFAULT (strftime('%s','now'))
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reference_cefr_list_headword ON reference_cefr_list(headword);
CREATE INDEX IF NOT EXISTS idx_reference_cefr_list_level ON reference_cefr_list(cefr_level);
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_word ON reference_word_frequency(word);
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_rank ON reference_word_frequency(rank);
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_stem ON reference_word_frequency(stem);

-- Insert default CUTOFF_RANKS configuration
-- This maps frequency ranks to CEFR levels (to be used as fallback)
INSERT OR IGNORE INTO system_configs (key, value) VALUES (
  'CUTOFF_RANKS',
  '{"A1": 1000, "A2": 2500, "B1": 5000, "B2": 10000, "C1": 20000, "C2": 50000}'
);

