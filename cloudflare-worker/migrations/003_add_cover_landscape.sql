-- Migration 002: Add landscape cover support
-- Adds cover_landscape_key columns to content_items and episodes tables

-- Add landscape cover to content_items
ALTER TABLE content_items ADD cover_landscape_key TEXT;

-- Add landscape cover to episodes
ALTER TABLE episodes ADD cover_landscape_key TEXT;
