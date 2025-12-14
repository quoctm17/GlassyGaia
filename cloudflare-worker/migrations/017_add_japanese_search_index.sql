-- Migration 017: Add index for Japanese LIKE search performance
-- Addresses slow LIKE queries on card_subtitles.text for CJK languages

-- Index for Japanese/Chinese text search with language filter
-- Supports: WHERE text LIKE '%query%' AND language = 'ja'
CREATE INDEX IF NOT EXISTS idx_card_subtitles_text_language 
  ON card_subtitles(language, text);

-- Composite index for main language lookup in joins
CREATE INDEX IF NOT EXISTS idx_content_items_main_language 
  ON content_items(main_language, id);

-- Optimize cards updated_at for fallback ordering
CREATE INDEX IF NOT EXISTS idx_cards_updated_at 
  ON cards(updated_at DESC, card_number ASC);

-- Speed up content filtering in WHERE clause
CREATE INDEX IF NOT EXISTS idx_episodes_content_id 
  ON episodes(content_item_id, id);
