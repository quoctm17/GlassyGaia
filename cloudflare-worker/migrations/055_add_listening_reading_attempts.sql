-- Migration 055: Add listening_attempt and reading_attempt to user state and stats tables
-- These fields track user practice attempts for Listening/Reading, parallel to Speaking/Writing
--
-- Note: speaking_attempt / writing_attempt were added in:
--   - 031_add_speaking_writing_attempts.sql (user_card_states)
--   - 040_add_speaking_writing_stats.sql   (user_daily_activity, user_daily_stats, user_scores)
-- This migration mirrors that structure for listening/reading.

-- Add per-card attempt counters to user_card_states
ALTER TABLE user_card_states ADD COLUMN listening_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_card_states ADD COLUMN reading_attempt   INTEGER NOT NULL DEFAULT 0;

-- Add daily attempt counters (reset daily) to user_daily_activity
ALTER TABLE user_daily_activity ADD COLUMN listening_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_activity ADD COLUMN reading_attempt   INTEGER NOT NULL DEFAULT 0;

-- Add historical daily attempt counters to user_daily_stats
ALTER TABLE user_daily_stats ADD COLUMN listening_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_stats ADD COLUMN reading_attempt   INTEGER NOT NULL DEFAULT 0;

-- Add lifetime attempt counters to user_scores
ALTER TABLE user_scores ADD COLUMN total_listening_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_scores ADD COLUMN total_reading_attempt   INTEGER NOT NULL DEFAULT 0;

