-- Migration 054: Drop stem column from reference_word_frequency
-- JSON upload only provides word and rank; stem is unused. Recreate table without stem for compatibility.
-- Also drop broken view v_user_stats (references user_favorites which was removed in 018) so D1 schema validation passes.

DROP VIEW IF EXISTS v_user_stats;

DROP INDEX IF EXISTS idx_reference_word_frequency_stem;

CREATE TABLE reference_word_frequency_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  word TEXT NOT NULL,
  rank INTEGER NOT NULL,
  created_at INTEGER DEFAULT (strftime('%s','now')),
  framework TEXT
);

INSERT INTO reference_word_frequency_new (id, word, rank, created_at, framework)
SELECT id, word, rank, created_at, framework FROM reference_word_frequency;

DROP TABLE reference_word_frequency;

ALTER TABLE reference_word_frequency_new RENAME TO reference_word_frequency;

CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_word ON reference_word_frequency(word);
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_rank ON reference_word_frequency(rank);
CREATE INDEX IF NOT EXISTS idx_reference_word_frequency_framework_word ON reference_word_frequency(framework, word);
