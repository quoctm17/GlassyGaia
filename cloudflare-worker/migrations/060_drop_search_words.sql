-- Migration 060: Drop search_words table
-- Autocomplete feature has been removed from the app.
-- The search_words table and its indexes are no longer needed.

DROP TABLE IF EXISTS search_words;
