-- Migration 040: Add speaking_attempt and writing_attempt to stats tables
-- Add columns to track daily and lifetime speaking/writing attempts

-- Add to user_daily_activity (reset daily)
ALTER TABLE user_daily_activity ADD COLUMN speaking_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_activity ADD COLUMN writing_attempt INTEGER NOT NULL DEFAULT 0;

-- Add to user_daily_stats (historical record, never reset)
ALTER TABLE user_daily_stats ADD COLUMN speaking_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_daily_stats ADD COLUMN writing_attempt INTEGER NOT NULL DEFAULT 0;

-- Add to user_scores (lifetime totals)
ALTER TABLE user_scores ADD COLUMN total_speaking_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE user_scores ADD COLUMN total_writing_attempt INTEGER NOT NULL DEFAULT 0;
