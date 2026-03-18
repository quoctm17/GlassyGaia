-- Add level_frequency_ranks column to cards, episodes, and content_items
-- Stores the computed overallFreqRank per framework/language, similar to level_framework_stats
-- Format: JSON array of { framework, language, frequency_rank } entries

ALTER TABLE cards ADD COLUMN level_frequency_ranks TEXT;
ALTER TABLE episodes ADD COLUMN level_frequency_ranks TEXT;
ALTER TABLE content_items ADD COLUMN level_frequency_ranks TEXT;
