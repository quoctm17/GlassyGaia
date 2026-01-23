-- Migration 043: Remove FTS5 table to reduce database size
-- FTS5 table (card_subtitles_fts) is taking up 6GB+ and is no longer needed
-- since we now use search_terms table for autocomplete and LIKE search on card_subtitles

-- Drop FTS5 virtual table (shadow tables will be automatically dropped)
-- Note: If migration fails due to size, use the /api/admin/drop-fts5 endpoint instead
DROP TABLE IF EXISTS card_subtitles_fts;

-- Note: This migration will free up approximately 6GB of database space
-- Search functionality will now use LIKE queries on card_subtitles table
-- combined with search_terms autocomplete for better performance
