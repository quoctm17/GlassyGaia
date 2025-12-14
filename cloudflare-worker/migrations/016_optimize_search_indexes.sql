-- Migration 016: Optimize search performance with composite indexes
-- Addresses D1 CPU timeout issues by adding strategic composite indexes

-- Composite index for search filtering on content_items
CREATE INDEX IF NOT EXISTS idx_content_items_search 
  ON content_items(main_language, type, id);

-- Composite index for card filtering by difficulty
CREATE INDEX IF NOT EXISTS idx_cards_difficulty_episode 
  ON cards(episode_id, difficulty_score, card_number);

-- Composite index for card difficulty levels filtering
CREATE INDEX IF NOT EXISTS idx_card_difficulty_levels_lookup 
  ON card_difficulty_levels(card_id, framework, level);

-- Composite index for subtitle language filtering
CREATE INDEX IF NOT EXISTS idx_card_subtitles_language 
  ON card_subtitles(language, card_id);

-- Index for episode content lookup
CREATE INDEX IF NOT EXISTS idx_episodes_content_number 
  ON episodes(content_item_id, episode_number);
