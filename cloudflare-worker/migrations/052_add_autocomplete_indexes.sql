-- Migration 052: Minimal index for autocomplete queries
-- This migration ONLY adds indexes that won't cause D1 timeouts
-- The autocomplete will work without additional indexes due to existing indexes
-- and the query optimization with proper WHERE clauses

-- Simple index on card_subtitles.language (already exists from migration 028)
-- No new indexes are created to avoid D1 timeouts on large tables

-- Note: The autocomplete works by querying card_subtitles directly:
-- 1. The query uses proper indexes via the existing indexes
-- 2. KV caching reduces DB load significantly
-- 3. LIMIT clause prevents excessive result processing

SELECT 1; -- No-op migration

