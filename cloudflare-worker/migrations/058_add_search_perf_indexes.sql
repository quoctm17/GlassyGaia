-- Migration 058: Performance indexes for search queries
-- These indexes target the most common WHERE clauses in browse and search queries.

-- Standalone index for is_available filter
-- The composite idx_cards_available_episode exists but D1 may not use it optimally
-- for queries that only filter by is_available (without episode_id)
CREATE INDEX IF NOT EXISTS idx_cards_is_available ON cards(is_available);

-- Index for content_items main_language filter
-- Queries often filter by main_language without type, so this single-column index
-- is more targeted than the composite idx_content_items_search(main_language, type, id)
CREATE INDEX IF NOT EXISTS idx_content_items_main_language ON content_items(main_language);

-- Reverse-lookup index for card_subtitles by card_id
-- The existing idx_card_subtitles_language (language, card_id) can't efficiently
-- support card_id-only lookups; this helps JOINs from cards→card_subtitles
CREATE INDEX IF NOT EXISTS idx_card_subtitles_card_id ON card_subtitles(card_id);
