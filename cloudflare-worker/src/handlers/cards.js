import { json } from '../utils/response.js';
import { expandJaIndexText } from '../utils/japanese.js';
import { updateCardSubtitleLanguageMap } from '../services/cardHelpers.js';

export function registerCardRoutes(router) {

  // GET /cards/:filmSlug/:episodeSlug/:cardId (enhanced single card)
  router.get('/cards/:filmSlug/:episodeSlug/:cardId', async (request, env) => {
    const url = new URL(request.url);
    const filmSlug = decodeURIComponent(request.params.filmSlug);
    const episodeSlug = decodeURIComponent(request.params.episodeSlug);
    const cardId = decodeURIComponent(request.params.cardId);
    try {
      const basePublic = env.R2_PUBLIC_BASE || '';
      const makeMediaUrl = (k) => {
        if (!k) return null;
        return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
      };

      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) return json({ error: 'Not found' }, { status: 404 });

      let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
      if (!epNum || Number.isNaN(epNum)) {
        const m = String(episodeSlug).match(/_(\d+)$/);
        epNum = m ? Number(m[1]) : 1;
      }

      let ep;
      try {
        ep = await env.DB.prepare('SELECT id, slug FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
      } catch (e) {
        try {
          ep = await env.DB.prepare('SELECT id, slug FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
        } catch { }
      }
      if (!ep) return json({ error: 'Not found' }, { status: 404 });

      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId);
      let cardRow;

      if (isUUID) {
        try {
          cardRow = await env.DB.prepare(`
            SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                   c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                   c.difficulty_score, c.is_available,
                   ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                   e.slug AS episode_slug, e.episode_number
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.id = ? AND c.episode_id = ?
          `).bind(cardId, ep.id).first();
        } catch (e) {
          console.error('[WORKER /cards] Error fetching by UUID:', e);
        }
      }

      if (!cardRow) {
        const cardNumberPadded = String(cardId).padStart(3, '0');
        const cardNumber = Number(cardNumberPadded);
        if (!Number.isNaN(cardNumber)) {
          try {
            cardRow = await env.DB.prepare(`
              SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                     c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                     c.difficulty_score, c.is_available,
                     ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                     e.slug AS episode_slug, e.episode_number
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE c.episode_id = ? AND c.card_number = ?
            `).bind(ep.id, cardNumber).first();
          } catch (e) {
            console.error('[WORKER /cards] Error fetching by card_number:', e);
          }
        }
      }

      if (!cardRow && isUUID) {
        try {
          cardRow = await env.DB.prepare(`
            SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                   c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                   c.difficulty_score, c.is_available,
                   ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                   e.slug AS episode_slug, e.episode_number
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE c.id = ? AND ci.id = ?
          `).bind(cardId, filmRow.id).first();
        } catch (e) {
          console.error('[WORKER /cards] Error fetching by UUID (no episode check):', e);
        }
      }

      if (!cardRow) return json({ error: 'Not found' }, { status: 404 });

      const [subsResult, levelsResult] = await Promise.all([
        env.DB.prepare('SELECT language, text FROM card_subtitles WHERE card_id=?').bind(cardRow.id).all(),
        env.DB.prepare('SELECT framework, level, language FROM card_difficulty_levels WHERE card_id=?').bind(cardRow.id).all()
      ]);

      const subtitle = {};
      (subsResult.results || []).forEach(s => {
        subtitle[s.language] = s.text;
      });

      const levels = [];
      (levelsResult.results || []).forEach(l => {
        levels.push({
          framework: l.framework,
          level: l.level,
          language: l.language || null
        });
      });

      const displayId = String(cardRow.card_number ?? '').padStart(3, '0');
      const out = {
        id: displayId,
        card_id: cardRow.id,
        film_id: filmSlug,
        episode_id: cardRow.episode_slug || `${filmSlug}_${epNum}`,
        episode: cardRow.episode_number,
        start: cardRow.start_time,
        end: cardRow.end_time,
        duration: cardRow.duration || Math.max(0, cardRow.end_time - cardRow.start_time),
        image_key: cardRow.image_key,
        audio_key: cardRow.audio_key,
        image_url: makeMediaUrl(cardRow.image_key),
        audio_url: makeMediaUrl(cardRow.audio_key),
        sentence: cardRow.sentence,
        card_type: cardRow.card_type,
        length: cardRow.length,
        difficulty_score: cardRow.difficulty_score,
        cefr_level: levels.find(l => l.framework === 'CEFR')?.level || null,
        levels: levels,
        subtitle: subtitle,
        is_available: cardRow.is_available ?? 1,
        content_slug: cardRow.content_slug,
        content_title: cardRow.content_title,
        content_main_language: cardRow.main_language
      };

      return json(out);
    } catch (e) {
      console.error('[WORKER /cards/{filmSlug}/{episodeSlug}/{cardId}] Error:', e);
      return json({ error: 'Internal server error' }, { status: 500 });
    }
  });

  // GET /cards
  router.get('/cards', async (request, env) => {
    const url = new URL(request.url);
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
          const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                   FROM cards c JOIN episodes e ON c.episode_id=e.id
                   ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
          try { res = await env.DB.prepare(sql3).bind(limit).all(); }
          catch { res = { results: [] }; }
        }
      }
      const rows = res.results || [];
      const cardIds = rows.map(r => r.internal_id);
      const filmIds = [...new Set(rows.map(r => r.film_id))];
      const subsMap = new Map();
      const cefrMap = new Map();
      const filmSlugMap = new Map();
      if (cardIds.length > 0) {
        const batchSize = 50;
        const subtitleBatches = [];
        const cefrBatches = [];

        for (let i = 0; i < cardIds.length; i += batchSize) {
          const batch = cardIds.slice(i, i + batchSize);
          const ph = batch.map(() => '?').join(',');

          subtitleBatches.push(
            env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all()
              .then(result => {
                (result.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              })
              .catch(e => console.error('[WORKER /cards] Error fetching subtitles batch:', e))
          );

          cefrBatches.push(
            env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${ph}) AND framework='CEFR'`).bind(...batch).all()
              .then(result => {
                (result.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              })
              .catch(e => console.error('[WORKER /cards] Error fetching CEFR levels batch:', e))
          );
        }

        try {
          await Promise.all([...subtitleBatches, ...cefrBatches]);
        } catch (e) {
          console.error('[WORKER /cards] Error in batch fetch:', e);
        }
      }
      if (filmIds.length > 0) {
        const batchSize = 10;
        const filmPromises = [];

        for (let i = 0; i < filmIds.length; i += batchSize) {
          const batch = filmIds.slice(i, i + batchSize);
          const phFilm = batch.map(() => '?').join(',');

          filmPromises.push(
            env.DB.prepare(`SELECT id, slug FROM content_items WHERE id IN (${phFilm})`).bind(...batch).all()
              .then(result => {
                (result.results || []).forEach(f => filmSlugMap.set(f.id, f.slug));
              })
              .catch(e => console.error('[WORKER /cards] Error fetching film slug batch:', e))
          );
        }

        await Promise.all(filmPromises);
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
  });

  // GET /search
  router.get('/search', async (request, env) => {
    const url = new URL(request.url);
    const searchStart = Date.now();
    const qRaw = url.searchParams.get('q') || '';
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50')));
    const includeContentMeta = url.searchParams.get('include_content_meta') === '1';
    const mainLanguage = url.searchParams.get('main') || url.searchParams.get('main_language') || 'en';
    const contentIdsCsv = url.searchParams.get('content_ids') || '';
    const subtitleLangsCsv = url.searchParams.get('subtitle_languages') || '';
    const difficultyMin = url.searchParams.get('difficulty_min');
    const difficultyMax = url.searchParams.get('difficulty_max');
    const levelMin = url.searchParams.get('level_min');
    const levelMax = url.searchParams.get('level_max');
    const lengthMin = url.searchParams.get('length_min');
    const lengthMax = url.searchParams.get('length_max');
    const durationMax = url.searchParams.get('duration_max');

    const q = qRaw.trim().toLowerCase();
    if (!q) return json([]);

    const contentIdsArr = contentIdsCsv ? contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean) : [];
    const subtitleLangsArr = subtitleLangsCsv ? [...new Set(subtitleLangsCsv.split(',').map(s => s.trim()).filter(Boolean))] : [];

    try {
      const basePublic = env.R2_PUBLIC_BASE || '';
      const makeMediaUrl = (k) => {
        if (!k) return null;
        return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
      };

      const conditions = [
        'cs.language = ?',
        'cs.text LIKE ?',
        'c.is_available = 1',
        'ci.main_language = ?',
      ];
      const params = [mainLanguage, `%${q}%`, mainLanguage];

      if (contentIdsArr.length > 0) {
        conditions.push(`ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`);
        params.push(...contentIdsArr);
      }
      if (difficultyMin != null && difficultyMin !== '') {
        conditions.push('c.difficulty_score >= ?');
        params.push(Number(difficultyMin));
      }
      if (difficultyMax != null && difficultyMax !== '') {
        conditions.push('c.difficulty_score <= ?');
        params.push(Number(difficultyMax));
      }
      if (lengthMin != null && lengthMin !== '') {
        conditions.push('c.length >= ?');
        params.push(Number(lengthMin));
      }
      if (lengthMax != null && lengthMax !== '') {
        conditions.push('c.length <= ?');
        params.push(Number(lengthMax));
      }
      if (durationMax != null && durationMax !== '') {
        conditions.push('c.duration <= ?');
        params.push(Number(durationMax));
      }
      if (levelMin || levelMax) {
        const levelConds = ['cdl_filter.framework = ?'];
        const levelParams = ['CEFR'];
        if (levelMin) { levelConds.push('cdl_filter.level >= ?'); levelParams.push(levelMin); }
        if (levelMax) { levelConds.push('cdl_filter.level <= ?'); levelParams.push(levelMax); }
        conditions.push(`EXISTS (SELECT 1 FROM card_difficulty_levels cdl_filter WHERE cdl_filter.card_id = c.id AND ${levelConds.join(' AND ')})`);
        params.push(...levelParams);
      }

      const dbLimit = limit * 3;
      params.push(dbLimit);

      const whereClause = conditions.join('\n                AND ');
      const stmt = `
          SELECT
            c.id as internal_id,
            c.card_number,
            c.start_time,
            c.end_time,
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
            cs.text as matched_text
          FROM card_subtitles cs
          JOIN cards c ON c.id = cs.card_id
          JOIN episodes e ON e.id = c.episode_id
          JOIN content_items ci ON ci.id = e.content_item_id
          WHERE ${whereClause}
          ORDER BY c.id ASC
          LIMIT ?
      `;

      console.log(`[PERF /search] Query start | q="${q}" lang=${mainLanguage} limit=${limit} dbLimit=${dbLimit} contentIds=${contentIdsArr.length} filters=${conditions.length - 4}`);
      const queryStart = Date.now();
      const { results: rawResults } = await env.DB.prepare(stmt).bind(...params).all();
      const queryTime = Date.now() - queryStart;
      console.log(`[PERF /search] Main query: ${queryTime}ms | Rows: ${(rawResults || []).length}`);

      if (!rawResults || rawResults.length === 0) {
        console.log(`[PERF /search] Total: ${Date.now() - searchStart}ms | 0 results`);
        return json([]);
      }

      const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const wordRegex = new RegExp('\\b' + escapeRegex(q) + '\\b', 'i');
      const results = rawResults
        .filter(r => wordRegex.test(r.matched_text || r.sentence || ''))
        .slice(0, limit);

      console.log(`[PERF /search] Word-boundary filter: ${rawResults.length} -> ${results.length} rows`);

      if (results.length === 0) {
        console.log(`[PERF /search] Total: ${Date.now() - searchStart}ms | 0 results after word filter`);
        return json([]);
      }

      const cardIds = results.map(r => r.internal_id);
      const ph = cardIds.map(() => '?').join(',');

      const subsLangs = subtitleLangsArr.length > 0
        ? [...new Set([mainLanguage, ...subtitleLangsArr])]
        : [mainLanguage];
      const subsLangPh = subsLangs.map(() => '?').join(',');

      const batchStart = Date.now();
      const uniqueSlugs = includeContentMeta ? [...new Set(results.map(r => r.film_slug).filter(Boolean))] : [];
      const metaPh = uniqueSlugs.length > 0 ? uniqueSlugs.map(() => '?').join(',') : '';

      const [subsResult, levelsResult, metaResult] = await Promise.all([
        env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph}) AND language IN (${subsLangPh})`).bind(...cardIds, ...subsLangs).all(),
        env.DB.prepare(`SELECT card_id, framework, level, language FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).all(),
        uniqueSlugs.length > 0
          ? env.DB.prepare(`SELECT slug as id, title, type, main_language, level_framework_stats FROM content_items WHERE slug IN (${metaPh})`).bind(...uniqueSlugs).all()
          : Promise.resolve(null),
      ]);
      const batchTime = Date.now() - batchStart;
      console.log(`[PERF /search] Batch fetch: ${batchTime}ms | Subs: ${(subsResult.results || []).length} | Levels: ${(levelsResult.results || []).length}`);

      const subtitlesMap = new Map();
      for (const sub of (subsResult.results || [])) {
        if (!subtitlesMap.has(sub.card_id)) subtitlesMap.set(sub.card_id, {});
        subtitlesMap.get(sub.card_id)[sub.language] = sub.text;
      }

      const cefrMap = new Map();
      const levelsMap = new Map();
      for (const row of (levelsResult.results || [])) {
        if (!levelsMap.has(row.card_id)) levelsMap.set(row.card_id, []);
        levelsMap.get(row.card_id).push({ framework: row.framework, level: row.level, language: row.language || null });
        if (row.framework === 'CEFR' && !cefrMap.has(row.card_id)) cefrMap.set(row.card_id, row.level);
      }

      let contentMeta = null;
      if (metaResult && metaResult.results) {
        contentMeta = {};
        for (const r of metaResult.results) {
          let ls = null;
          if (r.level_framework_stats) { try { ls = JSON.parse(r.level_framework_stats); } catch {} }
          contentMeta[r.id] = { id: r.id, title: r.title, type: r.type, main_language: r.main_language, level_framework_stats: ls };
        }
      }

      const out = results.map(r => {
        const episodeSlug = r.episode_slug || `${r.film_slug || 'item'}_${Number(r.episode_number) || 1}`;
        return {
          id: String(r.card_number ?? '').padStart(3, '0'),
          card_id: r.internal_id,
          episode: episodeSlug,
          episode_slug: episodeSlug,
          episode_id: episodeSlug,
          episode_number: r.episode_number,
          content_slug: r.film_slug,
          film_id: r.film_slug,
          card_number: r.card_number,
          start: r.start_time ?? 0,
          start_time: r.start_time ?? 0,
          end: r.end_time ?? 0,
          end_time: r.end_time ?? 0,
          duration: r.duration ?? Math.max(0, (r.end_time ?? 0) - (r.start_time ?? 0)),
          image_key: r.image_key,
          audio_key: r.audio_key,
          image_url: makeMediaUrl(r.image_key),
          audio_url: makeMediaUrl(r.audio_key),
          sentence: r.sentence,
          text: (subtitlesMap.get(r.internal_id) && subtitlesMap.get(r.internal_id)[mainLanguage]) || r.sentence || '',
          card_type: r.card_type,
          length: r.length,
          difficulty_score: r.difficulty_score,
          is_available: r.is_available,
          cefr_level: cefrMap.get(r.internal_id) || null,
          levels: levelsMap.get(r.internal_id) || [],
          subtitle: subtitlesMap.get(r.internal_id) || {},
        };
      });

      const totalTime = Date.now() - searchStart;
      console.log(`[PERF /search] Total: ${totalTime}ms | Query: ${queryTime}ms | Batch: ${batchTime}ms | Results: ${out.length}`);

      if (contentMeta) {
        return json({ items: out, content_meta: contentMeta });
      }
      return json(out);
    } catch (e) {
      console.error(`[PERF /search] Error after ${Date.now() - searchStart}ms:`, e.message);
      return json([]);
    }
  });

  // PATCH /cards/:filmSlug/:episodeSlug/:cardDisplay
  router.patch('/cards/:filmSlug/:episodeSlug/:cardDisplay', async (request, env) => {
    const filmSlug = request.params.filmSlug;
    const episodeSlug = request.params.episodeSlug;
    const cardDisplay = request.params.cardDisplay;
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
        try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch { }
      }
      if (!ep) return json({ error: 'Not found' }, { status: 404 });
      const cardNum = Number(cardDisplay);
      const row = await env.DB.prepare('SELECT id FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
      if (!row) return json({ error: 'Not found' }, { status: 404 });

      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        if (body.subtitle && typeof body.subtitle === 'object') {
          await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run();
          await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run();
          for (const [lang, text] of Object.entries(body.subtitle)) {
            if (text && String(text).trim()) {
              await env.DB.prepare('INSERT INTO card_subtitles (card_id, language, text) VALUES (?, ?, ?)').bind(row.id, lang, text).run();
              const idxText = (String(lang).toLowerCase() === 'ja') ? expandJaIndexText(String(text)) : String(text);
              await env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, lang, row.id).run();
            }
          }
          await updateCardSubtitleLanguageMap(env, row.id);
        }
        if (body.audio_url) {
          const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
          const audioKey = normalizeKey(body.audio_url);
          await env.DB.prepare('UPDATE cards SET audio_key=? WHERE id=?').bind(audioKey, row.id).run();
        }
        if (body.image_url) {
          const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
          const imageKey = normalizeKey(body.image_url);
          await env.DB.prepare('UPDATE cards SET image_key=? WHERE id=?').bind(imageKey, row.id).run();
        }
        if (typeof body.is_available === 'number' || typeof body.is_available === 'boolean') {
          const isAvail = body.is_available ? 1 : 0;
          await env.DB.prepare('UPDATE cards SET is_available=? WHERE id=?').bind(isAvail, row.id).run();
        }
        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }
      return json({ ok: true, updated: String(cardNum).padStart(4, '0') });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // DELETE /cards/:filmSlug/:episodeSlug/:cardDisplay
  router.delete('/cards/:filmSlug/:episodeSlug/:cardDisplay', async (request, env) => {
    const filmSlug = request.params.filmSlug;
    const episodeSlug = request.params.episodeSlug;
    const cardDisplay = request.params.cardDisplay;
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
        try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch { }
      }
      if (!ep) return json({ error: 'Not found' }, { status: 404 });
      const cardNum = Number(cardDisplay);
      const row = await env.DB.prepare('SELECT id, card_number, image_key, audio_key FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
      if (!row) return json({ error: 'Not found' }, { status: 404 });
      let minRow = await env.DB.prepare('SELECT MIN(card_number) AS mn FROM cards WHERE episode_id=?').bind(ep.id).first().catch(() => null);
      const minCard = minRow ? Number(minRow.mn) : cardNum;
      if (row.card_number === minCard) {
        return json({ error: 'Cannot delete the first card' }, { status: 400 });
      }
      const mediaKeys = new Set();
      const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
      if (row.image_key) mediaKeys.add(normalizeKey(row.image_key));
      if (row.audio_key) mediaKeys.add(normalizeKey(row.audio_key));
      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        try { await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run(); } catch { }
        try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run(); } catch { }
        try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id=?').bind(row.id).run(); } catch { }
        await updateCardSubtitleLanguageMap(env, row.id);
        try { await env.DB.prepare('DELETE FROM cards WHERE id=?').bind(row.id).run(); } catch { }
        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }
      let mediaDeletedCount = 0; const mediaErrors = [];
      if (env.MEDIA_BUCKET) {
        for (const k of mediaKeys) {
          if (!k) continue;
          try { await env.MEDIA_BUCKET.delete(k); mediaDeletedCount += 1; }
          catch { mediaErrors.push(`fail:${k}`); }
        }
      }
      return json({ ok: true, deleted: String(cardNum).padStart(4, '0'), media_deleted: mediaDeletedCount, media_errors: mediaErrors });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
