-- Migration 002: FTS5 index for subtitles search (no triggers variant for D1 compatibility)
-- We maintain this table from the Worker code paths (import/update/delete).

CREATE VIRTUAL TABLE IF NOT EXISTS card_subtitles_fts USING fts5(
  text,
  language UNINDEXED,
  card_id UNINDEXED,
  tokenize='unicode61 remove_diacritics 2'
);

-- Initial backfill of subtitles into FTS
INSERT INTO card_subtitles_fts(text, language, card_id)
  SELECT text, language, card_id FROM card_subtitles;
