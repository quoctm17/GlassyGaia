-- Migration 034: Optimize search query performance
-- Add composite indexes to speed up search queries
-- NOTE: Split into smaller migrations to avoid memory issues

-- Composite index for cards filtering: is_available + episode_id (most common filter)
-- This index helps with the WHERE c.is_available = 1 filter
CREATE INDEX IF NOT EXISTS idx_cards_available_episode 
  ON cards(is_available, episode_id);
