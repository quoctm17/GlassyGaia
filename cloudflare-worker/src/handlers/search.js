import { json } from '../utils/response.js';
import { buildFtsQuery } from '../utils/fts.js';
import { getFrameworkFromLanguage } from '../utils/levels.js';
import { populateMappingTableAsync } from '../services/cardHelpers.js';

export function registerSearchRoutes(router) {
  router.get('/api/content/autocomplete', async (request, env) => {
    const url = new URL(request.url);
    const query = (url.searchParams.get('q') || url.searchParams.get('query') || "").trim().toLowerCase();
    const rawLang = url.searchParams.get('language') || url.searchParams.get('lang') || "en";
    const lang = rawLang.split('-')[0].toLowerCase();
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || '20')));

    if (query.length < 1) return json({ suggestions: [] });

    try {
      const cacheKey = `content_autocomplete:${lang}:${query}:v5`;
      const CACHE_TTL = 3600;

      if (env.SEARCH_CACHE) {
        const cached = await env.SEARCH_CACHE.get(cacheKey);
        if (cached) {
          const cachedData = JSON.parse(cached);
          console.log(`[CACHE HIT /api/content/autocomplete] Key: ${cacheKey}`);
          return json({ suggestions: cachedData, cached: true });
        }
      }

      // Primary: query the pre-populated search_words table (fast, indexed, clean words)
      const { results } = await env.DB.prepare(`
        SELECT word, frequency
        FROM search_words
        WHERE language = ?
          AND word LIKE ? || '%'
        ORDER BY frequency DESC
        LIMIT ?
      `).bind(lang, query, limit).all();

      let suggestions;

      if (results && results.length > 0) {
        suggestions = results
          .filter(i => i.word && i.word.length > 1)
          .map(i => ({ term: i.word }));
      } else {
        // Fallback: use original fast query, strip punctuation in JS
        const fetchLimit = Math.min(limit * 3, 60);
        const { results: fallbackResults } = await env.DB.prepare(`
          SELECT
            LOWER(TRIM(
              CASE
                WHEN INSTR(cs.text, ' ') > 0 THEN SUBSTR(cs.text, 1, INSTR(cs.text, ' ') - 1)
                ELSE cs.text
              END
            )) as word,
            COUNT(*) as frequency
          FROM card_subtitles cs
          INNER JOIN cards c ON c.id = cs.card_id
          INNER JOIN episodes e ON e.id = c.episode_id
          INNER JOIN content_items ci ON ci.id = e.content_item_id
          WHERE cs.language = ?
            AND cs.text IS NOT NULL
            AND LENGTH(cs.text) > 0
            AND LOWER(TRIM(
              CASE
                WHEN INSTR(cs.text, ' ') > 0 THEN SUBSTR(cs.text, 1, INSTR(cs.text, ' ') - 1)
                ELSE cs.text
              END
            )) LIKE ? || '%'
            AND c.is_available = 1
            AND LOWER(ci.main_language) = 'en'
          GROUP BY word
          ORDER BY frequency DESC
          LIMIT ?
        `).bind(lang, query, fetchLimit).all();

        const cleaned = new Map();
        for (const row of (fallbackResults || [])) {
          if (!row.word) continue;
          const w = row.word.replace(/[^\w]/g, '');
          if (w.length < 2 || !w.startsWith(query)) continue;
          cleaned.set(w, (cleaned.get(w) || 0) + (row.frequency || 1));
        }
        suggestions = [...cleaned.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([w]) => ({ term: w }));
      }

      if (env.SEARCH_CACHE && suggestions.length > 0) {
        await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(suggestions), { expirationTtl: CACHE_TTL });
        console.log(`[CACHE MISS /api/content/autocomplete] Key: ${cacheKey}, Cached ${suggestions.length} suggestions`);
      }

      return json({ suggestions });
    } catch (e) {
      console.error("Content Autocomplete Error:", e.message);
      return json({ suggestions: [], error: "db_busy" });
    }
  });

  router.get('/api/search', async (request, env) => {
    const url = new URL(request.url);
    const startTime = Date.now();
    const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    console.log(`[PERF /api/search] [${requestId}] Request start: ${url.searchParams.toString()}`);

    // Build cache key from query params
    const cacheKey = `search:${url.searchParams.toString()}`;
    const CACHE_TTL = 300; // 5 minutes cache - search results are relatively stable

    try {
      // Check KV cache first
      if (env.SEARCH_CACHE) {
        const cached = await env.SEARCH_CACHE.get(cacheKey, { type: 'json' });
        if (cached && cached.data && cached.timestamp) {
          const age = (Date.now() - cached.timestamp) / 1000;
          if (age < CACHE_TTL) {
            console.log(`[CACHE HIT /api/search] Age: ${age.toFixed(1)}s`);
            return json(cached.data, {
              headers: {
                'X-Cache': 'HIT',
                'X-Cache-Age': Math.round(age).toString(),
              }
            });
          }
        }
      }
      const q = url.searchParams.get('q') || '';
      const mainLanguage = url.searchParams.get('main_language');
      const includeContentMeta = url.searchParams.get('include_content_meta') === '1';
      const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || '';
      const contentIdsCsv = url.searchParams.get('content_ids') || '';
      const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
      const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '50', 10), 1), 100);
      const offset = (page - 1) * size;

      const basePublic = env.R2_PUBLIC_BASE || '';
      const makeMediaUrl = (k) => {
        if (!k) return null;
        return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
      };

      // Parse subtitle languages into array
      const subtitleLangsArr = subtitleLanguagesCsv
        ? Array.from(new Set(subtitleLanguagesCsv.split(',').map(s => s.trim()).filter(Boolean)))
        : [];
      const subtitleLangsCount = subtitleLangsArr.length;

      // Parse content IDs into array
      // Limit to avoid "too many SQL variables" error (SQLite limit is ~999)
      const contentIdsArr = contentIdsCsv
        ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 100)
        : [];
      const contentIdsCount = contentIdsArr.length;

      // Parse difficulty filters
      const difficultyMinRaw = url.searchParams.get('difficulty_min');
      const difficultyMaxRaw = url.searchParams.get('difficulty_max');
      const difficultyMin = difficultyMinRaw ? Number(difficultyMinRaw) : null;
      const difficultyMax = difficultyMaxRaw ? Number(difficultyMaxRaw) : null;
      const hasDifficultyFilter = (difficultyMin !== null && difficultyMin > 0) || (difficultyMax !== null && difficultyMax < 100);

      // Parse level filters
      const levelMinRaw = url.searchParams.get('level_min');
      const levelMaxRaw = url.searchParams.get('level_max');
      const levelMin = levelMinRaw ? String(levelMinRaw).trim() : null;
      const levelMax = levelMaxRaw ? String(levelMaxRaw).trim() : null;
      const hasLevelFilter = levelMin !== null || levelMax !== null;
      const framework = getFrameworkFromLanguage(mainLanguage);

      // Parse length filters (word count in main language subtitle)
      const lengthMinRaw = url.searchParams.get('length_min');
      const lengthMaxRaw = url.searchParams.get('length_max');
      const lengthMin = lengthMinRaw ? Number(lengthMinRaw) : null;
      const lengthMax = lengthMaxRaw ? Number(lengthMaxRaw) : null;
      // hasLengthFilter is true if either min or max is set
      const hasLengthFilter = lengthMin !== null || lengthMax !== null;

      // Parse duration filter (audio duration in seconds)
      const durationMaxRaw = url.searchParams.get('duration_max');
      const durationMax = durationMaxRaw ? Number(durationMaxRaw) : null;
      // hasDurationFilter is true if durationMax is set
      const hasDurationFilter = durationMax !== null && durationMax > 0;

      // Parse review filters (review_count from user_card_states)
      const reviewMinRaw = url.searchParams.get('review_min');
      const reviewMaxRaw = url.searchParams.get('review_max');
      const reviewMin = reviewMinRaw ? Number(reviewMinRaw) : null;
      const reviewMax = reviewMaxRaw ? Number(reviewMaxRaw) : null;
      const userId = url.searchParams.get('user_id');
      // hasReviewFilter is true if userId is set and either min or max is set
      const hasReviewFilter = userId && (reviewMin !== null || reviewMax !== null);

      // Build allowed levels list for level filter
      let allowedLevels = null;
      if (hasLevelFilter) {
        const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
        const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

        let levelOrder = [];
        if (framework === 'CEFR') levelOrder = CEFR;
        else if (framework === 'JLPT') levelOrder = JLPT;
        else if (framework === 'HSK') levelOrder = HSK;

        if (levelOrder.length > 0) {
          const minIdx = levelMin ? levelOrder.indexOf(levelMin.toUpperCase()) : 0;
          const maxIdx = levelMax ? levelOrder.indexOf(levelMax.toUpperCase()) : levelOrder.length - 1;
          if (minIdx >= 0 && maxIdx >= 0 && minIdx <= maxIdx) {
            allowedLevels = levelOrder.slice(minIdx, maxIdx + 1);
          }
        }
      }

      // OPTIMIZED: Quick Browse Mode - use simplified query when no text query
      // Always enable for empty/short queries since we only support English
      const hasTextQuery = q.trim().length >= 2;
      const isQuickBrowse = !hasTextQuery;
      let ftsQuery = '';

      if (hasTextQuery) {
        // Use FTS5 with trigram tokenizer for ALL languages including CJK
        const langForFts = (mainLanguage || '').toLowerCase() || null;
        ftsQuery = buildFtsQuery(q, langForFts);
      }

      let items = [];
      let total = 0;

      if (isQuickBrowse) {
        console.log(`[PERF /api/search] Quick Browse Mode - using simplified query`);

        const browseStmt = `
          SELECT
            c.id AS card_id,
            c.card_number,
            c.start_time,
            c.end_time,
            c.image_key,
            c.audio_key,
            c.difficulty_score,
            c.duration,
            c.length,
            c.sentence,
            c.card_type,
            e.slug AS episode_slug,
            e.episode_number,
            ci.slug AS content_slug,
            ci.slug AS film_id,
            e.slug AS episode_id,
            ci.main_language AS content_main_language,
            ci.title AS content_title
          FROM cards c
          JOIN episodes e ON e.id = c.episode_id
          JOIN content_items ci ON ci.id = e.content_item_id
          WHERE c.is_available = 1
            AND ci.main_language = ?
            ${contentIdsCount > 0 ? `AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})` : ''}
            ${subtitleLangsCount > 0 ? `AND EXISTS (SELECT 1 FROM card_subtitles cs_chk WHERE cs_chk.card_id = c.id AND cs_chk.language IN (${subtitleLangsArr.map(() => '?').join(',')}))` : ''}
          ORDER BY c.id ASC
          LIMIT ? OFFSET ?
        `;

        const browseParams = [
          mainLanguage || 'en',
          ...(contentIdsCount > 0 ? contentIdsArr : []),
          ...(subtitleLangsCount > 0 ? subtitleLangsArr : []),
          size, offset
        ];

        try {
          const browseStart = Date.now();
          const mainResult = await env.DB.prepare(browseStmt).bind(...browseParams).all();
          const rawCards = mainResult.results || [];

          // Skip count query -- use -1 to signal "not available" (frontend handles this)
          total = -1;

          if (rawCards.length > 0) {
            const cardIds = rawCards.map(r => r.card_id);
            const ph = cardIds.map(() => '?').join(',');

            // Determine which subtitle languages to fetch
            const subsLangs = subtitleLangsCount > 0
              ? [...new Set([mainLanguage || 'en', ...subtitleLangsArr])]
              : [mainLanguage || 'en'];
            const subsLangPh = subsLangs.map(() => '?').join(',');

            // Batch-fetch subtitles + levels in parallel
            const [subsResult, levelsResult] = await Promise.all([
              env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph}) AND language IN (${subsLangPh})`).bind(...cardIds, ...subsLangs).all(),
              env.DB.prepare(`SELECT card_id, framework, level, language FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).all(),
            ]);

            const subsMap = new Map();
            for (const row of (subsResult.results || [])) {
              if (!subsMap.has(row.card_id)) subsMap.set(row.card_id, {});
              subsMap.get(row.card_id)[row.language] = row.text;
            }

            const levelsMap = new Map();
            const cefrMap = new Map();
            for (const row of (levelsResult.results || [])) {
              if (!levelsMap.has(row.card_id)) levelsMap.set(row.card_id, []);
              levelsMap.get(row.card_id).push({ framework: row.framework, level: row.level, language: row.language || null });
              if (row.framework === 'CEFR') cefrMap.set(row.card_id, row.level);
            }

            // Build full response items with media URLs, subtitles, and levels inline
            items = rawCards.map(r => ({
              card_id: r.card_id,
              content_slug: r.content_slug,
              content_title: r.content_title,
              episode_slug: r.episode_slug,
              episode_number: r.episode_number,
              film_id: r.content_slug,
              episode_id: r.episode_slug,
              card_number: r.card_number,
              start_time: r.start_time,
              end_time: r.end_time,
              duration: r.duration,
              length: r.length,
              sentence: r.sentence,
              card_type: r.card_type,
              image_url: makeMediaUrl(r.image_key),
              audio_url: makeMediaUrl(r.audio_key),
              difficulty_score: r.difficulty_score,
              text: (subsMap.get(r.card_id) && subsMap.get(r.card_id)[r.content_main_language]) || r.sentence || '',
              subtitle: subsMap.get(r.card_id) || {},
              cefr_level: cefrMap.get(r.card_id) || null,
              levels: levelsMap.get(r.card_id) || [],
            }));

            // Content metadata for FilterPanel (small query on unique slugs)
            if (includeContentMeta) {
              const uniqueSlugs = [...new Set(rawCards.map(r => r.content_slug).filter(Boolean))];
              if (uniqueSlugs.length > 0) {
                try {
                  const metaPh = uniqueSlugs.map(() => '?').join(',');
                  const metaRows = await env.DB.prepare(`SELECT slug as id, title, type, main_language, level_framework_stats FROM content_items WHERE slug IN (${metaPh})`).bind(...uniqueSlugs).all();
                  const contentMeta = {};
                  for (const r of (metaRows.results || [])) {
                    let ls = null;
                    if (r.level_framework_stats) { try { ls = JSON.parse(r.level_framework_stats); } catch {} }
                    contentMeta[r.id] = { id: r.id, title: r.title, type: r.type, main_language: r.main_language, level_framework_stats: ls };
                  }
                  items._content_meta = contentMeta; // attach temporarily, will be extracted below
                } catch (metaErr) {
                  console.warn('[PERF /api/search] Quick browse content_meta error:', metaErr.message);
                }
              }
            }
          }

          const browseTime = Date.now() - browseStart;
          console.log(`[PERF /api/search] Quick browse complete: ${items.length} cards in ${browseTime}ms`);
        } catch (e) {
          console.error(`[PERF /api/search] Quick browse error:`, e.message);
          items = [];
        }
      }

      // Build subtitle language condition using EXISTS (faster than JOIN)
      // Defined outside if blocks so it's available to all code paths
      const subtitleLangCondition = subtitleLangsCount > 0
        ? `AND EXISTS (
              SELECT 1 FROM card_subtitles cs_sub
              WHERE cs_sub.card_id = c.id
                AND cs_sub.language IN (${subtitleLangsArr.map(() => '?').join(',')})
            )`
        : '';

      // Build text search condition using LIKE (since FTS5 was dropped)
      // Defined outside if blocks so it's available to all code paths
      let textSearchCondition = '';
      let textSearchParams = [];
      if (hasTextQuery) {
        // Use LIKE for substring matching on main language subtitles
        textSearchCondition = `
            AND EXISTS (
              SELECT 1 FROM card_subtitles cs_search
              WHERE cs_search.card_id = c.id
                AND cs_search.language = ?
                AND cs_search.text LIKE ?
            )
          `;
        textSearchParams = [mainLanguage || 'en', `%${q}%`];
      }

      // Build content_ids filter
      // Defined outside if blocks so it's available to all code paths
      let contentIdsCondition = '';
      let contentIdsParams = [];
      if (contentIdsCount > 0) {
        contentIdsCondition = `AND ci.id IN (${contentIdsArr.map(() => '?').join(',')})`;
        contentIdsParams = contentIdsArr;
      }

      // Only use complex query if quick browse didn't work
      if (items.length === 0) {
        // Use LIKE-based search since FTS5 table was dropped
        // Simplified approach for subtitle language filtering
        
        let stmt;
        let params = [];
        
        // Build subtitle language condition using EXISTS (faster than JOIN)
        const subtitleLangCondition = subtitleLangsCount > 0
          ? `AND EXISTS (
                SELECT 1 FROM card_subtitles cs_sub
                WHERE cs_sub.card_id = c.id
                  AND cs_sub.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              )`
          : '';

        // Build content_ids filter
        let contentIdsCondition = '';
        let contentIdsParams = [];
        if (contentIdsCount > 0) {
          contentIdsCondition = `AND ci.id IN (${contentIdsArr.map(() => '?').join(',')})`;
          contentIdsParams = contentIdsArr;
        }

        // Main query
        const mainQuery = `
          SELECT
            c.id AS card_id,
            c.card_number,
            c.start_time,
            c.end_time,
            c.image_key,
            c.audio_key,
            c.difficulty_score,
            e.slug AS episode_slug,
            e.episode_number,
            ci.slug AS content_slug,
            ci.slug AS film_id,
            e.slug AS episode_id,
            ci.main_language AS content_main_language,
            ci.title AS content_title
          FROM cards c
          JOIN episodes e ON e.id = c.episode_id
          JOIN content_items ci ON ci.id = e.content_item_id
          WHERE c.is_available = 1
            AND ci.main_language = ?
            ${subtitleLangCondition}
            ${textSearchCondition}
            ${contentIdsCondition}
          ORDER BY c.id ASC
          LIMIT ? OFFSET ?
        `;

        // Build params: mainLanguage + subtitleLangs + textSearchParams + contentIds + size + offset
        params = [mainLanguage || 'en', ...subtitleLangsArr, ...textSearchParams, ...contentIdsParams, size, offset];

        console.log(`[PERF /api/search] Fallback query params: ${JSON.stringify(params.slice(0, 5))}...`);

        try {
          const result = await env.DB.prepare(mainQuery).bind(...params).all();
          items = result.results || [];
          
          // Count query
          const countQuery = `
            SELECT COUNT(*) as total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              AND ci.main_language = ?
              ${subtitleLangCondition}
              ${textSearchCondition}
              ${contentIdsCondition}
          `;
          const countParams = [mainLanguage || 'en', ...subtitleLangsArr, ...textSearchParams, ...contentIdsParams];
          const countResult = await env.DB.prepare(countQuery).bind(...countParams).first();
          total = countResult?.total || 0;
          
          console.log(`[PERF /api/search] Fallback: ${items.length} cards, total: ${total}`);
        } catch (e) {
          console.error(`[PERF /api/search] Fallback error:`, e.message);
        }
      }

      // Only run complex query if quick browse AND simple fallback both failed
      let queryTime = 0;
      let batchStart = null;
      if (items.length === 0) {
        // Optimized: Use EXISTS for main subtitle check when no subtitle languages (faster)
        // Use JOIN when subtitle languages are selected (need to filter by subtitle languages)
        let stmt;
        let useSummaryTable = false; // Declare at outer scope for params binding

        if (subtitleLangsCount > 0) {
          // OPTIMIZED: Use normalized mapping table with EXISTS - ultra-fast with index
          // Check if mapping table exists and has sufficient data
          // TEMPORARILY: Always use fallback until mapping table is fully populated
          // This ensures queries work correctly while mapping table is being populated in background
          useSummaryTable = false; // Force fallback until mapping table is ready

        try {
          const mapCheck = await env.DB.prepare('SELECT COUNT(*) as cnt FROM card_subtitle_language_map LIMIT 1').first();
          const mapCount = mapCheck?.cnt || 0;

          // Check if we have enough cards to estimate coverage
          const totalCardsCheck = await env.DB.prepare('SELECT COUNT(*) as cnt FROM cards WHERE is_available = 1 LIMIT 1').first();
          const totalCards = totalCardsCheck?.cnt || 0;

          // Use mapping table if it has ANY meaningful data (> 100 rows)
          // The background population job will fill it up, but even partial coverage is better than full table scans if we assume populated data is representative
          // However, since incorrect coverage would miss cards, we stick to a reasonable coverage check or just trust the process if specific criteria met
          // IMPROVED: Lower threshold to 100 to enable optimization on smaller/dev databases immediately
          useSummaryTable = mapCount > 100;


          console.log(`[PERF /api/search] Mapping table: ${mapCount} rows | Total cards: ${totalCards} | Coverage: ${((mapCount / totalCards) * 100).toFixed(1)}% | Using: ${useSummaryTable ? 'mapping table' : 'fallback'}`);

          // If low coverage, trigger async population (don't wait)
          if (!useSummaryTable) {
            populateMappingTableAsync(env).catch(err => {
              console.error('[populateMappingTable] Error:', err.message);
            });
          }
        } catch (e) {
          // Table might not exist yet (migration not run), fallback to optimized JOIN
          console.log(`[PERF /api/search] Mapping table error, using fallback:`, e.message);
          useSummaryTable = false;
        }

        console.log(`[PERF /api/search] Using ${useSummaryTable ? 'mapping table' : 'fallback (card_subtitles)'} path | SubtitleLangs: ${subtitleLangsArr.join(',')}`);

        if (useSummaryTable) {
          // OPTIMIZED: Filter by main_language and available cards early, use mapping table with EXISTS
          // This avoids GROUP BY overhead and reduces intermediate result sets
          stmt = `
            SELECT
              c.id AS card_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.image_key,
              c.audio_key,
              c.difficulty_score,
              e.slug AS episode_slug,
              e.episode_number,
              ci.slug AS content_slug,
              ci.slug AS film_id,
              e.slug AS episode_id,
              ci.main_language AS content_main_language,
              ci.title AS content_title
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              ${mainLanguage ? 'AND ci.main_language = ?' : ''}
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
              AND (
                SELECT COUNT(DISTINCT cslm.language)
                FROM card_subtitle_language_map cslm
                WHERE cslm.card_id = c.id
                  AND cslm.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              ) >= ?`;
        } else {
          // OPTIMIZED: Use JOIN with IN clause + GROUP BY + HAVING - much faster than subquery COUNT
          // JOIN with IN uses index idx_card_subtitles_language efficiently
          // Only need cards that match at least one subtitle language (>= 1), which simplifies to EXISTS
          // But for >= ? we need GROUP BY + HAVING
          stmt = `
            SELECT
              c.id AS card_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.image_key,
              c.audio_key,
              c.difficulty_score,
              e.slug AS episode_slug,
              e.episode_number,
              ci.slug AS content_slug,
              ci.slug AS film_id,
              e.slug AS episode_id,
              ci.main_language AS content_main_language,
              ci.title AS content_title
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
              AND ci.main_language = ?
            JOIN card_subtitles cs_main ON cs_main.card_id = c.id
              AND cs_main.language = ci.main_language
              AND cs_main.text IS NOT NULL
              AND cs_main.text != ''
            JOIN card_subtitles cs_filter ON cs_filter.card_id = c.id
              AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
            WHERE c.is_available = 1
            GROUP BY c.id, c.card_number, c.start_time, c.end_time, c.image_key, c.audio_key, 
                     c.difficulty_score, e.slug, e.episode_number, ci.slug, ci.main_language, ci.title
            HAVING COUNT(DISTINCT cs_filter.language) >= ?`;
        }
      } else {
        // No subtitle languages: use INNER JOIN with main_language filter in JOIN condition
        // This allows query optimizer to use index idx_card_subtitles_language(language, card_id) efficiently
        // Filter main_language early in JOIN to reduce rows before processing
        if (mainLanguage) {
          // OPTIMIZED: Filter by main_language and available cards early
          // When main_language is specified, use EXISTS for subtitle check to reduce JOIN overhead
          stmt = `
            SELECT
              c.id AS card_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.image_key,
              c.audio_key,
              c.difficulty_score,
              e.slug AS episode_slug,
              e.episode_number,
              ci.slug AS content_slug,
              ci.slug AS film_id,
              e.slug AS episode_id,
              ci.main_language AS content_main_language,
              ci.title AS content_title
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              AND ci.main_language = ?
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ?
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )`;
        } else {
          // OPTIMIZED: Filter available cards early, use EXISTS for subtitle check
          // When no main_language filter, use EXISTS with language match
          stmt = `
            SELECT
              c.id AS card_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.image_key,
              c.audio_key,
              c.difficulty_score,
              e.slug AS episode_slug,
              e.episode_number,
              ci.slug AS content_slug,
              ci.slug AS film_id,
              e.slug AS episode_id,
              ci.main_language AS content_main_language,
              ci.title AS content_title
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )`;
        }
      }

      if (contentIdsCount > 0) {
        stmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
      }

      if (hasDifficultyFilter) {
        stmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
      }

      // Optimize level filter: use JOIN instead of EXISTS for better performance
      if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
        stmt += ` AND EXISTS (
          SELECT 1 FROM card_difficulty_levels cdl
          WHERE cdl.card_id = c.id
            AND cdl.framework = ?
            AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
        )`;
      }

      // Length filter: count words in main language subtitle
      // For languages with spaces (en, es, fr, etc.): count spaces + 1
      // For CJK languages (ja, zh, ko): count characters (each character is roughly a word)
      if (hasLengthFilter && mainLanguage) {
        const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
        if (isCJK) {
          // For CJK: count characters (each character is roughly a word)
          const conditions = [];
          if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
          if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
          const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
          stmt += ' AND EXISTS (\n' +
            '                SELECT 1 FROM card_subtitles cs_length\n' +
            '                WHERE cs_length.card_id = c.id\n' +
            '                  AND cs_length.language = ?\n' +
            '                  AND cs_length.text IS NOT NULL\n' +
            '                  AND cs_length.text != \'\'\n';
          if (conditionsStr) {
            stmt += '                  ' + conditionsStr + '\n';
          }
          stmt += '              )';
        } else {
          // For languages with spaces: count words by counting spaces + 1
          // Formula: (LENGTH(text) - LENGTH(REPLACE(text, ' ', ''))) + 1
          const wordCountExpr = '(\n' +
            '                CASE \n' +
            '                  WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
            '                  WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
            '                  ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
            '                END\n' +
            '              )';
          const conditions = [];
          if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
          if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
          const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
          stmt += ' AND EXISTS (\n' +
            '                SELECT 1 FROM card_subtitles cs_length\n' +
            '                WHERE cs_length.card_id = c.id\n' +
            '                  AND cs_length.language = ?\n' +
            '                  AND cs_length.text IS NOT NULL\n' +
            '                  AND cs_length.text != \'\'\n' +
            '                  AND LENGTH(cs_length.text) > 0\n';
          if (conditionsStr) {
            stmt += '                  ' + conditionsStr + '\n';
          }
          stmt += '              )';
        }
      }

      // Duration filter: filter by audio duration
      if (hasDurationFilter) {
        stmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
      }

      // Review filter: filter by review_count from user_card_states
      if (hasReviewFilter) {
        const conditions = [];
        if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
        if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
        const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
        stmt += ' AND EXISTS (\n' +
          '              SELECT 1 FROM user_card_states ucs_review\n' +
          '              WHERE ucs_review.user_id = ?\n' +
          '                AND ucs_review.card_id = c.id\n';
        if (conditionsStr) {
          stmt += '                ' + conditionsStr + '\n';
        }
        stmt += '            )';
      }

      stmt += ` ${textSearchCondition}
        ORDER BY c.id ASC
        LIMIT ? OFFSET ?;
      `;

      // ORDER BY c.id ASC - simple and fast, uses primary key index
      // Removed difficulty_score sorting for better performance

      // Build optimized count query with JOIN
      // OPTIMIZED: Use same structure as main query for consistency and better performance
      let countStmt = '';

      if (subtitleLangsCount > 0) {
        // Use same logic as main query: check if mapping table has data
        // Reuse useSummaryTable variable from main query check
        if (useSummaryTable) {
          // OPTIMIZED: Filter by main_language and available cards early, use mapping table with EXISTS
          countStmt = `
            SELECT COUNT(DISTINCT c.id) AS total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              ${mainLanguage ? 'AND ci.main_language = ?' : ''}
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
              AND (
                SELECT COUNT(DISTINCT cslm.language)
                FROM card_subtitle_language_map cslm
                WHERE cslm.card_id = c.id
                  AND cslm.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              ) >= ?
          `;
        } else {
          // OPTIMIZED: Filter by main_language and available cards early, use EXISTS for subtitle check
          // Fallback: use EXISTS instead of JOIN to reduce intermediate rows
          countStmt = `
            SELECT COUNT(DISTINCT c.id) AS total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              ${mainLanguage ? 'AND ci.main_language = ?' : ''}
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
              AND (
                SELECT COUNT(DISTINCT cs_filter.language)
                FROM card_subtitles cs_filter
                WHERE cs_filter.card_id = c.id
                  AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              ) >= ?
          `;
        }

        // Add other filters
        if (contentIdsCount > 0) {
          countStmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
        }

        if (hasDifficultyFilter) {
          countStmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
        }

        if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
          countStmt += ` AND EXISTS (
              SELECT 1 FROM card_difficulty_levels cdl
              WHERE cdl.card_id = c.id
                AND cdl.framework = ?
                AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
          )`;
        }

        // Length filter for count query
        if (hasLengthFilter && mainLanguage) {
          const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
          if (isCJK) {
            const conditions = [];
            if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
            if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
            const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
            countStmt += ' AND EXISTS (\n' +
              '                  SELECT 1 FROM card_subtitles cs_length\n' +
              '                  WHERE cs_length.card_id = c.id\n' +
              '                    AND cs_length.language = ?\n' +
              '                    AND cs_length.text IS NOT NULL\n' +
              '                    AND cs_length.text != \'\'\n';
            if (conditionsStr) {
              countStmt += '                    ' + conditionsStr + '\n';
            }
            countStmt += '                )';
          } else {
            const wordCountExpr = '(\n' +
              '                  CASE \n' +
              '                    WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
              '                    WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
              '                    ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
              '                  END\n' +
              '                )';
            const conditions = [];
            if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
            if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
            const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
            countStmt += ' AND EXISTS (\n' +
              '                  SELECT 1 FROM card_subtitles cs_length\n' +
              '                  WHERE cs_length.card_id = c.id\n' +
              '                    AND cs_length.language = ?\n' +
              '                    AND cs_length.text IS NOT NULL\n' +
              '                    AND cs_length.text != \'\'\n' +
              '                    AND LENGTH(cs_length.text) > 0\n';
            if (conditionsStr) {
              countStmt += '                    ' + conditionsStr + '\n';
            }
            countStmt += '                )';
          }
        }

        // Duration filter for count query
        if (hasDurationFilter) {
          countStmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
        }

        // Review filter for count query
        if (hasReviewFilter) {
          const conditions = [];
          if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
          if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
          const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
          countStmt += ' AND EXISTS (\n' +
            '                SELECT 1 FROM user_card_states ucs_review\n' +
            '                WHERE ucs_review.user_id = ?\n' +
            '                  AND ucs_review.card_id = c.id\n';
          if (conditionsStr) {
            countStmt += '                  ' + conditionsStr + '\n';
          }
          countStmt += '              )';
        }

        countStmt += ` ${textSearchCondition}`;
      } else {
        // No subtitle languages: simpler query
        if (mainLanguage) {
          // OPTIMIZED: Filter by main_language and available cards early
          countStmt = `
            SELECT COUNT(DISTINCT c.id) AS total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              AND ci.main_language = ?
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ?
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
          `;
        } else {
          // OPTIMIZED: Filter available cards early, use EXISTS for subtitle check
          countStmt = `
            SELECT COUNT(DISTINCT c.id) AS total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.is_available = 1
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
          `;
        }

        if (contentIdsCount > 0) {
          countStmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
        }

        if (hasDifficultyFilter) {
          countStmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
        }

        if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
          countStmt += ` AND EXISTS (
              SELECT 1 FROM card_difficulty_levels cdl
              WHERE cdl.card_id = c.id
                AND cdl.framework = ?
                AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
          )`;
        }

        // Length filter for count query (no subtitle languages path)
        if (hasLengthFilter && mainLanguage) {
          const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
          if (isCJK) {
            const conditions = [];
            if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
            if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
            const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
            countStmt += ' AND EXISTS (\n' +
              '                  SELECT 1 FROM card_subtitles cs_length\n' +
              '                  WHERE cs_length.card_id = c.id\n' +
              '                    AND cs_length.language = ?\n' +
              '                    AND cs_length.text IS NOT NULL\n' +
              '                    AND cs_length.text != \'\'\n';
            if (conditionsStr) {
              countStmt += '                    ' + conditionsStr + '\n';
            }
            countStmt += '                )';
          } else {
            const wordCountExpr = '(\n' +
              '                  CASE \n' +
              '                    WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
              '                    WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
              '                    ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
              '                  END\n' +
              '                )';
            const conditions = [];
            if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
            if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
            const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
            countStmt += ' AND EXISTS (\n' +
              '                  SELECT 1 FROM card_subtitles cs_length\n' +
              '                  WHERE cs_length.card_id = c.id\n' +
              '                    AND cs_length.language = ?\n' +
              '                    AND cs_length.text IS NOT NULL\n' +
              '                    AND cs_length.text != \'\'\n' +
              '                    AND LENGTH(cs_length.text) > 0\n';
            if (conditionsStr) {
              countStmt += '                    ' + conditionsStr + '\n';
            }
            countStmt += '                )';
          }
        }

        // Duration filter for count query
        if (hasDurationFilter) {
          countStmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
        }

        // Review filter for count query
        if (hasReviewFilter) {
          const conditions = [];
          if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
          if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
          const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
          countStmt += ' AND EXISTS (\n' +
            '                SELECT 1 FROM user_card_states ucs_review\n' +
            '                WHERE ucs_review.user_id = ?\n' +
            '                  AND ucs_review.card_id = c.id\n';
          if (conditionsStr) {
            countStmt += '                  ' + conditionsStr + '\n';
          }
          countStmt += '              )';
        }

        countStmt += ` ${textSearchCondition}`;
      }

      countStmt += `;`;

      // Build params array in order to match SQL structure
      // Note: useSummaryTable variable is already set above when building query
      let params = [];
      let countParams = [];

      // 1. Add mainLanguage params FIRST (in WHERE clause)
      if (subtitleLangsCount === 0 && mainLanguage) {
        // When no subtitle languages and mainLanguage is specified:
        // mainLanguage is used in JOIN condition and WHERE clause
        params.push(mainLanguage); // For JOIN condition
        params.push(mainLanguage); // For WHERE clause
        countParams.push(mainLanguage); // For JOIN condition
        countParams.push(mainLanguage); // For WHERE clause
      } else if (mainLanguage) {
        // When subtitle languages exist and mainLanguage is specified:
        // mainLanguage is used once in WHERE clause (direct comparison, no NULL check)
        params.push(mainLanguage);
        countParams.push(mainLanguage);
      }
      // If mainLanguage is null, don't add any params (no filter)

      // 2. Add subtitle language params (for IN clause in JOIN)
      if (subtitleLangsCount > 0) {
        // Both paths use JOIN with IN: languages in IN clause, then count in HAVING
        params.push(...subtitleLangsArr);
        params.push(subtitleLangsCount); // For HAVING COUNT(DISTINCT ...) = ?
        countParams.push(...subtitleLangsArr);
        countParams.push(subtitleLangsCount); // For HAVING COUNT(DISTINCT ...) = ?
      }

      // 4. Add content IDs if needed
      if (contentIdsCount > 0) {
        params.push(...contentIdsArr);
        countParams.push(...contentIdsArr);
      }

      // 5. Add difficulty filters if needed
      if (hasDifficultyFilter) {
        params.push(difficultyMin !== null ? difficultyMin : 0);
        params.push(difficultyMax !== null ? difficultyMax : 100);
        countParams.push(difficultyMin !== null ? difficultyMin : 0);
        countParams.push(difficultyMax !== null ? difficultyMax : 100);
      }

      // 6. Add level filters if needed
      if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
        params.push(framework);
        params.push(...allowedLevels);
        countParams.push(framework);
        countParams.push(...allowedLevels);
      }

      // 6.5. Add length filters if needed
      if (hasLengthFilter && mainLanguage) {
        const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
        params.push(mainLanguage); // language param
        countParams.push(mainLanguage); // language param
        // Only add min/max params if they are actually set
        if (lengthMin !== null) {
          params.push(lengthMin);
          countParams.push(lengthMin);
        }
        if (lengthMax !== null) {
          params.push(lengthMax);
          countParams.push(lengthMax);
        }
      }

      // 6.6. Add duration filter if needed
      if (hasDurationFilter) {
        params.push(durationMax);
        countParams.push(durationMax);
      }

      // 6.7. Add review filters if needed
      if (hasReviewFilter) {
        params.push(userId);
        countParams.push(userId);
        // Only add min/max params if they are actually set
        if (reviewMin !== null) {
          params.push(reviewMin);
          countParams.push(reviewMin);
        }
        if (reviewMax !== null) {
          params.push(reviewMax);
          countParams.push(reviewMax);
        }
      }

      // 7. Add text search query if needed
      if (hasTextQuery && ftsQuery) {
        // FTS search: use built FTS query (works for all languages including CJK)
        if (mainLanguage) {
          // Add language filter first, then FTS query
          params.push(mainLanguage);
          params.push(ftsQuery);
          countParams.push(mainLanguage);
          countParams.push(ftsQuery);
        } else {
          // No language filter - just FTS query
          params.push(ftsQuery);
          countParams.push(ftsQuery);
        }
      }

      // 8. Add pagination params (only for main query, not count)
      // Use fetchLimit (1.5x size) to ensure we have enough cards from different content_items
      // Reduced to avoid "too many SQL variables" error in batch fetching
      const fetchLimit = Math.min(Math.ceil(size * 1.5), 75); // Max 75 cards to avoid SQL variable limit
      params.push(fetchLimit);
      params.push(offset);

      const pageNum = Math.floor(offset / size) + 1;
      const skipCount = true; // Always skip count for maximum speed

      // Execute main query only
      // Log params count for debugging "too many SQL variables" error
      const totalParams = params.length;
      if (totalParams > 500) {
        console.warn(`[WORKER /api/search] High param count: ${totalParams}`, {
          subtitleLangsCount,
          contentIdsCount,
          hasDifficultyFilter,
          hasLevelFilter,
          allowedLevelsCount: allowedLevels?.length || 0,
          hasTextQuery
        });
      }

      const queryStart = Date.now();
      console.log(`[PERF /api/search] Query start | Params: ${params.length} | SubtitleLangs: ${subtitleLangsCount} | MainLang: ${mainLanguage || 'none'}`);
      console.log(`[PERF /api/search] Query params:`, JSON.stringify(params.slice(0, 10))); // Log first 10 params for debugging

      // Debug: Log a simplified test query to see if data exists
      if (subtitleLangsCount > 0 && useSummaryTable) {
        try {
          const testQuery = `
            SELECT COUNT(*) as cnt 
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            JOIN card_subtitles cs_main ON cs_main.card_id = c.id
              AND cs_main.language = ci.main_language
              AND cs_main.text IS NOT NULL
              AND cs_main.text != ''
            JOIN card_subtitle_language_map cslm ON cslm.card_id = c.id
              AND cslm.language = ?
            WHERE ci.main_language = ?
              AND c.is_available = 1
            LIMIT 10
          `;
          const testResult = await env.DB.prepare(testQuery).bind(subtitleLangsArr[0], mainLanguage).all();
          console.log(`[PERF /api/search] Test query (simple JOIN): ${(testResult.results || []).length} rows`);
        } catch (e) {
          console.error(`[PERF /api/search] Test query error:`, e.message);
        }
      }

      let cardsResult;
      try {
        // Debug: Log params count and SQL placeholders count
        const placeholderCount = (stmt.match(/\?/g) || []).length;
        if (params.length !== placeholderCount) {
          console.error(`[PERF /api/search] Param mismatch! SQL has ${placeholderCount} placeholders but ${params.length} params`);
          console.error(`[PERF /api/search] SQL:`, stmt.substring(0, 1000));
          console.error(`[PERF /api/search] Params:`, JSON.stringify(params));
          throw new Error(`SQL parameter mismatch: expected ${placeholderCount} params, got ${params.length}`);
        }
        cardsResult = await env.DB.prepare(stmt).bind(...params).all();
      } catch (queryError) {
        console.error(`[PERF /api/search] Query ERROR:`, queryError.message);
        console.error(`[PERF /api/search] Query SQL (first 1000 chars):`, stmt.substring(0, 1000));
        console.error(`[PERF /api/search] Params count: ${params.length}`);
        console.error(`[PERF /api/search] Params:`, JSON.stringify(params.slice(0, 20))); // Log first 20 params
        return json({ error: queryError.message || 'Database query failed', items: [], total: 0, page, size }, { status: 500 });
      }

      queryTime = Date.now() - queryStart;
      const totalStart = Date.now();
      console.log(`[PERF /api/search] [${requestId}] Main query completed: ${queryTime}ms | Rows: ${(cardsResult.results || []).length}`);

      // Debug: If 0 rows, log more details
      if ((cardsResult.results || []).length === 0 && subtitleLangsCount > 0) {
        console.log(`[PERF /api/search] DEBUG: 0 rows returned. Checking mapping table coverage...`);
        try {
          const coverageCheck = await env.DB.prepare(`
            SELECT COUNT(DISTINCT c.id) as card_count
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            JOIN card_subtitles cs_main ON cs_main.card_id = c.id
              AND cs_main.language = ci.main_language
              AND cs_main.text IS NOT NULL
              AND cs_main.text != ''
            WHERE ci.main_language = ?
              AND c.is_available = 1
              AND EXISTS (SELECT 1 FROM card_subtitle_language_map cslm WHERE cslm.card_id = c.id AND cslm.language = ?)
          `).bind(mainLanguage, subtitleLangsArr[0]).first();
          console.log(`[PERF /api/search] DEBUG: Cards with main_lang=${mainLanguage} AND subtitle_lang=${subtitleLangsArr[0]}: ${coverageCheck?.card_count || 0}`);
        } catch (e) {
          console.error(`[PERF /api/search] DEBUG query error:`, e.message);
        }
      }

      // Use placeholder total - frontend can fetch separately if needed
      total = -1; // Signal that total is not available
      const cardRows = cardsResult.results || [];
      batchStart = null;

      if (cardRows.length > 0) {
        batchStart = Date.now();
        const cardIds = cardRows.map(r => r.card_id);
        const subsMap = new Map();
        const cefrLevelMap = new Map();
        const levelsMap = new Map(); // Full levels map for all frameworks - declared outside block

        // Only fetch additional subtitle languages (not main language - already have it)
        const additionalSubLangs = subtitleLangsArr.filter(lang => lang !== mainLanguage);
        const needsAdditionalSubs = additionalSubLangs.length > 0;

        // OPTIMIZED: Combine all data fetching into fewer, larger batches
        // Fetch main subtitles, additional subtitles, and levels together per batch
        const batchSize = 50; // Reduced batch size for faster individual queries

        // Group cards by main language for efficient fetching
        const cardsByLang = new Map();
        for (const r of cardRows) {
          const lang = r.content_main_language;
          if (!cardsByLang.has(lang)) {
            cardsByLang.set(lang, []);
          }
          cardsByLang.get(lang).push(r.card_id);
        }

        const allPromises = [];

        // Process each language group
        for (const [mainLang, langCardIds] of cardsByLang.entries()) {
          // Process cards in batches
          for (let i = 0; i < langCardIds.length; i += batchSize) {
            const batch = langCardIds.slice(i, i + batchSize);
            const placeholders = batch.map(() => '?').join(',');

            // Build queries for this batch: main subtitle + additional subtitles + levels
            const batchQueries = [];

            // 1. Main language subtitle (always needed)
            batchQueries.push(
              env.DB.prepare(`
                SELECT card_id, text
                FROM card_subtitles
                WHERE card_id IN (${placeholders})
                  AND language = ?
                  AND text IS NOT NULL
                  AND LENGTH(text) > 0
              `).bind(...batch, mainLang).all()
            );

            // 2. Additional subtitle languages (if needed)
            if (needsAdditionalSubs) {
              const maxVarsForSubs = 800; // Safety margin
              const safeBatchSizeForSubs = Math.max(1, maxVarsForSubs - additionalSubLangs.length);
              const actualSubBatchSize = Math.min(batchSize, safeBatchSizeForSubs);

              // Split batch if needed for additional subs to stay under SQL variable limit
              for (let j = 0; j < batch.length; j += actualSubBatchSize) {
                const subBatch = batch.slice(j, j + actualSubBatchSize);
                const subPlaceholders = subBatch.map(() => '?').join(',');
                batchQueries.push(
                  env.DB.prepare(`
                    SELECT card_id, language, text
                    FROM card_subtitles
                    WHERE card_id IN (${subPlaceholders})
                      AND language IN (${additionalSubLangs.map(() => '?').join(',')})
                  `).bind(...subBatch, ...additionalSubLangs).all()
                );
              }
            }

            // 3. Full levels array (all frameworks)
            batchQueries.push(
              env.DB.prepare(`
                SELECT card_id, framework, level, language
                FROM card_difficulty_levels
                WHERE card_id IN (${placeholders})
              `).bind(...batch).all()
            );

            // Execute all queries for this batch and process results
            allPromises.push(
              Promise.all(batchQueries).then((results) => {
                // Process main subtitle (first result)
                const mainSubResult = results[0];
                if (mainSubResult && mainSubResult.results) {
                  for (const row of mainSubResult.results) {
                    if (!subsMap.has(row.card_id)) {
                      subsMap.set(row.card_id, {});
                    }
                    subsMap.get(row.card_id)[mainLang] = row.text;
                  }
                }

                // Process additional subtitles (results 1 to N-1, excluding last which is levels)
                const additionalSubsStart = 1;
                const levelsResultIndex = results.length - 1;
                for (let idx = additionalSubsStart; idx < levelsResultIndex; idx++) {
                  const subsResult = results[idx];
                  if (subsResult && subsResult.results) {
                    for (const row of subsResult.results) {
                      if (!subsMap.has(row.card_id)) {
                        subsMap.set(row.card_id, {});
                      }
                      subsMap.get(row.card_id)[row.language] = row.text;
                    }
                  }
                }

                // Process levels (last result)
                const levelsResult = results[levelsResultIndex];
                if (levelsResult && levelsResult.results) {
                  for (const row of levelsResult.results) {
                    if (!levelsMap.has(row.card_id)) {
                      levelsMap.set(row.card_id, []);
                    }
                    levelsMap.get(row.card_id).push({
                      framework: row.framework,
                      level: row.level,
                      language: row.language || null
                    });
                    // Also set CEFR level for backward compatibility
                    if (row.framework === 'CEFR') {
                      cefrLevelMap.set(row.card_id, row.level);
                    }
                  }
                }
              })
            );
          }
        }

        // Execute batches with increased concurrency for better performance
        const maxConcurrentBatchQueries = 20; // Increased for better parallelism
        const batchExecuteStart = Date.now();
        for (let i = 0; i < allPromises.length; i += maxConcurrentBatchQueries) {
          const batch = allPromises.slice(i, i + maxConcurrentBatchQueries);
          const batchStartTime = Date.now();
          await Promise.all(batch);
          const batchTime = Date.now() - batchStartTime;
          console.log(`[PERF /api/search] [${requestId}] Batch ${Math.floor(i / maxConcurrentBatchQueries) + 1} completed: ${batchTime}ms`);
        }
        const batchTime = Date.now() - batchStart;
        console.log(`[PERF /api/search] [${requestId}] Combined batch fetch: ${batchTime}ms for ${cardIds.length} cards (${allPromises.length} queries)`);

        // Map cards to response format - use makeMediaUrl to build full URLs from image_key/audio_key
        const allMappedCards = cardRows.map(r => ({
          card_id: r.card_id,
          content_slug: r.content_slug,
          content_title: r.content_title,
          episode_slug: r.episode_slug,
          episode_number: r.episode_number,
          film_id: r.content_slug, // Use content_slug as film_id for media URL construction
          episode_id: r.episode_slug, // Use episode_slug as episode_id for media URL construction
          card_number: r.card_number,
          start_time: r.start_time,
          end_time: r.end_time,
          image_url: makeMediaUrl(r.image_key),
          audio_url: makeMediaUrl(r.audio_key),
          difficulty_score: r.difficulty_score,
          text: (subsMap.get(r.card_id) && subsMap.get(r.card_id)[r.content_main_language]) || '', // Get main subtitle from batch fetch
          subtitle: subsMap.get(r.card_id) || {},
          cefr_level: cefrLevelMap.get(r.card_id) || null,
          levels: levelsMap.get(r.card_id) || [] // Full levels array for level badges display
        }));

        // Optimized content distribution: ensure no duplicate content_items in first N cards
        // Goal: Each of the first 50 cards should be from a different content_item if possible
        if (allMappedCards.length <= size) {
          // Not enough cards: return all cards
          items = allMappedCards;
        } else {
          // Quick check: count unique content_items
          const uniqueContents = new Set(allMappedCards.map(c => c.content_slug));

          if (uniqueContents.size <= 1) {
            // Only one content_item: return first N cards (already sorted)
            items = allMappedCards.slice(0, size);
          } else {
            // Multiple content_items: distribute to ensure unique content_items
            // Group by content_slug (single pass, O(n))
            const cardsByContent = new Map();
            for (const card of allMappedCards) {
              const slug = card.content_slug;
              if (!cardsByContent.has(slug)) {
                cardsByContent.set(slug, []);
              }
              cardsByContent.get(slug).push(card);
            }

            // Smart distribution: ensure each card from different content_item (round-robin)
            // Strategy: Take 1 card from each content_item per round, repeat until we have enough
            // This ensures maximum diversity: if we have 10 content_items, first 10 cards are all different
            const distributedCards = [];
            const contentArrays = Array.from(cardsByContent.values());
            let round = 0;
            let iterations = 0;
            const maxIterations = size * 3; // Safety limit

            while (distributedCards.length < size && iterations < maxIterations) {
              let cardsAddedThisRound = 0;

              // One round: take 1 card from each content_item (if available)
              for (let i = 0; i < contentArrays.length && distributedCards.length < size; i++) {
                const currentArray = contentArrays[i];
                if (currentArray && currentArray.length > 0) {
                  distributedCards.push(currentArray.shift());
                  cardsAddedThisRound++;
                }
              }

              // If no cards were added this round, we're done
              if (cardsAddedThisRound === 0) break;

              round++;
              iterations++;
            }

            items = distributedCards;
          }
        }
      }

      } // End of complex query block (items.length === 0 guard)

      const totalTime = Date.now() - startTime;
      const batchTime = batchStart ? (Date.now() - batchStart) : 0;
      console.log(`[PERF /api/search] [${requestId}] Total: ${totalTime}ms | Query: ${queryTime}ms | Batch: ${batchTime}ms | Cards: ${items.length} | Page: ${page} | SubtitleLangs: ${subtitleLangsCount}`);

      // Extract content_meta if attached by Quick Browse
      const contentMetaFromBrowse = items._content_meta || null;
      if (items._content_meta) delete items._content_meta;
      const responseData = { items, total, page, size };
      if (contentMetaFromBrowse) responseData.content_meta = contentMetaFromBrowse;

      // Save to KV cache (async, don't wait)
      if (env.SEARCH_CACHE) {
        env.SEARCH_CACHE.put(cacheKey, JSON.stringify({
          data: responseData,
          timestamp: Date.now()
        }), { expirationTtl: CACHE_TTL }).catch(err => {
          console.error('[CACHE ERROR /api/search] Failed to save cache:', err);
        });
      }

      // Add cache headers for faster subsequent requests
      const response = json(responseData, {
        headers: {
          'Cache-Control': 'public, max-age=60, s-maxage=60', // Cache for 1 minute
          'X-Cache': 'MISS',
        }
      });
      return response;

    } catch (e) {
      console.error('[WORKER /api/search] Error:', e);
      console.error('[WORKER /api/search] Stack:', e.stack);
      console.error('[WORKER /api/search] Params:', {
        q,
        mainLanguage,
        subtitleLangsCount,
        contentIdsCount,
        hasDifficultyFilter,
        hasLevelFilter
      });
      return json({ error: 'search_failed', message: String(e) }, { status: 500 });
    }
  });

  router.get('/api/search/counts', async (request, env) => {
    const url = new URL(request.url);
    // Build cache key from query params
    const countsCacheKey = `search_counts:${url.searchParams.toString()}`;
    const COUNTS_CACHE_TTL = 600; // 10 minutes cache for counts (less frequently updated)

    try {
      // Check KV cache first
      if (env.SEARCH_CACHE) {
        const cached = await env.SEARCH_CACHE.get(countsCacheKey, { type: 'json' });
        if (cached && cached.data && cached.timestamp) {
          const age = (Date.now() - cached.timestamp) / 1000;
          if (age < COUNTS_CACHE_TTL) {
            console.log(`[CACHE HIT /api/search/counts] Age: ${age.toFixed(1)}s`);
            return json(cached.data, {
              headers: {
                'X-Cache': 'HIT',
                'X-Cache-Age': Math.round(age).toString(),
              }
            });
          }
        }
      }

      const mainLanguage = url.searchParams.get('main_language');
      const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || '';
      const contentIdsCsv = url.searchParams.get('content_ids') || '';
      const qRaw = url.searchParams.get('q') || '';
      const q = qRaw.trim();

      // Parse subtitle languages into array
      const subtitleLangsArr = subtitleLanguagesCsv
        ? Array.from(new Set(subtitleLanguagesCsv.split(',').map(s => s.trim()).filter(Boolean)))
        : [];
      const subtitleLangsCount = subtitleLangsArr.length;

      // Parse content ids
      const contentIdsArr = contentIdsCsv
        ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean)))
        : [];
      const contentIdsCount = contentIdsArr.length;

      // Parse difficulty filters
      const difficultyMinRaw = url.searchParams.get('difficulty_min');
      const difficultyMaxRaw = url.searchParams.get('difficulty_max');
      const difficultyMin = difficultyMinRaw ? Number(difficultyMinRaw) : null;
      const difficultyMax = difficultyMaxRaw ? Number(difficultyMaxRaw) : null;
      const hasDifficultyFilter = (difficultyMin !== null && difficultyMin > 0) || (difficultyMax !== null && difficultyMax < 100);

      // Parse level filters
      const levelMinRaw = url.searchParams.get('level_min');
      const levelMaxRaw = url.searchParams.get('level_max');
      const levelMin = levelMinRaw ? String(levelMinRaw).trim() : null;
      const levelMax = levelMaxRaw ? String(levelMaxRaw).trim() : null;
      const hasLevelFilter = levelMin !== null || levelMax !== null;
      const framework = getFrameworkFromLanguage(mainLanguage);

      // Build allowed levels list for level filter
      let allowedLevels = null;
      if (hasLevelFilter) {
        const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
        const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
        const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

        let levelOrder = [];
        if (framework === 'CEFR') levelOrder = CEFR;
        else if (framework === 'JLPT') levelOrder = JLPT;
        else if (framework === 'HSK') levelOrder = HSK;

        if (levelOrder.length > 0) {
          const minIdx = levelMin ? levelOrder.indexOf(levelMin.toUpperCase()) : 0;
          const maxIdx = levelMax ? levelOrder.indexOf(levelMax.toUpperCase()) : levelOrder.length - 1;
          if (minIdx >= 0 && maxIdx >= 0 && minIdx <= maxIdx) {
            allowedLevels = levelOrder.slice(minIdx, maxIdx + 1);
          }
        }
      }

      // If there is a text query, use FTS5 with trigram tokenizer to compute counts
      if (q) {
        const mainCanon = mainLanguage ? String(mainLanguage).toLowerCase() : null;
        const ftsQuery = buildFtsQuery(q, mainLanguage || '');

        // Use FTS5 for all queries including CJK (trigram tokenizer handles CJK efficiently)
        if (ftsQuery) {
          let sql = `
            SELECT 
              ci.slug AS content_id,
              COUNT(DISTINCT c.id) AS count
            FROM card_subtitles_fts
            JOIN cards c ON c.id = card_subtitles_fts.card_id
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE card_subtitles_fts MATCH ?
              AND c.is_available = 1
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND TRIM(cs_main.text) != ''
              )`;
          const params = [ftsQuery];

          if (mainCanon) {
            // Search only in main language subtitles and main_language content
            sql += ' AND LOWER(card_subtitles_fts.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)';
            params.push(mainCanon, mainCanon);
          }
          if (subtitleLangsCount > 0) {
            // Require that card has all selected subtitle languages (filter layer)
            sql += ` AND (
              SELECT COUNT(DISTINCT cs.language)
              FROM card_subtitles cs
              WHERE cs.card_id = c.id
                AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
            ) = ?`;
            params.push(...subtitleLangsArr, subtitleLangsCount);
          }
          if (contentIdsCount > 0) {
            sql += ` AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`;
            params.push(...contentIdsArr);
          }
          sql += ' GROUP BY ci.slug';

          const det = await env.DB.prepare(sql).bind(...params).all();
          const countsMap = {};
          for (const row of (det.results || [])) {
            countsMap[row.content_id] = row.count || 0;
          }
          return json({ counts: countsMap });
        } else {
          // No valid FTS query: no matches
          return json({ counts: {} });
        }
      }

      // No text query: simple counts by main_language / subtitle_languages / content_ids
      // Use positional placeholders for easier binding
      const countsWhere = [];
      const countsParams = []; // Initialize early, will be rebuilt after countsStmt is built

      // Main language filter - handled differently based on subtitleLangsCount
      // When no subtitle languages and mainLanguage exists, it's handled in JOIN/WHERE of countsStmt
      // Otherwise, use standard NULL check
      if (subtitleLangsCount === 0 && mainLanguage) {
        // Will be handled in countsStmt WHERE clause, don't add here
      } else {
        countsWhere.push('(? IS NULL OR ci.main_language = ?)');
        countsParams.push(mainLanguage || null);
        countsParams.push(mainLanguage || null);
      }

      // Content IDs filter
      if (contentIdsCount > 0) {
        if (contentIdsCount > 300) {
          // Too many content IDs: use EXISTS subquery instead of IN
          countsWhere.push(`EXISTS (
            SELECT 1 FROM (VALUES ${contentIdsArr.map(() => '(?)').join(',')}) AS v(slug)
            WHERE v.slug = ci.slug
          )`);
          countsParams.push(...contentIdsArr);
        } else {
          countsWhere.push(`ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`);
          countsParams.push(...contentIdsArr);
        }
      }

      // Difficulty filter
      if (hasDifficultyFilter) {
        countsWhere.push('c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?');
        countsParams.push(difficultyMin !== null ? difficultyMin : 0);
        countsParams.push(difficultyMax !== null ? difficultyMax : 100);
      }

      // Level filter
      if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
        countsWhere.push(`EXISTS (
          SELECT 1 FROM card_difficulty_levels cdl
          WHERE cdl.card_id = c.id
            AND cdl.framework = ?
            AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
        )`);
        countsParams.push(framework);
        countsParams.push(...allowedLevels);
      }

      // Add is_available filter
      countsWhere.push('c.is_available = 1');

      // Build optimized counts query with JOIN for subtitle filter
      // Use JOIN instead of EXISTS for better performance
      // When no subtitle languages, use simpler query without GROUP BY for better performance
      let countsStmt;

      if (subtitleLangsCount > 0) {
        // OPTIMIZED: Use EXISTS instead of JOIN + GROUP BY + HAVING for much better performance
        // This avoids expensive nested GROUP BY operations
        countsStmt = `
        SELECT 
          ci.slug AS content_id,
          COUNT(DISTINCT c.id) AS count
        FROM cards c
        JOIN episodes e ON e.id = c.episode_id
        JOIN content_items ci ON ci.id = e.content_item_id
        WHERE ${countsWhere.join('\n              AND ')}
          AND EXISTS (
            SELECT 1 FROM card_subtitles cs_main
            WHERE cs_main.card_id = c.id
              AND cs_main.language = ci.main_language
              AND cs_main.text IS NOT NULL
              AND cs_main.text != ''
          )
          AND (
            SELECT COUNT(DISTINCT cs_filter.language)
            FROM card_subtitles cs_filter
            WHERE cs_filter.card_id = c.id
              AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
          ) >= ?
        GROUP BY ci.slug
        `;
        // Build countsParams for this query structure
        countsParams.length = 0; // Clear and rebuild
        // Add mainLanguage params for WHERE clause
        if (!(subtitleLangsCount === 0 && mainLanguage)) {
          countsParams.push(mainLanguage || null);
          countsParams.push(mainLanguage || null);
        }
        // Add WHERE clause params
        if (contentIdsCount > 0) {
          countsParams.push(...contentIdsArr);
        }
        if (hasDifficultyFilter) {
          countsParams.push(difficultyMin !== null ? difficultyMin : 0);
          countsParams.push(difficultyMax !== null ? difficultyMax : 100);
        }
        if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
          countsParams.push(framework);
          countsParams.push(...allowedLevels);
        }
        // Add subtitleLangs for EXISTS subquery
        countsParams.push(...subtitleLangsArr);
        // Add subtitleLangsCount for COUNT comparison
        countsParams.push(subtitleLangsCount);
      } else {
        // No subtitle languages: use INNER JOIN with main_language filter in JOIN condition
        // This allows query optimizer to use index idx_card_subtitles_language(language, card_id) efficiently
        if (mainLanguage) {
          // When main_language is specified, filter by it directly in JOIN for better performance
          countsStmt = `
            SELECT 
              ci.slug AS content_id,
              COUNT(c.id) AS count
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            INNER JOIN card_subtitles cs_main ON cs_main.card_id = c.id 
              AND cs_main.language = ?
              AND cs_main.text IS NOT NULL
              AND cs_main.text != ''
            WHERE ${countsWhere.join('\n              AND ')}
              AND ci.main_language = ?
        GROUP BY ci.slug
      `;
        } else {
          // When no main_language filter, use EXISTS with language match
          countsStmt = `
            SELECT 
              ci.slug AS content_id,
              COUNT(DISTINCT c.id) AS count
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE ${countsWhere.join('\n              AND ')}
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id 
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
            GROUP BY ci.slug
          `;
        }
      }

      // Rebuild countsParams AFTER building countsStmt to ensure correct order (if not already built)
      if (subtitleLangsCount === 0) {
        // Only rebuild if not already built (for subtitleLangsCount > 0 case, it's built above)
        countsParams.length = 0; // Clear and rebuild

        // Add params based on query structure
        if (mainLanguage) {
          // When no subtitle languages and mainLanguage is specified:
          // Query structure: JOIN cs_main.language = ? ... WHERE ... AND ci.main_language = ?
          countsParams.push(mainLanguage); // For JOIN condition (cs_main.language = ?)
          // Add WHERE clause params in order: contentIds, difficulty, level, then mainLanguage
          if (contentIdsCount > 0) {
            countsParams.push(...contentIdsArr);
          }
          if (hasDifficultyFilter) {
            countsParams.push(difficultyMin !== null ? difficultyMin : 0);
            countsParams.push(difficultyMax !== null ? difficultyMax : 100);
          }
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            countsParams.push(framework);
            countsParams.push(...allowedLevels);
          }
          // Add mainLanguage for WHERE clause (ci.main_language = ?)
          countsParams.push(mainLanguage);
        } else {
          // When no subtitle languages and no mainLanguage filter:
          // Query structure: WHERE ... AND EXISTS (...)
          // Add mainLanguage params first (for WHERE clause)
          countsParams.push(mainLanguage || null);
          countsParams.push(mainLanguage || null);
          // Add WHERE clause params
          if (contentIdsCount > 0) {
            countsParams.push(...contentIdsArr);
          }
          if (hasDifficultyFilter) {
            countsParams.push(difficultyMin !== null ? difficultyMin : 0);
            countsParams.push(difficultyMax !== null ? difficultyMax : 100);
          }
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            countsParams.push(framework);
            countsParams.push(...allowedLevels);
          }
        }
      }

      // OPTIMIZATION: Skip expensive count query - frontend can calculate from results
      // Count query was taking 40-50 seconds on 550k cards, blocking user experience
      // Frontend can calculate approximate counts from search results or use cached counts
      const countsStart = Date.now();
      let countsMap = {};

      // Only run count query if explicitly requested via ?include_counts=true (for admin pages)
      const includeCounts = url.searchParams.get('include_counts') === 'true';

      if (includeCounts) {
        // Admin pages can wait for accurate counts
        const countsResult = await env.DB.prepare(countsStmt).bind(...countsParams).all();
        for (const row of (countsResult.results || [])) {
          countsMap[row.content_id] = row.count || 0;
        }
        const countsTime = Date.now() - countsStart;
        console.log('[WORKER /api/search/counts] Query time:', countsTime, 'ms | Result:', {
          rowCount: countsResult.results?.length || 0,
          sampleKeys: Object.keys(countsMap).slice(0, 5),
          totalParams: countsParams.length,
          hasSubtitleLangs: subtitleLangsCount > 0
        });
      } else {
        // Return empty counts immediately - frontend will calculate from results
        // This reduces response time from 40-50s to <100ms
        console.log('[WORKER /api/search/counts] Skipped count query for performance | Returning empty counts');
      }

      const responseData = { counts: countsMap };

      // Save to KV cache (async, don't wait)
      if (env.SEARCH_CACHE) {
        env.SEARCH_CACHE.put(countsCacheKey, JSON.stringify({
          data: responseData,
          timestamp: Date.now()
        }), { expirationTtl: COUNTS_CACHE_TTL }).catch(err => {
          console.error('[CACHE ERROR /api/search/counts] Failed to save cache:', err);
        });
      }

      return json(responseData, {
        headers: {
          'X-Cache': 'MISS',
        }
      });

    } catch (e) {
      console.error('[WORKER /api/search/counts] Error:', e);
      console.error('[WORKER /api/search/counts] Stack:', e.stack);
      console.error('[WORKER /api/search/counts] Params:', {
        mainLanguage,
        subtitleLangsCount,
        contentIdsCount,
        hasDifficultyFilter,
        hasLevelFilter,
        countsParamsLength: countsParams.length
      });
      return json({ error: 'counts_failed', message: String(e) }, { status: 500 });
    }
  });
}
