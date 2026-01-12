-- Migration 031: Add speaking_attempt and writing_attempt to user_card_states
-- These fields track user practice attempts for Production Factor calculation

-- Add speaking_attempt column
ALTER TABLE user_card_states ADD COLUMN speaking_attempt INTEGER NOT NULL DEFAULT 0;

-- Add writing_attempt column
ALTER TABLE user_card_states ADD COLUMN writing_attempt INTEGER NOT NULL DEFAULT 0;
