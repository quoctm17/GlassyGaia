-- Migration 006: Add is_available flag to cards, content_items, and episodes
-- Allows controlling visibility of content in the application
-- SAFE: Uses ALTER TABLE ADD COLUMN (does NOT drop or recreate tables)
-- Default: 1 (true/available) for all existing data

-- Add is_available to content_items
ALTER TABLE content_items ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- Add is_available to episodes
ALTER TABLE episodes ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;

-- Add is_available to cards
ALTER TABLE cards ADD COLUMN is_available INTEGER NOT NULL DEFAULT 1;
