-- Migration 032: Add speaking and writing reward configs
-- These action types will be used to track XP from speaking and writing activities

-- Insert speaking and writing reward configs if they don't exist
INSERT OR IGNORE INTO rewards_config (action_type, reward_type, xp_amount, coin_amount, is_repeatable, description) VALUES
  ('speaking_attempt', 'action', 1, 0, 1, 'XP earned from speaking practice with a card'),
  ('writing_attempt', 'action', 1, 0, 1, 'XP earned from writing practice with a card');
