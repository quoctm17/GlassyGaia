// Cloudflare Worker (JavaScript) compatible with Dashboard Quick Edit and wrangler
// Bindings required: DB (D1), MEDIA_BUCKET (R2)

function withCors(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    ...headers,
  };
}

function buildFtsQuery(q) {
  const cleaned = (q || '').trim();
  if (!cleaned) return '';
  // If the user wraps text in quotes, treat it as an exact phrase
  const quotedMatch = cleaned.match(/^\s*"([\s\S]+)"\s*$/);
  if (quotedMatch) {
    const phrase = quotedMatch[1].replace(/["']/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().replace(/\s+/g, ' ');
    return phrase ? `"${phrase}"` : '';
  }
  // Otherwise, build an exact phrase from tokens (not OR). Strip punctuation.
  const tokens = cleaned
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8); // allow a few more words for phrases
  if (!tokens.length) return '';
  if (tokens.length === 1) {
    // Single word: allow prefix expansion
    const t = escapeFtsToken(tokens[0]);
    return t ? `${t}*` : '';
  }
  // Multi-word: exact phrase matching
  const phrase = tokens.map(escapeFtsToken).join(' ');
  return phrase ? `"${phrase}"` : '';
}

function escapeFtsToken(t) {
  // Remove quotes and stray punctuation that might slip through
  return String(t).replace(/["'.,;:!?()\[\]{}]/g, '');
}

// Japanese helpers: normalize Katakana to Hiragana and full-width forms
function kataToHira(s) {
  return String(s).replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function normalizeJaInput(s) {
  try {
    // NFKC to normalize width; then convert Katakana to Hiragana
    return kataToHira(String(s).normalize('NFKC'));
  } catch {
    return kataToHira(String(s));
  }
}

function hasHanAndKana(s) {
  return /\p{Script=Han}/u.test(s) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
}

function kanaOnlyString(s) {
  // Keep only Hiragana/Katakana and ASCII letters/numbers for safety
  return String(s).replace(/[^\p{Script=Hiragana}\p{Script=Katakana}\p{L}\p{N}\s]/gu, '').trim();
}

// Expand Japanese index text by adding mixed kanji/kana tokens from bracketed furigana: 例) 黒川[くろかわ]
function expandJaIndexText(text) {
  const src = String(text || '');
  const extra = [];
  const re = /(\p{Script=Han}+[\p{Script=Han}・・]*)\[([\p{Script=Hiragana}\p{Script=Katakana}]+)\]/gu;
  let m;
  while ((m = re.exec(src)) !== null) {
    const kan = m[1];
    const rawKana = m[2];
    const hira = normalizeJaInput(rawKana);
    if (!kan || !hira) continue;
    extra.push(kan);
    extra.push(hira);
    const firstKan = kan[0];
    const lastKan = kan[kan.length - 1];
    for (let i = 1; i < hira.length; i++) {
      const pref = hira.slice(0, i);
      const suff = hira.slice(i);
      extra.push(pref + lastKan);
      extra.push(firstKan + suff);
    }
  }
  if (!extra.length) return src;
  // Deduplicate extras to keep FTS text compact
  const uniq = Array.from(new Set(extra.filter(Boolean)));
  return `${src} ${uniq.join(' ')}`;
}
function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: withCors({ 'Content-Type': 'application/json', ...(init.headers || {}) }) });
}

// Map level to numeric index for range filtering
function getLevelIndex(level, language) {
  const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  if (!level) return -1;
  const upper = level.toUpperCase();
  
  // Try CEFR first
  const cefrIdx = CEFR.indexOf(upper);
  if (cefrIdx >= 0) return cefrIdx;
  
  // Try JLPT
  const jlptIdx = JLPT.indexOf(upper);
  if (jlptIdx >= 0) return jlptIdx;
  
  // Try HSK (numeric)
  const hskIdx = HSK.indexOf(level);
  if (hskIdx >= 0) return hskIdx;
  
  return -1;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: withCors() });
      }

      // Search API: FTS-backed card subtitles with caching + main_language filtering + fallback listing
      if (path === '/api/search' && request.method === 'GET') {
        const cache = caches.default;
        const cacheKey = new Request(request.url, request);
        const cached = await cache.match(cacheKey);
        if (cached) return cached;

        const q = url.searchParams.get('q') || '';
        const mainLanguage = url.searchParams.get('main_language');
        const type = url.searchParams.get('type');
        const contentSlug = url.searchParams.get('content_slug');
        const minDifficulty = url.searchParams.get('minDifficulty');
        const maxDifficulty = url.searchParams.get('maxDifficulty');
        const minLevel = url.searchParams.get('minLevel');
        const maxLevel = url.searchParams.get('maxLevel');
        const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
        const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '100', 10), 1), 500);
        const offset = (page - 1) * size;

        // Build FTS query. For Japanese with mixed Kanji+Kana, expand with kana-only OR and post-filter kanji presence.
        let ftsQuery = buildFtsQuery(q);
        const isJa = (mainLanguage === 'ja');
        const qNormJa = isJa ? normalizeJaInput(q) : q;
        const isMixedJa = isJa && hasHanAndKana(qNormJa);
        let kanjiChars = [];
        if (isMixedJa) {
          // Extract unique Kanji characters from query for precise filtering
          const ks = qNormJa.match(/[\p{Script=Han}]/gu) || [];
          kanjiChars = Array.from(new Set(ks));
          // Build kana-only expansion and OR it with the main FTS query to ensure hits
          const kanaOnly = kanaOnlyString(qNormJa).replace(/[\p{Script=Katakana}]/gu, (ch) => kataToHira(ch));
          if (kanaOnly) {
            // Tokenize kana-only and add prefix wildcard to each term for inclusive match
            const kanaTokens = kanaOnly.split(/\s+/).filter(Boolean).map(t => escapeFtsToken(kataToHira(t)) + '*');
            const kanaExpr = kanaTokens.join(' '); // default AND
            // Prefer kana expansion for mixed JA to guarantee hits, rely on kanji filter for precision
            ftsQuery = kanaExpr || ftsQuery;
          }
        }
        const basePublic = env.R2_PUBLIC_BASE || '';
        const makeMediaUrl = (k) => {
          if (!k) return null;
          return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
        };
        const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || url.searchParams.get('subtitle_language') || null;
        const subtitleLangsArr = subtitleLanguagesCsv ? Array.from(new Set(String(subtitleLanguagesCsv).split(',').map(s => s.trim()).filter(Boolean))) : [];
        const subtitleLangsCount = subtitleLangsArr.length;

        // Framework-level filtering params -> numeric indices
        const framework = (mainLanguage === 'ja') ? 'JLPT' : ((mainLanguage || '').startsWith('zh') ? 'HSK' : 'CEFR');
        const applyLevel = (minLevel || maxLevel) ? 1 : 0;
        const maxIndexByFw = framework === 'HSK' ? 8 : (framework === 'JLPT' ? 4 : 5);
        const minIdxEff = applyLevel ? (minLevel ? getLevelIndex(minLevel, mainLanguage) : 0) : null;
        const maxIdxEff = applyLevel ? (maxLevel ? getLevelIndex(maxLevel, mainLanguage) : maxIndexByFw) : null;
        // Expand Chinese main language into a group to include Traditional/Cantonese content
        const mainLower = (mainLanguage || '').toLowerCase();
        const altMain1 = (mainLower === 'zh') ? 'zh_trad' : (mainLower === 'zh_trad' ? 'zh' : null);
        const altMain2 = (mainLower === 'zh' || mainLower === 'zh_trad') ? 'yue' : null;

        if (!ftsQuery) {
          // Fallback listing (latest cards) filtered by content main_language & type & difficulty
          // Distribute results across contents dynamically so total ~= page size
          const stmtFallback = `
            WITH contents AS (
              SELECT id FROM content_items
              WHERE (?1 IS NULL OR main_language IN (?1, COALESCE(?14, ?1), COALESCE(?15, ?1)))
                AND (?2 IS NULL OR type = ?2)
            ),
            req AS (
              SELECT card_id, COUNT(DISTINCT language) AS cnt
              FROM card_subtitles
              WHERE (?7 IS NOT NULL AND instr(',' || ?7 || ',', ',' || language || ',') > 0)
              GROUP BY card_id
            ),
            ranked AS (
              SELECT
                c.id AS card_id,
                c.episode_id,
                c.card_number,
                c.start_time,
                c.end_time,
                c.image_key,
                c.audio_key,
                c.difficulty_score,
                e.slug AS episode_slug,
                e.episode_number AS episode_number,
                ci.id AS content_id,
                ci.slug AS content_slug,
                ci.title AS content_title,
                ci.cover_key AS content_cover_key,
                ci.cover_landscape_key AS content_cover_landscape_key,
                ci.main_language AS content_main_language,
                ROW_NUMBER() OVER (PARTITION BY ci.id ORDER BY c.updated_at DESC, c.card_number ASC) AS rn
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE ci.id IN (SELECT id FROM contents)
                AND (?3 IS NULL OR c.difficulty_score >= ?3)
                AND (?4 IS NULL OR c.difficulty_score <= ?4)
                AND (
                  ?11 IS NULL OR EXISTS (
                    SELECT 1 FROM card_difficulty_levels dl
                    WHERE dl.card_id = c.id
                      AND dl.framework = ?13
                      AND (
                        CASE ?13
                          WHEN 'CEFR' THEN (
                            CASE dl.level
                              WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                          )
                          WHEN 'JLPT' THEN (
                            CASE dl.level
                              WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                          )
                          WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                          ELSE NULL
                        END
                      ) BETWEEN ?11 AND ?12
                  )
                )
            )
            SELECT r.*,
                   cs_main.text AS text,
                   cs_main.language AS language,
                   subs.subs_json AS subs_json,
                   levels.levels_json AS levels_json
            FROM ranked r
            LEFT JOIN card_subtitles cs_main ON cs_main.card_id = r.card_id AND cs_main.language = r.content_main_language
            LEFT JOIN (
              SELECT card_id, json_group_object(language, text) AS subs_json
              FROM card_subtitles
              WHERE (?7 IS NOT NULL AND instr(',' || ?7 || ',', ',' || language || ',') > 0)
              GROUP BY card_id
            ) subs ON subs.card_id = r.card_id
            LEFT JOIN (
              SELECT card_id, json_group_array(json_object('framework', framework, 'level', level, 'language', language)) AS levels_json
              FROM card_difficulty_levels
              GROUP BY card_id
            ) levels ON levels.card_id = r.card_id
            LEFT JOIN req ON req.card_id = r.card_id
            WHERE (?8 = 0 OR req.cnt = ?8)
              AND (?10 IS NULL OR r.content_slug = ?10)
              AND (?9 IS NULL OR 1=1)
            ORDER BY r.rn ASC, r.content_slug ASC, r.card_number ASC
            LIMIT ?5 OFFSET ?6;
          `;
          const stmtCountFallback = `
            WITH contents AS (
              SELECT id FROM content_items
              WHERE (?1 IS NULL OR main_language IN (?1, COALESCE(?14, ?1), COALESCE(?15, ?1)))
                AND (?2 IS NULL OR type = ?2)
            ),
            cards_in_scope AS (
              SELECT c.id AS card_id, ci.slug AS content_slug
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE ci.id IN (SELECT id FROM contents)
                AND (?3 IS NULL OR c.difficulty_score >= ?3)
                AND (?4 IS NULL OR c.difficulty_score <= ?4)
                AND (?10 IS NULL OR 1=1)
                AND (
                  ?11 IS NULL OR EXISTS (
                    SELECT 1 FROM card_difficulty_levels dl
                    WHERE dl.card_id = c.id
                      AND dl.framework = ?13
                      AND (
                        CASE ?13
                          WHEN 'CEFR' THEN (
                            CASE dl.level
                              WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                          )
                          WHEN 'JLPT' THEN (
                            CASE dl.level
                              WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                          )
                          WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                          ELSE NULL
                        END
                      ) BETWEEN ?11 AND ?12
                  )
                )
            ),
            req AS (
              SELECT card_id, COUNT(DISTINCT language) AS cnt
              FROM card_subtitles
              WHERE (?7 IS NOT NULL AND instr(',' || ?7 || ',', ',' || language || ',') > 0)
              GROUP BY card_id
            )
            SELECT content_slug, COUNT(*) AS cnt
            FROM cards_in_scope cis
            LEFT JOIN req ON req.card_id = cis.card_id
            WHERE (?8 = 0 OR req.cnt = ?8)
            GROUP BY content_slug;
          `;
          const stmtTotalFallback = `
            WITH contents AS (
              SELECT id FROM content_items
              WHERE (?1 IS NULL OR main_language IN (?1, COALESCE(?14, ?1), COALESCE(?15, ?1)))
                AND (?2 IS NULL OR type = ?2)
            ),
            cards_in_scope AS (
              SELECT c.id AS card_id
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE ci.id IN (SELECT id FROM contents)
                AND (?3 IS NULL OR c.difficulty_score >= ?3)
                AND (?4 IS NULL OR c.difficulty_score <= ?4)
                AND (?10 IS NULL OR 1=1)
                AND (
                  ?11 IS NULL OR EXISTS (
                    SELECT 1 FROM card_difficulty_levels dl
                    WHERE dl.card_id = c.id
                      AND dl.framework = ?13
                      AND (
                        CASE ?13
                          WHEN 'CEFR' THEN (
                            CASE dl.level
                              WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                          )
                          WHEN 'JLPT' THEN (
                            CASE dl.level
                              WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                          )
                          WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                          ELSE NULL
                        END
                      ) BETWEEN ?11 AND ?12
                  )
                )
            ),
            req AS (
              SELECT card_id, COUNT(DISTINCT language) AS cnt
              FROM card_subtitles
              WHERE (?7 IS NOT NULL AND instr(',' || ?7 || ',', ',' || language || ',') > 0)
              GROUP BY card_id
            )
            SELECT COUNT(*) AS total
            FROM cards_in_scope cis
            LEFT JOIN req ON req.card_id = cis.card_id
            WHERE (?8 = 0 OR req.cnt = ?8);
          `;
          try {
            const { results } = await env.DB.prepare(stmtFallback)
              .bind(mainLanguage, type, minDifficulty, maxDifficulty, size, offset, subtitleLanguagesCsv, subtitleLangsCount, page, contentSlug, minIdxEff, maxIdxEff, framework, altMain1, altMain2)
              .all();
            const countsRes = await env.DB.prepare(stmtCountFallback)
              .bind(
                mainLanguage, // ?1
                type,         // ?2
                minDifficulty, // ?3
                maxDifficulty, // ?4
                size,          // ?5 (unused filler)
                offset,        // ?6 (unused filler)
                subtitleLanguagesCsv, // ?7
                subtitleLangsCount,   // ?8
                page,                  // ?9 (unused filler)
                contentSlug,            // ?10
                minIdxEff,             // ?11
                maxIdxEff,             // ?12
                framework,              // ?13
                altMain1,              // ?14
                altMain2               // ?15
              )
              .all();
            const totalRes = await env.DB.prepare(stmtTotalFallback)
              .bind(
                mainLanguage, // ?1
                type,         // ?2
                minDifficulty, // ?3
                maxDifficulty, // ?4
                size,          // ?5 (unused filler)
                offset,        // ?6 (unused filler)
                subtitleLanguagesCsv, // ?7
                subtitleLangsCount,   // ?8
                page,                  // ?9 (unused filler)
                contentSlug,            // ?10
                minIdxEff,             // ?11
                maxIdxEff,             // ?12
                framework,              // ?13
                altMain1,              // ?14
                altMain2               // ?15
              )
              .all();
            const mapped = (results || []).map(r => {
              let levels = null;
              if (r.levels_json) {
                try {
                  levels = JSON.parse(r.levels_json);
                } catch {}
              }
              return {
                ...r,
                image_url: makeMediaUrl(r.image_key),
                audio_url: makeMediaUrl(r.audio_key),
                levels
              };
            });
            const perContent = {};
            for (const row of (countsRes.results || [])) {
              if (row && row.content_slug) perContent[row.content_slug] = Number(row.cnt) || 0;
            }
            const total = (totalRes.results && totalRes.results[0] && Number(totalRes.results[0].total)) || 0;
            const resp = json({ items: mapped, page, size, total, per_content: perContent }, { headers: { 'cache-control': 'public, max-age=60' } });
            await cache.put(cacheKey, resp.clone());
            return resp;
          } catch (e) {
            return json({ error: 'search_failed', message: String(e) }, { status: 500 });
          }
        }

        const kanjiFilterSql = (isMixedJa && kanjiChars.length)
          ? kanjiChars.map(() => " AND (cs.text LIKE '%' || ? || '%')").join('')
          : '';
        const stmt = `
          SELECT
            cs.card_id,
            bm25(card_subtitles_fts, 10.0, 1.0, 0.0) AS rank,
            cs.language,
            cs.text,
            c.episode_id,
            c.card_number,
            c.start_time,
            c.end_time,
            c.image_key,
            c.audio_key,
            c.difficulty_score,
            e.slug AS episode_slug,
            e.episode_number AS episode_number,
            e.title AS episode_title,
            ci.slug AS content_slug,
            ci.title AS content_title,
            ci.cover_key AS content_cover_key,
            ci.cover_landscape_key AS content_cover_landscape_key,
            ci.main_language AS content_main_language,
            subs.subs_json AS subs_json,
            levels.levels_json AS levels_json
          FROM card_subtitles_fts
          JOIN card_subtitles cs ON cs.card_id = card_subtitles_fts.card_id
          JOIN cards c ON c.id = cs.card_id
          JOIN episodes e ON e.id = c.episode_id
          JOIN content_items ci ON ci.id = e.content_item_id
          LEFT JOIN (
            SELECT card_id, COUNT(DISTINCT language) AS cnt
            FROM card_subtitles
            WHERE (?8 IS NOT NULL AND instr(',' || ?8 || ',', ',' || language || ',') > 0)
            GROUP BY card_id
          ) req ON req.card_id = cs.card_id
          LEFT JOIN (
            SELECT card_id, json_group_object(language, text) AS subs_json
            FROM card_subtitles
            WHERE (?8 IS NOT NULL AND instr(',' || ?8 || ',', ',' || language || ',') > 0)
            GROUP BY card_id
          ) subs ON subs.card_id = cs.card_id
          LEFT JOIN (
            SELECT card_id, json_group_array(json_object('framework', framework, 'level', level, 'language', language)) AS levels_json
            FROM card_difficulty_levels
            GROUP BY card_id
          ) levels ON levels.card_id = cs.card_id
          WHERE card_subtitles_fts MATCH ?1
            AND card_subtitles_fts.language = ci.main_language
            AND cs.language = ci.main_language
            AND (?2 IS NULL OR ci.main_language IN (?2, COALESCE(?14, ?2), COALESCE(?15, ?2)))
            AND (?3 IS NULL OR ci.type = ?3)
            AND (?10 IS NULL OR ci.slug = ?10)
            AND (?4 IS NULL OR c.difficulty_score >= ?4)
            AND (?5 IS NULL OR c.difficulty_score <= ?5)
            AND (
              ?11 IS NULL OR EXISTS (
                SELECT 1 FROM card_difficulty_levels dl
                WHERE dl.card_id = c.id
                  AND dl.framework = ?13
                  AND (
                    CASE ?13
                      WHEN 'CEFR' THEN (
                        CASE dl.level
                          WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                      )
                      WHEN 'JLPT' THEN (
                        CASE dl.level
                          WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                      )
                      WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                      ELSE NULL
                    END
                  ) BETWEEN ?11 AND ?12
              )
            )
            AND (?9 = 0 OR req.cnt = ?9)
            ${kanjiFilterSql}
          ORDER BY rank ASC, c.card_number ASC
          LIMIT ?6 OFFSET ?7;
        `;
        try {
          const { results } = await env.DB.prepare(stmt)
            .bind(ftsQuery, mainLanguage, type, minDifficulty, maxDifficulty, size, offset, subtitleLanguagesCsv, subtitleLangsCount, contentSlug, minIdxEff, maxIdxEff, framework, altMain1, altMain2, ...kanjiChars)
            .all();
          const countStmt = `
            WITH matches AS (
              SELECT DISTINCT cs.card_id, ci.slug AS content_slug
              FROM card_subtitles_fts
              JOIN card_subtitles cs ON cs.card_id = card_subtitles_fts.card_id
              JOIN cards c ON c.id = cs.card_id
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              LEFT JOIN (
                SELECT card_id, COUNT(DISTINCT language) AS cnt
                FROM card_subtitles
                WHERE (?8 IS NOT NULL AND instr(',' || ?8 || ',', ',' || language || ',') > 0)
                GROUP BY card_id
              ) req ON req.card_id = cs.card_id
              WHERE card_subtitles_fts MATCH ?1
                AND card_subtitles_fts.language = ci.main_language
                AND cs.language = ci.main_language
                AND (?2 IS NULL OR ci.main_language IN (?2, COALESCE(?14, ?2), COALESCE(?15, ?2)))
                AND (?3 IS NULL OR ci.type = ?3)
                AND (?10 IS NULL OR 1=1)
                AND (?4 IS NULL OR c.difficulty_score >= ?4)
                AND (?5 IS NULL OR c.difficulty_score <= ?5)
                AND (
                  ?11 IS NULL OR EXISTS (
                    SELECT 1 FROM card_difficulty_levels dl
                    WHERE dl.card_id = c.id
                      AND dl.framework = ?13
                      AND (
                        CASE ?13
                          WHEN 'CEFR' THEN (
                            CASE dl.level
                              WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                          )
                          WHEN 'JLPT' THEN (
                            CASE dl.level
                              WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                          )
                          WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                          ELSE NULL
                        END
                      ) BETWEEN ?11 AND ?12
                  )
                )
                AND (?9 = 0 OR req.cnt = ?9)
                ${kanjiFilterSql}
            )
            SELECT content_slug, COUNT(*) AS cnt FROM matches GROUP BY content_slug;
          `;
          const totalStmt = `
            WITH matches AS (
              SELECT DISTINCT cs.card_id
              FROM card_subtitles_fts
              JOIN card_subtitles cs ON cs.card_id = card_subtitles_fts.card_id
              JOIN cards c ON c.id = cs.card_id
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              LEFT JOIN (
                SELECT card_id, COUNT(DISTINCT language) AS cnt
                FROM card_subtitles
                WHERE (?8 IS NOT NULL AND instr(',' || ?8 || ',', ',' || language || ',') > 0)
                GROUP BY card_id
              ) req ON req.card_id = cs.card_id
              WHERE card_subtitles_fts MATCH ?1
                AND card_subtitles_fts.language = ci.main_language
                AND cs.language = ci.main_language
                AND (?2 IS NULL OR ci.main_language IN (?2, COALESCE(?14, ?2), COALESCE(?15, ?2)))
                AND (?3 IS NULL OR ci.type = ?3)
                AND (?10 IS NULL OR 1=1)
                AND (?4 IS NULL OR c.difficulty_score >= ?4)
                AND (?5 IS NULL OR c.difficulty_score <= ?5)
                AND (
                  ?11 IS NULL OR EXISTS (
                    SELECT 1 FROM card_difficulty_levels dl
                    WHERE dl.card_id = c.id
                      AND dl.framework = ?13
                      AND (
                        CASE ?13
                          WHEN 'CEFR' THEN (
                            CASE dl.level
                              WHEN 'A1' THEN 0 WHEN 'A2' THEN 1 WHEN 'B1' THEN 2 WHEN 'B2' THEN 3 WHEN 'C1' THEN 4 WHEN 'C2' THEN 5 ELSE NULL END
                          )
                          WHEN 'JLPT' THEN (
                            CASE dl.level
                              WHEN 'N5' THEN 0 WHEN 'N4' THEN 1 WHEN 'N3' THEN 2 WHEN 'N2' THEN 3 WHEN 'N1' THEN 4 ELSE NULL END
                          )
                          WHEN 'HSK' THEN (CAST(REPLACE(UPPER(dl.level),'HSK','') AS INTEGER) - 1)
                          ELSE NULL
                        END
                      ) BETWEEN ?11 AND ?12
                  )
                )
                AND (?9 = 0 OR req.cnt = ?9)
                ${kanjiFilterSql}
            )
            SELECT COUNT(*) AS total FROM matches;
          `;
          const countsRes = await env.DB.prepare(countStmt)
            .bind(ftsQuery, mainLanguage, type, minDifficulty, maxDifficulty, /* size */ size, /* offset */ offset, subtitleLanguagesCsv, subtitleLangsCount, contentSlug, minIdxEff, maxIdxEff, framework, altMain1, altMain2, ...kanjiChars)
            .all();
          const totalRes = await env.DB.prepare(totalStmt)
            .bind(ftsQuery, mainLanguage, type, minDifficulty, maxDifficulty, /* size */ size, /* offset */ offset, subtitleLanguagesCsv, subtitleLangsCount, contentSlug, minIdxEff, maxIdxEff, framework, altMain1, altMain2, ...kanjiChars)
            .all();
          const mapped = (results || []).map(r => {
            let levels = null;
            if (r.levels_json) {
              try {
                levels = JSON.parse(r.levels_json);
              } catch {}
            }
            return {
              ...r,
              image_url: makeMediaUrl(r.image_key),
              audio_url: makeMediaUrl(r.audio_key),
              levels
            };
          });
          
          const perContent = {};
          for (const row of (countsRes.results || [])) {
            if (row && row.content_slug) perContent[row.content_slug] = Number(row.cnt) || 0;
          }
          const total = (totalRes.results && totalRes.results[0] && Number(totalRes.results[0].total)) || 0;
          const resp = json({ items: mapped, page, size, total, per_content: perContent }, { headers: { 'cache-control': 'public, max-age=60' } });
          await cache.put(cacheKey, resp.clone());
          return resp;
        } catch (e) {
          return json({ error: 'search_failed', message: String(e) }, { status: 500 });
        }
      }

      // 1) Sign upload: returns URL to this same Worker which will write to R2
      if (path === '/r2/sign-upload' && request.method === 'POST') {
        const body = await request.json();
        const key = body.path;
        const contentType = body.contentType || 'application/octet-stream';
        if (!key) return json({ error: 'Missing path' }, { status: 400 });
        const uploadUrl = url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType);
        return json({ url: uploadUrl });
      }

      // 1b) Batch sign upload: accepts array of {path, contentType} and returns array of signed URLs
      // Reduces round-trips for bulk uploads (e.g., 1000 files from 1000 requests to ~10 batched requests)
      if (path === '/r2/sign-upload-batch' && request.method === 'POST') {
        const body = await request.json();
        const items = body.items; // Array of {path, contentType?}
        if (!Array.isArray(items) || items.length === 0) {
          return json({ error: 'Missing or empty items array' }, { status: 400 });
        }
        const urls = items.map(item => {
          const key = item.path;
          const contentType = item.contentType || 'application/octet-stream';
          if (!key) return null;
          return {
            path: key,
            url: url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType)
          };
        }).filter(Boolean);
        return json({ urls });
      }

      // 2) PUT upload proxy: actually store into R2
      if (path === '/r2/upload' && request.method === 'PUT') {
        const key = url.searchParams.get('key');
        const ct = url.searchParams.get('ct') || 'application/octet-stream';
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        await env.MEDIA_BUCKET.put(key, request.body, { httpMetadata: { contentType: ct } });
        return json({ ok: true, key });
      }

      // 2c) Multipart upload endpoints for large files (video)
      // INIT: POST /r2/multipart/init { key, contentType }
      if (path === '/r2/multipart/init' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key;
          const contentType = body.contentType || 'application/octet-stream';
          if (!key) return json({ error: 'Missing key' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
          return json({ uploadId: mpu.uploadId, key });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // UPLOAD PART: PUT /r2/multipart/part?key=...&uploadId=...&partNumber=1  (body=bytes)
      if (path === '/r2/multipart/part' && request.method === 'PUT') {
        try {
          const key = url.searchParams.get('key');
          const uploadId = url.searchParams.get('uploadId');
          const pn = url.searchParams.get('partNumber');
          const partNumber = Number(pn);
          if (!key || !uploadId || !partNumber) return json({ error: 'Missing key/uploadId/partNumber' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          const res = await mpu.uploadPart(partNumber, request.body);
          return json({ etag: res.etag, partNumber });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // COMPLETE: POST /r2/multipart/complete { key, uploadId, parts:[{partNumber,etag}] }
      if (path === '/r2/multipart/complete' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key; const uploadId = body.uploadId; const parts = body.parts || [];
          if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return json({ error: 'Missing key/uploadId/parts' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          await mpu.complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
          return json({ ok: true, key });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // ABORT: POST /r2/multipart/abort { key, uploadId }
      if (path === '/r2/multipart/abort' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key; const uploadId = body.uploadId;
          if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          await mpu.abort();
          return json({ ok: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 2a) List R2 objects
      // Default: returns mixed directories and files under a prefix using delimiter '/'
      // When flat=1: returns a paginated flat list of objects with cursor for recursive operations
      if (path === '/r2/list' && request.method === 'GET') {
        if (!env.MEDIA_BUCKET) return json([], { status: 200 });
        const inputPrefix = url.searchParams.get('prefix') || '';
        const norm = String(inputPrefix).replace(/^\/+|\/+$/g, '');
        const flat = /^(1|true|yes)$/i.test(url.searchParams.get('flat') || '');
        if (flat) {
          const cursor = url.searchParams.get('cursor') || undefined;
          const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || '1000')));
          try {
            const prefixFlat = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
            const res = await env.MEDIA_BUCKET.list({ prefix: prefixFlat, cursor, limit });
            const objects = (res.objects || []).map((o) => ({
              key: o.key,
              size: o.size,
              modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
            }));
            return json({ objects, cursor: res.cursor || null, truncated: !!res.truncated });
          } catch (e) {
            return json({ error: e.message }, { status: 500 });
          }
        }
        const prefix = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
        const paged = /^(1|true|yes)$/i.test(url.searchParams.get('paged') || '');
        const cursor = url.searchParams.get('cursor') || undefined;
        const limitRaw = url.searchParams.get('limit');
        let limit = Number(limitRaw);
        if (!Number.isFinite(limit)) limit = 1000; // Cloudflare default
        limit = Math.min(1000, Math.max(1, limit));
        try {
          const listOpts = { prefix, delimiter: '/', cursor, limit };
          // When not paged we omit cursor/limit so behavior identical to previous implementation
          const res = paged ? await env.MEDIA_BUCKET.list(listOpts) : await env.MEDIA_BUCKET.list({ prefix, delimiter: '/' });
          const base = env.R2_PUBLIC_BASE || '';
          const makeUrl = (k) => base ? `${base}/${k}` : `${url.origin}/media/${k}`;
          const dirs = (res.delimitedPrefixes || []).map((p) => {
            const key = p;
            const name = key.replace(/^.*\//, '').replace(/\/$/, '') || key;
            return { key, name, type: 'directory' };
          });
            const files = (res.objects || []).map((o) => ({
              key: o.key,
              name: o.key.replace(/^.*\//, ''),
              type: 'file',
              size: o.size,
              modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
              url: makeUrl(o.key),
            }));
          if (paged) {
            return json({ items: [...dirs, ...files], cursor: res.cursor || null, truncated: !!res.truncated });
          }
          return json([ ...dirs, ...files ]);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 2b) Delete R2 object (file) or empty directory (prefix ending with '/')
      if (path === '/r2/delete' && request.method === 'DELETE') {
        if (!env.MEDIA_BUCKET) return json({ error: 'R2 not configured' }, { status: 400 });
        const key = url.searchParams.get('key');
        const recursive = /^(1|true|yes)$/i.test(url.searchParams.get('recursive') || '');
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        try {
          if (key.endsWith('/')) {
            if (!recursive) {
              // Delete directory only if empty
              const check = await env.MEDIA_BUCKET.list({ prefix: key, limit: 2 });
              const has = (check.objects && check.objects.length) || (check.delimitedPrefixes && check.delimitedPrefixes.length);
              if (has) return json({ error: 'not-empty' }, { status: 400 });
              return json({ ok: true });
            }
            // Recursive delete (performance optimized): delete objects in parallel batches
            let cursor = undefined; let total = 0;
            // allow optional concurrency override (?c=30)
            const concRaw = url.searchParams.get('c');
            let concurrency = 20;
            if (concRaw) {
              const n = Number(concRaw);
              if (Number.isFinite(n) && n > 0 && n <= 100) concurrency = Math.floor(n);
            }
            while (true) {
              const res = await env.MEDIA_BUCKET.list({ prefix: key, cursor, limit: 1000 });
              const objs = res.objects || [];
              if (!objs.length) {
                if (!res.truncated) break;
                cursor = res.cursor;
                continue;
              }
              // Delete in concurrent batches to reduce total time
              let idx = 0;
              async function runBatch() {
                while (idx < objs.length) {
                  const batch = [];
                  for (let j = 0; j < concurrency && idx < objs.length; j++, idx++) {
                    const objKey = objs[idx].key;
                    batch.push(env.MEDIA_BUCKET.delete(objKey));
                  }
                  await Promise.allSettled(batch);
                }
              }
              await runBatch();
              total += objs.length;
              if (!res.truncated) break;
              cursor = res.cursor;
            }
            return json({ ok: true, deleted: total, concurrency });
          } else {
            await env.MEDIA_BUCKET.delete(key);
            return json({ ok: true });
          }
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 3) Content items list (generic across films, music, books)
      if (path === '/items' && request.method === 'GET') {
        try {
          // Include available_subs aggregated from content_item_languages for each item
          const rows = await env.DB.prepare(`
            SELECT ci.id as internal_id, ci.slug as id, ci.title, ci.main_language, ci.type, ci.release_year, ci.description, ci.total_episodes as episodes, ci.is_original,
                   cil.language as lang
            FROM content_items ci
            LEFT JOIN content_item_languages cil ON cil.content_item_id = ci.id
          `).all();
          const map = new Map();
          for (const r of (rows.results || [])) {
            const key = r.id;
            let it = map.get(key);
            if (!it) {
              it = {
                id: r.id,
                title: r.title,
                main_language: r.main_language,
                type: r.type,
                release_year: r.release_year,
                description: r.description,
                episodes: r.episodes,
                is_original: r.is_original,
                available_subs: [],
              };
              map.set(key, it);
            }
            if (r.lang) {
              if (!it.available_subs.includes(r.lang)) it.available_subs.push(r.lang);
            }
          }
          const out = Array.from(map.values());
          return json(out);
        } catch (e) {
          return json([]);
        }
      }

      // 4) Item detail (lookup by slug) - return slug as id and include episodes count + cover_url (stable)
      const filmMatch = path.match(/^\/items\/([^/]+)$/);
        // 4) Item detail (lookup by slug) - return slug as id and include episodes count + cover_url (stable)
  if (filmMatch && request.method === 'GET') {
        const filmSlug = decodeURIComponent(filmMatch[1]);
        try {
          // Case-insensitive slug matching for stability
          let film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!film) {
            // Fallback: allow direct UUID id lookup in case caller still uses internal id
            film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats FROM content_items WHERE id=?').bind(filmSlug).first();
          }
          if (!film) return new Response('Not found', { status: 404, headers: withCors() });
          // Languages and episodes are optional; if the table is missing, default gracefully
          let langs = { results: [] };
          let episodes = 0;
          try {
            langs = await env.DB.prepare('SELECT language FROM content_item_languages WHERE content_item_id=?').bind(film.id).all();
          } catch {}
          try {
            const epCountRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM episodes WHERE content_item_id=?').bind(film.id).first();
            episodes = epCountRow ? epCountRow.cnt : 0;
          } catch {}
          let cover_url = null;
          let cover_landscape_url = null;
          // Prefer explicit cover_key when present
          if (film.cover_key) {
            const base = env.R2_PUBLIC_BASE || '';
            cover_url = base ? `${base}/${film.cover_key}` : `/${film.cover_key}`;
          } else {
            // Fallbacks: new preferred path -> older new path -> legacy films/ path
            const preferredKey = `items/${film.slug}/cover_image/cover.jpg`;
            const newDefaultKey = `items/${film.slug}/episodes/e1/cover.jpg`;
            const oldDefaultKey = `films/${film.slug}/episodes/e1/cover.jpg`; // backward compatibility
            try {
              // If R2 HEAD supported, check existence (non-fatal on error)
              if (env.MEDIA_BUCKET && typeof env.MEDIA_BUCKET.head === 'function') {
                const headPreferred = await env.MEDIA_BUCKET.head(preferredKey);
                if (headPreferred) {
                  const base = env.R2_PUBLIC_BASE || '';
                  cover_url = base ? `${base}/${preferredKey}` : `/${preferredKey}`;
                } else {
                  const headNew = await env.MEDIA_BUCKET.head(newDefaultKey);
                  if (headNew) {
                  const base = env.R2_PUBLIC_BASE || '';
                    cover_url = base ? `${base}/${newDefaultKey}` : `/${newDefaultKey}`;
                  } else {
                    const headOld = await env.MEDIA_BUCKET.head(oldDefaultKey);
                    if (headOld) {
                      const base = env.R2_PUBLIC_BASE || '';
                      cover_url = base ? `${base}/${oldDefaultKey}` : `/${oldDefaultKey}`;
                    }
                  }
                }
              } else {
                // No head() available: assume new path
                const base = env.R2_PUBLIC_BASE || '';
                cover_url = base ? `${base}/${preferredKey}` : `/${preferredKey}`;
              }
            } catch {
              // Ignore probe errors; leave null if not resolvable
            }
          }
          // Build cover_landscape_url from cover_landscape_key if present
          if (film.cover_landscape_key) {
            const base = env.R2_PUBLIC_BASE || '';
            cover_landscape_url = base ? `${base}/${film.cover_landscape_key}` : `/${film.cover_landscape_key}`;
          }
          const episodesMetaRaw = (film.total_episodes != null ? Number(film.total_episodes) : null);
          const episodesMeta = (Number.isFinite(episodesMetaRaw) && episodesMetaRaw > 0) ? episodesMetaRaw : null;
          const episodesOut = episodesMeta !== null ? episodesMeta : episodes;
          const isOriginal = (film.is_original == null) ? 1 : film.is_original; // default true when absent
          return json({ id: film.slug, title: film.title, main_language: film.main_language, type: film.type, release_year: film.release_year, description: film.description, available_subs: (langs.results || []).map(r => r.language), episodes: episodesOut, total_episodes: episodesMeta !== null ? episodesMeta : episodesOut, cover_url, cover_landscape_url, is_original: !!Number(isOriginal), num_cards: film.num_cards ?? null, avg_difficulty_score: film.avg_difficulty_score ?? null, level_framework_stats: film.level_framework_stats ?? null, is_available: film.is_available ?? 1 });
        } catch (e) {
          return new Response('Not found', { status: 404, headers: withCors() });
        }
      }

      // 4a) Episodes list for a content item (GET /items/:slug/episodes)
      const episodesListMatch = path.match(/^\/items\/([^/]+)\/episodes$/);
      if (episodesListMatch && request.method === 'GET') {
        const filmSlug = decodeURIComponent(episodesListMatch[1]);
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!filmRow) return json([]);
          let rows;
          try {
            // New schema (episode_number)
            rows = await env.DB.prepare('SELECT episode_number,title,slug,description,cover_key,full_audio_key,full_video_key,is_available,num_cards FROM episodes WHERE content_item_id=? ORDER BY episode_number ASC').bind(filmRow.id).all();
          } catch (e) {
            // Backward compatibility: older column name episode_num
            try {
              rows = await env.DB.prepare('SELECT episode_num AS episode_number,title,slug,cover_key,full_audio_key,full_video_key,is_available FROM episodes WHERE content_item_id=? ORDER BY episode_num ASC').bind(filmRow.id).all();
            } catch (e2) {
              rows = { results: [] };
            }
          }
          const base = env.R2_PUBLIC_BASE || '';
          const out = (rows.results || []).map(r => ({
            episode_number: r.episode_number,
            title: r.title || null,
            slug: r.slug || `${filmSlug}_${r.episode_number}`,
            description: r.description || null,
            cover_url: r.cover_key ? (base ? `${base}/${r.cover_key}` : `/${r.cover_key}`) : null,
            full_audio_url: r.full_audio_key ? (base ? `${base}/${r.full_audio_key}` : `/${r.full_audio_key}`) : null,
            full_video_url: r.full_video_key ? (base ? `${base}/${r.full_video_key}` : `/${r.full_video_key}`) : null,
            is_available: r.is_available ?? 1,
            num_cards: typeof r.num_cards === 'number' ? r.num_cards : Number(r.num_cards ?? 0),
          }));
          return json(out);
        } catch (e) {
          return json([]);
        }
      }

      // 4b) Update item meta (PATCH /items/:slug)
      if (filmMatch && request.method === 'PATCH') {
        const filmSlug = decodeURIComponent(filmMatch[1]);
        try {
          const body = await request.json().catch(() => ({}));
          // Build dynamic UPDATE to allow explicit clearing (set NULL) and partial updates.
          const setClauses = [];
          const values = [];
          const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

          if (has('title')) { setClauses.push('title=?'); values.push(body.title ?? null); }
          if (has('description')) { setClauses.push('description=?'); values.push(body.description ?? null); }

          if (has('cover_key') || has('cover_url')) {
            let coverKey = null;
            if (body.cover_key === null || body.cover_url === null) {
              coverKey = null;
            } else {
              const raw = body.cover_key || body.cover_url;
              if (raw) coverKey = String(raw).replace(/^https?:\/\/[^/]+\//, '');
            }
            setClauses.push('cover_key=?'); values.push(coverKey);
          }

          if (has('cover_landscape_key') || has('cover_landscape_url')) {
            let coverLandscapeKey = null;
            if (body.cover_landscape_key === null || body.cover_landscape_url === null) {
              coverLandscapeKey = null;
            } else {
              const raw = body.cover_landscape_key || body.cover_landscape_url;
              if (raw) coverLandscapeKey = String(raw).replace(/^https?:\/\/[^/]+\//, '');
            }
            setClauses.push('cover_landscape_key=?'); values.push(coverLandscapeKey);
          }


          if (has('total_episodes')) {
            let totalEpisodes = null;
            if (body.total_episodes !== null && body.total_episodes !== '') {
              const n = Number(body.total_episodes);
              totalEpisodes = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
            }
            setClauses.push('total_episodes=?'); values.push(totalEpisodes);
          }

          // New: optional type and release_year updates
          if (has('type')) {
            // Allow clearing to null when sent as null or empty string
            const t = (body.type === '' || body.type == null) ? null : String(body.type);
            setClauses.push('type=?'); values.push(t);
          }
          if (has('release_year')) {
            let ry = null;
            if (body.release_year !== null && body.release_year !== '') {
              const n = Number(body.release_year);
              ry = Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
            }
            setClauses.push('release_year=?'); values.push(ry);
          }

          // New: is_original flag (boolean). Accepts boolean or number; coerces to 0/1.
          if (has('is_original')) {
            const raw = body.is_original;
            let val = null;
            if (raw === null) {
              // allow explicit null? table default is non-null; ignore if null
              val = null;
            } else if (typeof raw === 'boolean') {
              val = raw ? 1 : 0;
            } else if (raw !== '' && raw != null) {
              val = Number(raw) ? 1 : 0;
            }
            if (val !== null) { setClauses.push('is_original=?'); values.push(val); }
          }

          // New: is_available flag (boolean). Accepts boolean or number; coerces to 0/1.
          if (has('is_available')) {
            const raw = body.is_available;
            let val = null;
            if (typeof raw === 'boolean') {
              val = raw ? 1 : 0;
            } else if (typeof raw === 'number') {
              val = raw ? 1 : 0;
            }
            if (val !== null) { setClauses.push('is_available=?'); values.push(val); }
          }

          if (!setClauses.length) {
            return json({ ok: true, note: 'No fields to update' });
          }

          // Ensure film exists by slug (case-insensitive)
          const existing = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!existing) return json({ error: 'Not found' }, { status: 404 });

          const sql = `UPDATE content_items SET ${setClauses.join(', ')}, updated_at=strftime('%s','now') WHERE id=?`;
          values.push(existing.id);
          await env.DB.prepare(sql).bind(...values).run();
          return json({ ok: true, updated_fields: setClauses.length });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 4b-DELETE) Delete a content item and all its episodes/cards (DELETE /items/:slug)
      if (filmMatch && request.method === 'DELETE') {
        const filmSlug = decodeURIComponent(filmMatch[1]);
        try {
          const filmRow = await env.DB.prepare('SELECT id, slug, cover_key FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });

          // Gather related media keys BEFORE deleting DB rows so we can construct expected paths.
          const mediaKeys = new Set();
          const mediaErrors = [];
          const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);

          if (filmRow.cover_key) mediaKeys.add(normalizeKey(filmRow.cover_key));
          // Standard film-level conventional paths (may or may not exist)
          mediaKeys.add(`items/${filmRow.slug}/cover_image/cover.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/cover_image/cover_landscape.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/full/audio.mp3`);
          mediaKeys.add(`items/${filmRow.slug}/full/video.mp4`);

          // Episodes + cards keys
          const episodeRows = await env.DB.prepare('SELECT id, episode_number, cover_key, full_audio_key, full_video_key FROM episodes WHERE content_item_id=?').bind(filmRow.id).all().catch(() => ({ results: [] }));
          const episodesResults = episodeRows.results || [];
          const episodeIds = episodesResults.map(r => r.id);
          let cardsResults = [];
          if (episodeIds.length) {
            const placeholders = episodeIds.map(() => '?').join(',');
            const cardsRows = await env.DB.prepare(`SELECT id, image_key, audio_key, episode_id, card_number FROM cards WHERE episode_id IN (${placeholders})`).bind(...episodeIds).all().catch(() => ({ results: [] }));
            cardsResults = cardsRows.results || [];
          }
          for (const ep of episodesResults) {
            const epNum = ep.episode_number || 0;
            const epFolderLegacy = `${filmRow.slug}_${epNum}`;
            const epFolderPadded = `${filmRow.slug}_${String(epNum).padStart(3,'0')}`;
            if (ep.cover_key) mediaKeys.add(normalizeKey(ep.cover_key));
            if (ep.full_audio_key) mediaKeys.add(normalizeKey(ep.full_audio_key));
            if (ep.full_video_key) mediaKeys.add(normalizeKey(ep.full_video_key));
            // Conventional episode-level paths
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover_landscape.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/audio.mp3`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/video.mp4`);
            // New padded variants
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover_landscape.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/full/audio.mp3`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/full/video.mp4`);
          }
          for (const c of cardsResults) {
            if (c.image_key) mediaKeys.add(normalizeKey(c.image_key));
            if (c.audio_key) mediaKeys.add(normalizeKey(c.audio_key));
          }

          // Begin transaction for DB deletions
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            // Collect episode ids
            const eps = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=?').bind(filmRow.id).all();
            const epIds = (eps.results || []).map(r => r.id);
            if (epIds.length) {
              // Collect card ids for those episodes
              const placeholders = epIds.map(() => '?').join(',');
              const cardsRes = await env.DB.prepare(`SELECT id FROM cards WHERE episode_id IN (${placeholders})`).bind(...epIds).all();
              const cardIds = (cardsRes.results || []).map(r => r.id);
              if (cardIds.length) {
                const cardPh = cardIds.map(() => '?').join(',');
                // Delete subtitles and difficulty levels
                try { await env.DB.prepare(`DELETE FROM card_subtitles WHERE card_id IN (${cardPh})`).bind(...cardIds).run(); } catch {}
                try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (${cardPh})`).bind(...cardIds).run(); } catch {}
                try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${cardPh})`).bind(...cardIds).run(); } catch {}
              }
              // Delete cards
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id IN (${placeholders})`).bind(...epIds).run(); } catch {}
            }
            // Delete episodes
            try { await env.DB.prepare('DELETE FROM episodes WHERE content_item_id=?').bind(filmRow.id).run(); } catch {}
            // Delete language rows
            try { await env.DB.prepare('DELETE FROM content_item_languages WHERE content_item_id=?').bind(filmRow.id).run(); } catch {}
            // Finally delete the content item
            await env.DB.prepare('DELETE FROM content_items WHERE id=?').bind(filmRow.id).run();
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }

          // Best-effort R2 deletion of collected media keys (after DB commit)
          // Previous implementation deleted sequentially causing long waits for large media sets.
          // Use batched concurrent deletes to reduce total time.
          let mediaDeletedCount = 0;
          if (env.MEDIA_BUCKET && mediaKeys.size) {
            const keys = Array.from(mediaKeys).filter(Boolean);
            const concurrency = 40; // reasonable parallelism without overwhelming R2
            let idx = 0;
            async function runBatch() {
              while (idx < keys.length) {
                const batch = [];
                for (let i = 0; i < concurrency && idx < keys.length; i++, idx++) {
                  const k = keys[idx];
                  batch.push(
                    env.MEDIA_BUCKET.delete(k)
                      .then(() => { mediaDeletedCount += 1; })
                      .catch(() => { mediaErrors.push(`fail:${k}`); })
                  );
                }
                await Promise.allSettled(batch);
              }
            }
            await runBatch();
          }

          return json({ ok: true, deleted: filmRow.slug, episodes_deleted: episodesResults.length, cards_deleted: cardsResults.length, media_deleted: mediaDeletedCount, media_errors: mediaErrors });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 4d) Calculate and persist stats for a film + episode (POST /items/:slug/episodes/:episode/calc-stats)
      const calcStatsMatch = path.match(/^\/items\/([^/]+)\/episodes\/([^/]+)\/calc-stats$/);
      if (calcStatsMatch && request.method === 'POST') {
        const filmSlug = decodeURIComponent(calcStatsMatch[1]);
        const episodeSlugRaw = decodeURIComponent(calcStatsMatch[2]);
        try {
          // Resolve film
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
          // Resolve episode number and episode row (supports e1 or filmSlug_1)
          let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlugRaw).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let episode;
          try {
            episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            try { episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch {}
          }
          if (!episode) return json({ error: 'Not found' }, { status: 404 });

          // Helper: aggregate level stats rows into [{framework,language,levels:{level:percent}}]
          function buildLevelStats(rows) {
            const groups = new Map(); // key = framework||'' + '|' + language||''
            for (const r of rows) {
              const framework = r.framework || null;
              const language = r.language || null;
              const level = r.level || null;
              if (!framework || !level) continue;
              const key = `${framework}|${language || ''}`;
              let g = groups.get(key);
              if (!g) { g = { framework, language, counts: new Map(), total: 0 }; groups.set(key, g); }
              g.total += 1;
              g.counts.set(level, (g.counts.get(level) || 0) + 1);
            }
            const out = [];
            for (const g of groups.values()) {
              const levels = {};
              for (const [level, count] of g.counts.entries()) {
                const pct = g.total ? Math.round((count / g.total) * 1000) / 10 : 0; // one decimal
                levels[level] = pct;
              }
              out.push({ framework: g.framework, language: g.language, levels });
            }
            return out;
          }

          // Compute episode-level stats
          const epCountAvg = await env.DB.prepare('SELECT COUNT(*) AS c, AVG(difficulty_score) AS avg FROM cards WHERE episode_id=? AND difficulty_score IS NOT NULL').bind(episode.id).first();
          let epLevelRows = { results: [] };
          try {
            const sql = `SELECT cdl.framework,cdl.level,cdl.language
                         FROM card_difficulty_levels cdl
                         JOIN cards c ON cdl.card_id=c.id
                         WHERE c.episode_id=?`;
            epLevelRows = await env.DB.prepare(sql).bind(episode.id).all();
          } catch {}
          const epStatsJson = JSON.stringify(buildLevelStats(epLevelRows.results || []));
          const epNumCards = Number(epCountAvg?.c || 0);
          const epAvg = epCountAvg && epCountAvg.avg != null ? Number(epCountAvg.avg) : null;

          // Compute content-item-level stats
          const itemCountAvg = await env.DB.prepare(`SELECT COUNT(c.id) AS c, AVG(c.difficulty_score) AS avg
                                                      FROM cards c
                                                      JOIN episodes e ON c.episode_id=e.id
                                                      WHERE e.content_item_id=? AND c.difficulty_score IS NOT NULL`).bind(filmRow.id).first();
          let itemLevelRows = { results: [] };
          try {
            const sql2 = `SELECT cdl.framework,cdl.level,cdl.language
                          FROM card_difficulty_levels cdl
                          JOIN cards c ON cdl.card_id=c.id
                          JOIN episodes e ON c.episode_id=e.id
                          WHERE e.content_item_id=?`;
            itemLevelRows = await env.DB.prepare(sql2).bind(filmRow.id).all();
          } catch {}
          const itemStatsJson = JSON.stringify(buildLevelStats(itemLevelRows.results || []));
          const itemNumCards = Number(itemCountAvg?.c || 0);
          const itemAvg = itemCountAvg && itemCountAvg.avg != null ? Number(itemCountAvg.avg) : null;

          // Persist inside a transaction where available
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            try {
              await env.DB.prepare(`UPDATE episodes
                                    SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
                                    WHERE id=?`).bind(epNumCards, epAvg, epStatsJson, episode.id).run();
            } catch {}
            try {
              await env.DB.prepare(`UPDATE content_items
                                    SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
                                    WHERE id=?`).bind(itemNumCards, itemAvg, itemStatsJson, filmRow.id).run();
            } catch {}
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }

          return json({ ok: true, episode: { num_cards: epNumCards, avg_difficulty_score: epAvg }, item: { num_cards: itemNumCards, avg_difficulty_score: itemAvg } });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 5) Cards for film/episode (lookup by film slug and episode slug like e1)
  const filmCardsMatch = path.match(/^\/items\/([^/]+)\/episodes\/([^/]+)\/cards$/);
      // 4c) Episode meta
      const episodeMetaMatch = path.match(/^\/items\/([^/]+)\/episodes\/([^/]+)$/);
      // DELETE episode: remove episode, its cards, subtitles, difficulties, and media
      if (episodeMetaMatch && request.method === 'DELETE') {
        const filmSlug = decodeURIComponent(episodeMetaMatch[1]);
        const episodeSlugRaw = decodeURIComponent(episodeMetaMatch[2]);
        try {
          const filmRow = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlugRaw).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          // Resolve episode row
          let episode;
          try {
            episode = await env.DB.prepare('SELECT id, episode_number, slug, cover_key, full_audio_key, full_video_key FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            try { episode = await env.DB.prepare('SELECT id, episode_num AS episode_number, slug, cover_key, full_audio_key, full_video_key FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch {}
          }
          if (!episode) return json({ error: 'Not found' }, { status: 404 });
          const epId = episode.id;
          // Enforce rule: cannot delete the first episode of a film
          try {
            let minRow;
            try {
              minRow = await env.DB.prepare('SELECT MIN(episode_number) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first();
            } catch (e) {
              try { minRow = await env.DB.prepare('SELECT MIN(episode_num) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first(); } catch {}
            }
            const minEp = minRow ? Number(minRow.mn) : 1;
            if (epNum === minEp) {
              return json({ error: 'Cannot delete the first episode' }, { status: 400 });
            }
          } catch {}
          // Collect related cards and media keys
          const mediaKeys = new Set();
          const mediaErrors = [];
          const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
          if (episode.cover_key) mediaKeys.add(normalizeKey(episode.cover_key));
          if (episode.full_audio_key) mediaKeys.add(normalizeKey(episode.full_audio_key));
          if (episode.full_video_key) mediaKeys.add(normalizeKey(episode.full_video_key));
          // Add conventional episode media locations (both legacy and padded)
          const epPadded = String(epNum).padStart(3,'0');
          const epFolderLegacy = `${filmRow.slug}_${epNum}`;
          const epFolderPadded = `${filmRow.slug}_${epPadded}`;
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/audio.mp3`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/video.mp4`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/full/audio.mp3`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/full/video.mp4`);
          // Collect card keys
          let cardsRows = { results: [] };
          try {
            cardsRows = await env.DB.prepare('SELECT id, image_key, audio_key FROM cards WHERE episode_id=?').bind(epId).all();
          } catch {}
          const cardIds = [];
          for (const c of (cardsRows.results || [])) {
            cardIds.push(c.id);
            if (c.image_key) mediaKeys.add(normalizeKey(c.image_key));
            if (c.audio_key) mediaKeys.add(normalizeKey(c.audio_key));
          }
          // Delete DB rows in a transaction
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            if (cardIds.length) {
              const ph = cardIds.map(() => '?').join(',');
              try { await env.DB.prepare(`DELETE FROM card_subtitles WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch {}
            } else {
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch {}
            }
            try { await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(epId).run(); } catch {}
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          // Best-effort media deletion
          let mediaDeletedCount = 0;
          if (env.MEDIA_BUCKET) {
            for (const k of mediaKeys) {
              if (!k) continue;
              try { await env.MEDIA_BUCKET.delete(k); mediaDeletedCount += 1; }
              catch { mediaErrors.push(`fail:${k}`); }
            }
          }
          return json({ ok: true, deleted: `${filmSlug}_${epNum}`, cards_deleted: cardIds.length, media_deleted: mediaDeletedCount, media_errors: mediaErrors });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      if (episodeMetaMatch && (request.method === 'PATCH' || request.method === 'GET')) {
        const filmSlug = decodeURIComponent(episodeMetaMatch[1]);
        const episodeSlugRaw = decodeURIComponent(episodeMetaMatch[2]);
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlugRaw).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let episode;
          try {
            episode = await env.DB.prepare('SELECT id, title, slug, description, cover_key, full_audio_key, full_video_key, is_available, num_cards, avg_difficulty_score, level_framework_stats FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            // Fallback older schema
            try {
              episode = await env.DB.prepare('SELECT id, title, slug, cover_key, full_audio_key, full_video_key, is_available FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
            } catch {}
          }
          if (!episode) return json({ error: 'Not found' }, { status: 404 });
          if (request.method === 'GET') {
            // Return episode details with derived URLs
            const base = env.R2_PUBLIC_BASE || '';
            const padded = String(epNum).padStart(3,'0');
            const out = {
              episode_number: epNum,
              title: episode.title || null,
              slug: episode.slug || `${filmSlug}_${epNum}`,
              description: episode.description || null,
              cover_url: episode.cover_key ? (base ? `${base}/${episode.cover_key}` : `/${episode.cover_key}`) : null,
              full_audio_url: episode.full_audio_key ? (base ? `${base}/${episode.full_audio_key}` : `/${episode.full_audio_key}`) : null,
              full_video_url: episode.full_video_key ? (base ? `${base}/${episode.full_video_key}` : `/${episode.full_video_key}`) : null,
              display_id: `e${padded}`,
              num_cards: episode.num_cards ?? null,
              avg_difficulty_score: episode.avg_difficulty_score ?? null,
              level_framework_stats: episode.level_framework_stats ?? null,
              is_available: episode.is_available ?? 1,
            };
            return json(out);
          }
          const body = await request.json().catch(() => ({}));
          // Only update fields if they are non-empty string
          const setClauses = [];
          const values = [];
          if (typeof body.title === 'string' && body.title.trim() !== '') {
            setClauses.push('title=?');
            values.push(body.title.trim());
          }
          if (typeof body.description === 'string' && body.description.trim() !== '') {
            setClauses.push('description=?');
            values.push(body.description.trim());
          }
          const coverKeyRaw = body.cover_key || body.cover_url;
          if (typeof coverKeyRaw === 'string' && coverKeyRaw.trim() !== '') {
            const coverKey = String(coverKeyRaw).replace(/^https?:\/\/[^/]+\//, '');
            setClauses.push('cover_key=?');
            values.push(coverKey);
          }
          const fullAudioKeyRaw = body.full_audio_key || body.full_audio_url;
          if (typeof fullAudioKeyRaw === 'string' && fullAudioKeyRaw.trim() !== '') {
            const fullAudioKey = String(fullAudioKeyRaw).replace(/^https?:\/\/[^/]+\//, '');
            setClauses.push('full_audio_key=?');
            values.push(fullAudioKey);
          }
          const fullVideoKeyRaw = body.full_video_key || body.full_video_url;
          if (typeof fullVideoKeyRaw === 'string' && fullVideoKeyRaw.trim() !== '') {
            const fullVideoKey = String(fullVideoKeyRaw).replace(/^https?:\/\/[^/]+\//, '');
            setClauses.push('full_video_key=?');
            values.push(fullVideoKey);
          }
          // is_available flag (boolean or number → 0/1)
          if (typeof body.is_available === 'boolean' || typeof body.is_available === 'number') {
            const isAvail = body.is_available ? 1 : 0;
            setClauses.push('is_available=?');
            values.push(isAvail);
          }
          if (!setClauses.length) {
            return json({ error: 'No valid fields to update' }, { status: 400 });
          }
          setClauses.push("updated_at=strftime('%s','now')");
          const sql = `UPDATE episodes SET ${setClauses.join(', ')} WHERE id=?`;
          values.push(episode.id);
          const result = await env.DB.prepare(sql).bind(...values).run();
          if (!result || result.changes === 0) {
            return json({ error: 'Episode update failed or not found' }, { status: 404 });
          }
          return json({ ok: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
        if (filmCardsMatch && request.method === 'GET') {
      const filmSlug = decodeURIComponent(filmCardsMatch[1]);
      const episodeSlug = decodeURIComponent(filmCardsMatch[2]);
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '50');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        const startFromRaw = url.searchParams.get('start_from');
        const startFrom = startFromRaw != null ? Number(startFromRaw) : null;
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json([]);
          // Parse episode number: support patterns like e1 or filmSlug_1
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id,slug FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id,slug FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch {}
          }
          if (!ep) return json([]);
          let res;
          try {
            if (startFrom != null && Number.isFinite(startFrom)) {
              const sql = `SELECT c.card_number,
                                  c.start_time AS start_time,
                                  c.end_time AS end_time,
                                  c.duration,
                                  c.image_key,
                                  c.audio_key,
                                  c.sentence,
                                  c.card_type,
                                  c.length,
                                  c.difficulty_score,
                                  c.is_available,
                                  c.id as internal_id
                           FROM cards c
                           WHERE c.episode_id=? AND c.start_time >= ?
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, Math.floor(startFrom), limit).all();
            } else {
              const sql = `SELECT c.card_number,
                                  c.start_time AS start_time,
                                  c.end_time AS end_time,
                                  c.duration,
                                  c.image_key,
                                  c.audio_key,
                                  c.sentence,
                                  c.card_type,
                                  c.length,
                                  c.difficulty_score,
                                  c.is_available,
                                  c.id as internal_id
                           FROM cards c
                           WHERE c.episode_id=?
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, limit).all();
            }
          } catch (e) {
            // Backward compatibility: legacy ms columns
            if (startFrom != null && Number.isFinite(startFrom)) {
              const sqlLegacy = `SELECT c.card_number,
                                        c.start_time_ms,
                                        c.end_time_ms,
                                        c.image_key,
                                        c.audio_key,
                                        c.sentence,
                                        c.card_type,
                                        c.length,
                                        c.difficulty_score,
                                        c.is_available,
                                        c.id as internal_id
                                 FROM cards c
                                 WHERE c.episode_id=? AND c.start_time_ms >= ?
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, Math.floor(startFrom * 1000), limit).all();
            } else {
              const sqlLegacy = `SELECT c.card_number,
                                        c.start_time_ms,
                                        c.end_time_ms,
                                        c.image_key,
                                        c.audio_key,
                                        c.sentence,
                                        c.card_type,
                                        c.length,
                                        c.difficulty_score,
                                        c.is_available,
                                        c.id as internal_id
                                 FROM cards c
                                 WHERE c.episode_id=?
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, limit).all();
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles and CEFR levels for all cards
          const cardIds = rows.map(r => r.internal_id);
          const subsMap = new Map();
          const cefrMap = new Map();
          console.log('[WORKER] Episode cards - Total cards:', rows.length, 'Card IDs:', cardIds.length);
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                console.log('[WORKER] Batch', Math.floor(i/batchSize) + 1, '- fetched', batchSubs.results?.length || 0, 'subtitle rows for', batch.length, 'cards');
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
              console.log('[WORKER] Final subsMap size:', subsMap.size, '| Sample entry:', subsMap.size > 0 ? subsMap.entries().next().value : 'none');
            } catch (e) {
              console.error('[WORKER] Error fetching subtitles:', e);
            }
            try {
              // Batch CEFR levels to avoid SQLite parameter limit (999)
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER] Error fetching CEFR levels:', e);
            }
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const cefr = cefrMap.get(r.internal_id) || null;
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode_id: outEpisodeId, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 5b) Cards for a given item across all parts (optional episode filter omitted)
  const filmAllCardsMatch = path.match(/^\/items\/([^/]+)\/cards$/);
      if (filmAllCardsMatch && request.method === 'GET') {
        const filmSlug = filmAllCardsMatch[1];
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '50');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json([]);
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(filmRow.id, limit).all();
          } catch (e) {
            // Fallback older schema (episode_num)
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(filmRow.id, limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
              try {
                res = await env.DB.prepare(sql3).bind(filmRow.id, limit).all();
              } catch {
                res = { results: [] };
              }
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles and CEFR levels
          const cardIds = rows.map(r => r.internal_id);
          const subsMap = new Map();
          const cefrMap = new Map();
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
            } catch (e) {
              console.error('[WORKER /items/cards] Error fetching subtitles:', e);
            }
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER /items/cards] Error fetching CEFR levels:', e);
            }
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const cefr = cefrMap.get(r.internal_id) || null;
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${filmSlug}_${Number(r.episode_number) || 1}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode_id: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 6) Global cards (return film slug, display id, and episode slug e{N} instead of UUID)
  if (path === '/cards' && request.method === 'GET') {
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '100');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        try {
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(limit).all();
          } catch (e) {
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
              try { res = await env.DB.prepare(sql3).bind(limit).all(); }
              catch { res = { results: [] }; }
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles, CEFR, and film slugs
          const cardIds = rows.map(r => r.internal_id);
          const filmIds = [...new Set(rows.map(r => r.film_id))];
          const subsMap = new Map();
          const cefrMap = new Map();
          const filmSlugMap = new Map();
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
            } catch (e) {
              console.error('[WORKER /cards] Error fetching subtitles:', e);
            }
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER /cards] Error fetching CEFR levels:', e);
            }
          }
          if (filmIds.length > 0) {
            const phFilm = filmIds.map(() => '?').join(',');
            try {
              const allFilms = await env.DB.prepare(`SELECT id, slug FROM content_items WHERE id IN (${phFilm})`).bind(...filmIds).all();
              (allFilms.results || []).forEach(f => filmSlugMap.set(f.id, f.slug));
            } catch {}
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const film = { slug: filmSlugMap.get(r.film_id) || 'item' };
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${film.slug}_${Number(r.episode_number) || 1}`;
            const cefr = cefrMap.get(r.internal_id) || null;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, film_id: film?.slug, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 6b) Full-text search endpoint (FTS5) over subtitles
      if (path === '/search' && request.method === 'GET') {
        const q = url.searchParams.get('q') || '';
        const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || '100')));
        const mainLang = url.searchParams.get('main'); // filter by content_items.main_language
        if (!q.trim()) return json([]);
        try {
          // Build a MATCH query that supports prefix on the last term for short inputs like "As"
          // FTS5 is case-insensitive by default but requires lowercase tokens
          const tokens = q.trim().toLowerCase().split(/\s+/).slice(0, 6).map(s => s.replace(/["'*]/g, ''));
          // Use OR for single token (more inclusive), AND for multi-token (precise)
          const operator = tokens.length === 1 ? ' OR ' : ' AND ';
          const match = tokens.map((t, i) => {
            const isLast = i === tokens.length - 1;
            // Apply prefix wildcard ONLY for single-token queries to avoid over-broad matches (e.g. 'sun*' in 'the sun').
            const needsPrefix = tokens.length === 1 && isLast && t.length >= 1;
            return needsPrefix ? `${t}*` : t;
          }).join(operator);
          // Subquery: collect best-ranked card ids by bm25 over FTS5
          const parts = [];
          let res;
          try {
            // FTS5 tables don't support aliases in MATCH clause or bm25() with GROUP BY
            // Use simpler approach: get distinct card_ids from FTS match
            // When main language provided: restrict BOTH to that subtitle language AND the content item's main_language.
            const sql = `
              SELECT DISTINCT c.id AS card_id
              FROM card_subtitles_fts
              JOIN cards c ON c.id = card_subtitles_fts.card_id
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE card_subtitles_fts MATCH ?
              ${mainLang ? 'AND LOWER(card_subtitles_fts.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)' : ''}
              LIMIT ?`;
            const mainCanon = mainLang ? String(mainLang).toLowerCase() : null;
            if (mainCanon) {
              // Bind order: match, subtitle language, item main language, limit
              res = await env.DB.prepare(sql).bind(match, mainCanon, mainCanon, limit).all();
            } else {
              res = await env.DB.prepare(sql).bind(match, limit).all();
            }
          } catch (e) {
            // If FTS not ready, return empty to allow client fallback
            return json([]);
          }
          const ranked = res.results || [];
          if (!ranked.length) return json([]);
          const cardIds = ranked.map(r => r.card_id);
          // Join back details preserving rank order via an inline table
          // Build CASE expression for ordering when IN clause used (SQLite-compatible)
          const placeholders = cardIds.map(() => '?').join(',');
          const orderCase = cardIds.map((id, idx) => `WHEN c.id=? THEN ${idx}`).join(' ');
          const bindOrder = [...cardIds];
             const detailSql = `
            SELECT c.card_number,
                   c.start_time AS start_time,
                   c.end_time AS end_time,
                   c.duration,
                   c.image_key,
                   c.audio_key,
                   c.sentence,
                   c.card_type,
                   c.length,
                   c.difficulty_score,
                 c.is_available,
                   e.episode_number,
                   e.slug as episode_slug,
                   ci.slug as film_slug,
                   c.id as internal_id
            FROM cards c
            JOIN episodes e ON c.episode_id=e.id
            JOIN content_items ci ON e.content_item_id=ci.id
            WHERE c.id IN (${placeholders})
            ORDER BY CASE ${orderCase} END ASC
            LIMIT ?`;
          const detailBind = [...cardIds, ...bindOrder, limit];
          const det = await env.DB.prepare(detailSql).bind(...detailBind).all();
          const rows = det.results || [];
          const out = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.internal_id).all();
            const subtitle = {};
            (subs.results || []).forEach(s => { subtitle[s.language] = s.text; });
            let cefr = null;
            try {
              const lvl = await env.DB.prepare('SELECT level FROM card_difficulty_levels WHERE card_id=? AND framework=?').bind(r.internal_id, 'CEFR').first();
              cefr = lvl ? lvl.level : null;
            } catch {}
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${r.film_slug || 'item'}_${Number(r.episode_number) || 1}`;
            const startS = (r.start_time != null) ? r.start_time : 0;
            const endS = (r.end_time != null) ? r.end_time : 0;
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, is_available: r.is_available, cefr_level: cefr, film_id: r.film_slug, subtitle });
          }
          return json(out);
        } catch (e) {
          return json([]);
        }
      }

      // 7) Card by path (lookup by film slug, episode slug, and display card id (card_number padded))
      const cardMatch = path.match(/^\/cards\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (cardMatch && request.method === 'GET') {
        const filmSlug = cardMatch[1];
        const episodeSlug = cardMatch[2];
        const cardDisplay = cardMatch[3];
        try {
          const film = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!film) return new Response('Not found', { status: 404, headers: withCors() });
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id,slug FROM episodes WHERE content_item_id=? AND episode_number=?').bind(film.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id,slug FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch {}
          }
          if (!ep) return new Response('Not found', { status: 404, headers: withCors() });
          const cardNum = Number(cardDisplay);
          let row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
          if (!row) {
            // Legacy fallback
            row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
          }
          if (!row) return new Response('Not found', { status: 404, headers: withCors() });
          const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(row.internal_id).all();
          const subtitle = {};
          (subs.results || []).forEach(s => { subtitle[s.language] = s.text; });
          let cefr = null;
          try {
            const lvl = await env.DB.prepare('SELECT level FROM card_difficulty_levels WHERE card_id=? AND framework=?').bind(row.internal_id, 'CEFR').first();
            cefr = lvl ? lvl.level : null;
          } catch {}
          const displayId = String(row.card_number ?? '').padStart(3, '0');
          const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
          const displayPadded = `e${String(epNum).padStart(3,'0')}`;
          const startS = (row.start_time != null) ? row.start_time : Math.round((row.start_time_ms || 0) / 1000);
          const endS = (row.end_time != null) ? row.end_time : Math.round((row.end_time_ms || 0) / 1000);
          const dur = (row.duration != null) ? row.duration : Math.max(0, endS - startS);
          return json({ id: displayId, episode_id: outEpisodeId, episode_display: displayPadded, film_id: filmSlug, start: startS, end: endS, duration: dur, image_key: row.image_key, audio_key: row.audio_key, sentence: row.sentence, card_type: row.card_type, length: row.length, difficulty_score: row.difficulty_score, cefr_level: cefr, subtitle, is_available: row.is_available ?? 1 });
        } catch { return new Response('Not found', { status: 404, headers: withCors() }); }
      }
      // PATCH card: update subtitles, audio_key, image_key
      if (cardMatch && request.method === 'PATCH') {
        const filmSlug = cardMatch[1];
        const episodeSlug = cardMatch[2];
        const cardDisplay = cardMatch[3];
        try {
          const body = await request.json();
          const film = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!film) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(film.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch {}
          }
          if (!ep) return json({ error: 'Not found' }, { status: 404 });
          const cardNum = Number(cardDisplay);
          const row = await env.DB.prepare('SELECT id FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
          if (!row) return json({ error: 'Not found' }, { status: 404 });
          
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            // Update subtitle if provided
            if (body.subtitle && typeof body.subtitle === 'object') {
              // Replace existing subtitles and mirror into FTS
              await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run();
              await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run();
              for (const [lang, text] of Object.entries(body.subtitle)) {
                if (text && String(text).trim()) {
                  await env.DB.prepare('INSERT INTO card_subtitles (card_id, language, text) VALUES (?, ?, ?)').bind(row.id, lang, text).run();
                  const idxText = (String(lang).toLowerCase() === 'ja') ? expandJaIndexText(String(text)) : String(text);
                  await env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, lang, row.id).run();
                }
              }
            }
            // Update audio_key if provided
            if (body.audio_url) {
              const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
              const audioKey = normalizeKey(body.audio_url);
              await env.DB.prepare('UPDATE cards SET audio_key=? WHERE id=?').bind(audioKey, row.id).run();
            }
            // Update image_key if provided
            if (body.image_url) {
              const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
              const imageKey = normalizeKey(body.image_url);
              await env.DB.prepare('UPDATE cards SET image_key=? WHERE id=?').bind(imageKey, row.id).run();
            }
            // Update is_available if provided
            if (typeof body.is_available === 'number' || typeof body.is_available === 'boolean') {
              const isAvail = body.is_available ? 1 : 0;
              await env.DB.prepare('UPDATE cards SET is_available=? WHERE id=?').bind(isAvail, row.id).run();
            }
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          return json({ ok: true, updated: String(cardNum).padStart(4, '0') });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      if (cardMatch && request.method === 'DELETE') {
        const filmSlug = cardMatch[1];
        const episodeSlug = cardMatch[2];
        const cardDisplay = cardMatch[3];
        try {
          const film = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!film) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(film.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch {}
          }
          if (!ep) return json({ error: 'Not found' }, { status: 404 });
          const cardNum = Number(cardDisplay);
          const row = await env.DB.prepare('SELECT id, card_number, image_key, audio_key FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
          if (!row) return json({ error: 'Not found' }, { status: 404 });
          // Enforce: cannot delete the first card in the episode
          let minRow = await env.DB.prepare('SELECT MIN(card_number) AS mn FROM cards WHERE episode_id=?').bind(ep.id).first().catch(() => null);
          const minCard = minRow ? Number(minRow.mn) : cardNum;
          if (row.card_number === minCard) {
            return json({ error: 'Cannot delete the first card' }, { status: 400 });
          }
          const mediaKeys = new Set();
          const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
          if (row.image_key) mediaKeys.add(normalizeKey(row.image_key));
          if (row.audio_key) mediaKeys.add(normalizeKey(row.audio_key));
          // Delete DB rows
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            try { await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM cards WHERE id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          // Delete media
          let mediaDeletedCount = 0; const mediaErrors = [];
          if (env.MEDIA_BUCKET) {
            for (const k of mediaKeys) {
              if (!k) continue;
              try { await env.MEDIA_BUCKET.delete(k); mediaDeletedCount += 1; }
              catch { mediaErrors.push(`fail:${k}`); }
            }
          }
          return json({ ok: true, deleted: String(cardNum).padStart(4,'0'), media_deleted: mediaDeletedCount, media_errors: mediaErrors });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 8) Media proxy with CORS (serves R2 objects for waveform preview and client access)
      if (path.startsWith('/media/')) {
        const key = path.replace(/^\/media\//, '');
        if (!key) return new Response('Not found', { status: 404, headers: withCors() });
        try {
          const obj = await env.MEDIA_BUCKET.get(key);
          if (!obj) return new Response('Not found', { status: 404, headers: withCors() });
          const headers = withCors({
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          return new Response(obj.body, { headers });
        } catch (e) {
          return new Response('Not found', { status: 404, headers: withCors() });
        }
      }

      // 9) Import bulk (server generates UUIDs; client provides slug and numbers)
      if (path === '/import' && request.method === 'POST') {
        const body = await request.json();
          const film = body.film || {};
        const cards = body.cards || [];
        const episodeNumber = Number(body.episodeNumber ?? String(body.episodeId || '').replace(/^e/i, '')) || 1;
        const filmSlug = film.slug || film.id; // backward compatibility: treat provided id as slug
        if (!filmSlug) return json({ error: 'Missing film.slug' }, { status: 400 });
        const mode = body.mode === 'replace' ? 'replace' : 'append';
        try {
          // Ensure film exists (by slug), else create with UUID id
          let filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) {
            const uuid = crypto.randomUUID();
            // Normalize cover key if provided
            const coverKey = (film.cover_key || film.cover_url) ? String((film.cover_key || film.cover_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
            const totalEpisodesIns = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : 1;
            await env.DB.prepare('INSERT INTO content_items (id,slug,title,main_language,type,description,cover_key,release_year,total_episodes,is_original) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(
              uuid,
              filmSlug,
              film.title || filmSlug,
              film.language || film.main_language || 'en',
              film.type || 'movie',
              film.description || '',
              coverKey,
              film.release_year || null,
              totalEpisodesIns,
              (film.is_original === false ? 0 : 1)
            ).run();
            filmRow = { id: uuid };
          } else {
            // Update metadata if provided
            const coverKey = (film.cover_key || film.cover_url) ? String((film.cover_key || film.cover_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
            const totalEpisodes = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : null;
            await env.DB.prepare('UPDATE content_items SET title=COALESCE(?,title), main_language=COALESCE(?,main_language), type=COALESCE(?,type), description=COALESCE(?,description), cover_key=COALESCE(?,cover_key), release_year=COALESCE(?,release_year), total_episodes=COALESCE(?,total_episodes), is_original=COALESCE(?,is_original) WHERE id=?').bind(
              film.title || null,
              film.language || film.main_language || null,
              film.type || null,
              film.description || null,
              coverKey,
              film.release_year || null,
              totalEpisodes,
              (typeof film.is_original === 'boolean' ? (film.is_original ? 1 : 0) : null),
              filmRow.id
            ).run();
          }
          if (Array.isArray(film.available_subs) && film.available_subs.length) {
            const subLangStmts = film.available_subs.map((lang) => env.DB.prepare('INSERT OR IGNORE INTO content_item_languages (content_item_id,language) VALUES (?,?)').bind(filmRow.id, lang));
            try { await env.DB.batch(subLangStmts); } catch {}
          }
          // Ensure episode exists, else create
          let episode;
          try {
            episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, episodeNumber).first();
          } catch (e) {
            try { episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, episodeNumber).first(); } catch {}
          }
          if (!episode) {
            const epUuid = crypto.randomUUID();
            const epPadded = String(episodeNumber).padStart(3, '0');
            const episodeTitle = (film.episode_title && String(film.episode_title).trim()) ? String(film.episode_title).trim() : `e${epPadded}`;
            const episodeDescription = (film.episode_description && String(film.episode_description).trim()) ? String(film.episode_description).trim() : null;
            const episodeSlug = `${filmSlug}_${epPadded}`;
            // Insert with slug column if available; fallback without slug on older schema
            try {
              await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_number,title,slug,description) VALUES (?,?,?,?,?,?)').bind(
                epUuid,
                filmRow.id,
                episodeNumber,
                episodeTitle,
                episodeSlug,
                episodeDescription
              ).run();
            } catch (e) {
              // Fallback older schema with episode_num
              try {
                await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_num,title,slug,description) VALUES (?,?,?,?,?,?)').bind(
                  epUuid,
                  filmRow.id,
                  episodeNumber,
                  episodeTitle,
                  episodeSlug,
                  episodeDescription
                ).run();
              } catch (e2) {
                await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_num,title,description) VALUES (?,?,?,?)').bind(
                  epUuid,
                  filmRow.id,
                  episodeNumber,
                  episodeTitle,
                  episodeDescription
                ).run();
              }
            }
            episode = { id: epUuid };
          }
          // Validate: total_episodes should be >= current max episode
          try {
            let maxRow;
            try {
              maxRow = await env.DB.prepare('SELECT IFNULL(MAX(episode_number),0) as mx FROM episodes WHERE content_item_id=?').bind(filmRow.id).first();
            } catch (e) {
              try { maxRow = await env.DB.prepare('SELECT IFNULL(MAX(episode_num),0) as mx FROM episodes WHERE content_item_id=?').bind(filmRow.id).first(); } catch {}
            }
            const maxUploaded = maxRow ? Number(maxRow.mx) : 0;
            const totalEpisodes = Number(film.total_episodes || 0);
            if (totalEpisodes && totalEpisodes < maxUploaded) {
              return json({ error: `Total Episodes (${totalEpisodes}) cannot be less than highest uploaded episode (${maxUploaded}).` }, { status: 400 });
            }
          } catch {}
          // If mode is replace, delete existing cards and subtitles for this episode before inserting new ones
          if (mode === 'replace') {
            try {
              await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
            } catch {}
            try {
              await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
            } catch {}
            try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM cards WHERE episode_id=?').bind(episode.id).run(); } catch {}
          }

          // Helper: run an array of prepared statements in batches to minimize API calls
          async function runStmtBatches(stmts, size = 200) {
            for (let i = 0; i < stmts.length; i += size) {
              const slice = stmts.slice(i, i + size);
              if (slice.length) await env.DB.batch(slice);
            }
          }

          // Prebuild statements
          const cardsNewSchema = [];
          const cardsLegacySchema = [];
          const subStmts = [];
          const ftsStmts = [];
          const diffStmts = [];

          const normalizeKey = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+\//, '') : null);

          const cardIds = []; // keep generated uuids in order for debugging if needed
          let seqCounter = 1; // safe fallback when card_number is missing/invalid
          for (const c of cards) {
            const cardUuid = crypto.randomUUID();
            cardIds.push(cardUuid);
            const rawNum = (c.card_number != null) ? Number(c.card_number) : (c.id ? Number(String(c.id).replace(/^0+/, '')) : NaN);
            const cardNum = Number.isFinite(rawNum) ? rawNum : seqCounter++;
            let diffScoreVal = null;
            if (typeof c.difficulty_score === 'number') diffScoreVal = c.difficulty_score;
            else if (typeof c.difficulty === 'number') diffScoreVal = c.difficulty <= 5 ? (c.difficulty / 5) * 100 : c.difficulty;
            const sStart = Math.max(0, Math.round(Number(c.start || 0)));
            const sEnd = Math.max(0, Math.round(Number(c.end || 0)));
            const dur = Math.max(0, sEnd - sStart);
            // is_available: default 1 (true), set to 0 (false) if card explicitly has is_available=false
            const isAvail = (c.is_available === false || c.is_available === 0) ? 0 : 1;

            cardsNewSchema.push(
              env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time,end_time,duration,image_key,audio_key,sentence,card_type,length,difficulty_score,is_available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
                .bind(cardUuid, episode.id, cardNum, sStart, sEnd, dur, normalizeKey(c.image_url), normalizeKey(c.audio_url), c.sentence || null, c.type || c.card_type || null, (typeof c.length === 'number' ? Math.floor(c.length) : null), (typeof diffScoreVal === 'number' ? diffScoreVal : null), isAvail)
            );
            cardsLegacySchema.push(
              env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time_ms,end_time_ms,image_key,audio_key,sentence,card_type,length,difficulty_score,is_available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
                .bind(cardUuid, episode.id, cardNum, sStart * 1000, sEnd * 1000, normalizeKey(c.image_url), normalizeKey(c.audio_url), c.sentence || null, c.type || c.card_type || null, (typeof c.length === 'number' ? Math.floor(c.length) : null), (typeof diffScoreVal === 'number' ? diffScoreVal : null), isAvail)
            );

            if (c.subtitle) {
              for (const [lang, text] of Object.entries(c.subtitle)) {
                if (!text) continue;
                subStmts.push(env.DB.prepare('INSERT OR IGNORE INTO card_subtitles (card_id,language,text) VALUES (?,?,?)').bind(cardUuid, lang, text));
                const idxText = (String(lang).toLowerCase() === 'ja') ? expandJaIndexText(String(text)) : String(text);
                ftsStmts.push(env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, lang, cardUuid));
              }
            }
            if (Array.isArray(c.difficulty_levels)) {
              for (const d of c.difficulty_levels) {
                if (!d || !d.framework || !d.level) continue;
                const lang = d.language || null;
                diffStmts.push(env.DB.prepare('INSERT OR REPLACE INTO card_difficulty_levels (card_id,framework,level,language) VALUES (?,?,?,?)').bind(cardUuid, String(d.framework), String(d.level), lang));
              }
            } else if (c.CEFR_Level) {
              diffStmts.push(env.DB.prepare('INSERT OR REPLACE INTO card_difficulty_levels (card_id,framework,level,language) VALUES (?,?,?,?)').bind(cardUuid, 'CEFR', String(c.CEFR_Level), 'en'));
            }
          }

          // Execute in a transaction; try new schema first, fallback to legacy once
          const runImport = async (useLegacy) => {
            try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
            try {
              await runStmtBatches(useLegacy ? cardsLegacySchema : cardsNewSchema, 200);
              await runStmtBatches(subStmts, 400);
              await runStmtBatches(ftsStmts, 400);
              await runStmtBatches(diffStmts, 400);
              try { await env.DB.prepare('COMMIT').run(); } catch {}
              return true;
            } catch (e) {
              try { await env.DB.prepare('ROLLBACK').run(); } catch {}
              throw e;
            }
          };

          try {
            await runImport(false);
          } catch (e1) {
            const msg = (e1 && e1.message) ? String(e1.message) : String(e1);
            const isNewSchemaMissing = /no\s+such\s+column\s*:.*start_time\b/i.test(msg) || /no\s+such\s+column\s*:.*end_time\b/i.test(msg) || /no\s+column\s+named\s+start_time\b/i.test(msg);
            // Only attempt legacy fallback if the error indicates old ms-columns schema
            if (isNewSchemaMissing) {
              try {
                await runImport(true);
              } catch (e2) {
                const m2 = (e2 && e2.message) ? String(e2.message) : String(e2);
                return json({ error: `Import failed (legacy fallback also failed): new-schema error='${msg}', legacy error='${m2}'` }, { status: 500 });
              }
            } else {
              // Surface the original error to the client for accurate diagnosis
              return json({ error: msg }, { status: 500 });
            }
          }

          return json({ ok: true, inserted: cards.length, mode });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Admin: Reindex FTS (ja) with mixed kanji/kana expansions from stored subtitles
      if (path === '/admin/reindex-fts-ja' && request.method === 'POST') {
        // Lightweight guard: require explicit confirm=1 query param
        if (url.searchParams.get('confirm') !== '1') {
          return json({ error: 'confirm=1 required' }, { status: 400 });
        }
        try {
          // Fetch all JA subtitles and rebuild corresponding FTS rows
          const rows = await env.DB.prepare('SELECT card_id, language, text FROM card_subtitles WHERE LOWER(language)=?').bind('ja').all();
          const items = rows.results || [];
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            // Clear existing JA entries in FTS
            try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE LOWER(language)=?').bind('ja').run(); } catch {}
            // Insert rebuilt entries in batches
            const stmts = [];
            for (const r of items) {
              const idxText = expandJaIndexText(r.text);
              stmts.push(env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, r.language, r.card_id));
            }
            // Batch inserts to avoid exceeding limits
            for (let i = 0; i < stmts.length; i += 300) {
              const slice = stmts.slice(i, i + 300);
              if (slice.length) await env.DB.batch(slice);
            }
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          return json({ ok: true, rebuilt: items.length });
        } catch (e) {
          return json({ error: String(e) }, { status: 500 });
        }
      }

      return new Response('Not found', { status: 404, headers: withCors() });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  }
};
