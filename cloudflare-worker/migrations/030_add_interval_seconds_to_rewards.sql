-- Migration 030: Add interval_seconds to rewards_config and listening_sessions_count to user_scores
-- This allows configurable intervals instead of hardcoded 5s/8s values
-- And tracks listening sessions count separately from XP intervals

-- Add interval_seconds column to rewards_config
ALTER TABLE rewards_config ADD COLUMN interval_seconds INTEGER;

-- Update existing listening_5s and reading_8s configs with their intervals
UPDATE rewards_config 
SET interval_seconds = 5 
WHERE action_type = 'listening_5s';

UPDATE rewards_config 
SET interval_seconds = 8 
WHERE action_type = 'reading_8s';

-- Set default interval_seconds for other configs (NULL = not applicable)
-- NULL means this reward config doesn't use time-based intervals

-- Add listening_sessions_count to user_scores for tracking total listening sessions
-- This counts each time user clicks play audio (different from XP intervals)
ALTER TABLE user_scores ADD COLUMN listening_sessions_count INTEGER NOT NULL DEFAULT 0;
