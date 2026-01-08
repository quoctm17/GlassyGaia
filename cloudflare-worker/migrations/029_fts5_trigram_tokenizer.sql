-- Migration 029: Replace FTS5 with Trigram Tokenizer for CJK Support
-- This migration replaces the old unicode61 tokenizer with trigram tokenizer
-- which is optimized for CJK (Chinese, Japanese, Korean) character search.
--
-- The trigram tokenizer breaks text into 3-character sequences, making it
-- perfect for searching CJK languages without full table scans.

-- Step 1: Drop the old FTS table (if it exists)
DROP TABLE IF EXISTS card_subtitles_fts;

-- Step 2: Create the new FTS5 virtual table with trigram tokenizer
-- We keep the same structure as before (text, language, card_id) for compatibility
-- with existing worker code, but change the tokenizer to 'trigram' for CJK support
CREATE VIRTUAL TABLE card_subtitles_fts USING fts5(
    text,
    language UNINDEXED,
    card_id UNINDEXED,
    tokenize='trigram'
);

-- NOTE: We skip the initial backfill in migration to avoid D1 CPU timeout.
-- The worker code will automatically populate the FTS table when it processes
-- subtitle updates. For immediate population, you can run this manually in batches
-- via D1 console or worker code.

