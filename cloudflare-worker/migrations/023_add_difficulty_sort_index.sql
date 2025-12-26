-- Migration 023: Add composite index for difficulty_score sorting optimization
-- This index optimizes ORDER BY difficulty_score queries when filtering by is_available
-- SAFE: Only adds index, does not modify data

-- Composite index for efficient sorting by difficulty_score when filtering by is_available
CREATE INDEX IF NOT EXISTS idx_cards_available_difficulty ON cards(is_available, difficulty_score);

