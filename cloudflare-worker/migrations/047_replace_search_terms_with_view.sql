-- Migration 047: Replace search_terms with v_search_terms VIEW
-- Drop search_terms table, create VIEW for autocomplete
-- (Applied manually: DROP TABLE + CREATE VIEW)

DROP TABLE IF EXISTS search_terms;

CREATE VIEW IF NOT EXISTS v_search_terms AS
SELECT 
  LOWER(TRIM(cs.text)) as term,
  cs.language,
  COUNT(*) as frequency,
  COUNT(DISTINCT cs.card_id) as unique_cards
FROM card_subtitles cs
INNER JOIN cards c ON c.id = cs.card_id
INNER JOIN episodes e ON e.id = c.episode_id
INNER JOIN content_items ci ON ci.id = e.content_item_id
WHERE cs.text IS NOT NULL 
  AND LENGTH(cs.text) > 0
  AND c.is_available = 1
  AND LOWER(ci.main_language) = 'en'
GROUP BY LOWER(TRIM(cs.text)), cs.language
ORDER BY frequency DESC;

