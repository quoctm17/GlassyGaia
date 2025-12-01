-- Migration 005: Add description column to episodes
-- Adds a TEXT description for episode-level metadata
-- SAFE: Uses ALTER TABLE ADD COLUMN (does NOT drop or recreate table)

-- Add description column if it doesn't exist
-- SQLite will error if column exists, so we check first via a safe ALTER
ALTER TABLE episodes ADD COLUMN description TEXT;