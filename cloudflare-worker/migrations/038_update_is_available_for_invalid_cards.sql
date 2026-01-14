-- Migration 038: Update is_available for invalid cards
-- Set is_available = 0 for:
-- 1. Cards with length = 0 and text contains "NETFLIX" (in main language subtitle)
-- 2. Cards where content_item has NULL or empty main_language

-- Update cards with length = 0 and "NETFLIX" in subtitle text
-- For CJK languages: length = 0 means LENGTH(text) = 0
-- For non-CJK languages: length = 0 means word count = 0 (no spaces or empty)
UPDATE cards
SET is_available = 0
WHERE id IN (
  SELECT DISTINCT c.id
  FROM cards c
  JOIN episodes e ON e.id = c.episode_id
  JOIN content_items ci ON ci.id = e.content_item_id
  JOIN card_subtitles cs ON cs.card_id = c.id
    AND cs.language = ci.main_language
  WHERE c.is_available = 1
    AND ci.main_language IS NOT NULL
    AND ci.main_language != ''
    AND cs.text IS NOT NULL
    AND (
      -- CJK languages: check character length
      (ci.main_language IN ('ja', 'zh', 'ko') AND LENGTH(cs.text) = 0 AND cs.text LIKE '%NETFLIX%')
      OR
      -- Non-CJK languages: check word count (spaces + 1)
      (ci.main_language NOT IN ('ja', 'zh', 'ko') 
        AND (
          (LENGTH(cs.text) = 0 AND cs.text LIKE '%NETFLIX%')
          OR (LENGTH(cs.text) > 0 AND LENGTH(cs.text) - LENGTH(REPLACE(cs.text, ' ', '')) + 1 = 0 AND cs.text LIKE '%NETFLIX%')
        )
      )
    )
);

-- Update cards where content_item has NULL or empty main_language
UPDATE cards
SET is_available = 0
WHERE id IN (
  SELECT DISTINCT c.id
  FROM cards c
  JOIN episodes e ON e.id = c.episode_id
  JOIN content_items ci ON ci.id = e.content_item_id
  WHERE c.is_available = 1
    AND (ci.main_language IS NULL OR ci.main_language = '')
);
