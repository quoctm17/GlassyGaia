-- Migration 033: Optimize user_card_states indexes for batch queries
-- Add composite index for efficient batch save status lookups

-- Composite index for batch queries: WHERE user_id = ? AND card_id IN (...)
CREATE INDEX IF NOT EXISTS idx_user_card_states_user_card 
  ON user_card_states(user_id, card_id);
