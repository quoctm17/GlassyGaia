-- Migration 044: Clear search_terms table and reset for English-only content
-- This resets the search_terms table to be repopulated with only English content
-- The previous data may include terms from non-English (unavailable) cards

-- Clear all existing data in search_terms
DELETE FROM search_terms;

-- Optional: Reset the autoincrement counter (uncomment if you want fresh IDs)
-- DELETE FROM sqlite_sequence WHERE name = 'search_terms';

-- Note: After running this migration, you should run the populate-search-terms endpoint
-- to repopulate with only available English content

