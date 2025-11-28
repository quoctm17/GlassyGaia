-- Migration 005: Add description column to episodes
-- Adds a TEXT description for episode-level metadata

ALTER TABLE episodes ADD description TEXT;