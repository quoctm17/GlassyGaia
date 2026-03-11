-- Migration 056: Add listening_attempt and reading_attempt reward configs
-- These action types will be used to track XP from listening and reading practice attempts.
--
-- IMPORTANT: We insert with explicit IDs so they can be referenced
-- via REWARD_CONFIG_IDS in the Cloudflare Worker code.
-- Existing rewards_config IDs (from earlier migrations) are:
--   1: daily_challenge
--   2: weekly_challenge
--   3: srs_state_change
--   4: listening_5s
--   5: reading_8s
--   6: speaking_attempt
--   7: writing_attempt
-- We continue with 8 and 9 for listening_attempt / reading_attempt.

INSERT OR IGNORE INTO rewards_config (
  id,
  action_type,
  reward_type,
  xp_amount,
  coin_amount,
  is_repeatable,
  cooldown_seconds,
  description
) VALUES
  (8, 'listening_attempt', 'action', 1, 0, 1, NULL, 'XP earned from listening practice with a card'),
  (9, 'reading_attempt',   'action', 1, 0, 1, NULL, 'XP earned from reading practice with a card');

