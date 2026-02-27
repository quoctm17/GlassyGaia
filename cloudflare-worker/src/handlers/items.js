import { json } from '../utils/response.js';
import { buildLevelStats } from '../utils/levels.js';
import { updateCardSubtitleLanguageMapBatch } from '../services/cardHelpers.js';

export function registerItemRoutes(router) {

  // GET /items — list all items
  router.get('/items', async (request, env) => {
    try {
      const [itemsResult, langsResult, categoriesResult] = await Promise.all([
        env.DB.prepare(`
          SELECT ci.id as internal_id, ci.slug as id, ci.title, ci.main_language, ci.type, ci.release_year, ci.description, ci.total_episodes as episodes, ci.is_original, ci.level_framework_stats, ci.cover_key, ci.cover_landscape_key, ci.is_available
        FROM content_items ci
          ORDER BY ci.slug
        `).all(),
        env.DB.prepare(`
          SELECT content_item_id, language
          FROM content_item_languages
        `).all(),
        env.DB.prepare(`
          SELECT cic.content_item_id, c.id, c.name
          FROM content_item_categories cic
          INNER JOIN categories c ON c.id = cic.category_id
          ORDER BY c.name ASC
        `).all()
      ]);

      const base = env.R2_PUBLIC_BASE || '';
      const map = new Map();

      const langMap = new Map();
      for (const r of (langsResult.results || [])) {
        if (!langMap.has(r.content_item_id)) {
          langMap.set(r.content_item_id, []);
        }
        if (r.language && !langMap.get(r.content_item_id).includes(r.language)) {
          langMap.get(r.content_item_id).push(r.language);
        }
      }

      const categoriesMap = new Map();
      for (const r of (categoriesResult.results || [])) {
        if (!categoriesMap.has(r.content_item_id)) {
          categoriesMap.set(r.content_item_id, []);
        }
        categoriesMap.get(r.content_item_id).push({ id: r.id, name: r.name });
      }

      for (const r of (itemsResult.results || [])) {
        let levelStats = null;
        if (r.level_framework_stats) {
          try {
            levelStats = JSON.parse(r.level_framework_stats);
          } catch { }
        }

        let cover_url = null;
        if (r.cover_key) {
          cover_url = base ? `${base}/${r.cover_key}` : `/${r.cover_key}`;
        }

        let cover_landscape_url = null;
        if (r.cover_landscape_key) {
          cover_landscape_url = base ? `${base}/${r.cover_landscape_key}` : `/${r.cover_landscape_key}`;
        }

        const it = {
          id: r.id,
          title: r.title,
          main_language: r.main_language,
          type: r.type,
          release_year: r.release_year,
          description: r.description,
          episodes: r.episodes,
          is_original: r.is_original,
          level_framework_stats: levelStats,
          available_subs: langMap.get(r.internal_id) || [],
          cover_url,
          cover_landscape_url,
          is_available: r.is_available ?? 1,
          categories: categoriesMap.get(r.internal_id) || [],
        };
        map.set(r.id, it);
      }

      const out = Array.from(map.values());
      return json(out, {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=300'
        }
      });
    } catch (e) {
      return json([]);
    }
  });

  // POST /items/:slug/episodes/:episode/calc-stats
  router.post('/items/:slug/episodes/:episode/calc-stats', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    const episodeSlugRaw = decodeURIComponent(request.params.episode);
    try {
      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
      if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
      let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
      if (!epNum || Number.isNaN(epNum)) {
        const m = String(episodeSlugRaw).match(/_(\d+)$/);
        epNum = m ? Number(m[1]) : 1;
      }
      let episode;
      try {
        episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
      } catch (e) {
        try { episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch { }
      }
      if (!episode) return json({ error: 'Not found' }, { status: 404 });

      const epCountAvg = await env.DB.prepare('SELECT COUNT(*) AS c, AVG(difficulty_score) AS avg FROM cards WHERE episode_id=? AND difficulty_score IS NOT NULL').bind(episode.id).first();
      let epLevelRows = { results: [] };
      try {
        const sql = `SELECT cdl.framework,cdl.level,cdl.language
                     FROM card_difficulty_levels cdl
                     JOIN cards c ON cdl.card_id=c.id
                     WHERE c.episode_id=?`;
        epLevelRows = await env.DB.prepare(sql).bind(episode.id).all();
      } catch { }
      const epStatsJson = JSON.stringify(buildLevelStats(epLevelRows.results || []));
      const epNumCards = Number(epCountAvg?.c || 0);
      const epAvg = epCountAvg && epCountAvg.avg != null ? Number(epCountAvg.avg) : null;

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
      } catch { }
      const itemStatsJson = JSON.stringify(buildLevelStats(itemLevelRows.results || []));
      const itemNumCards = Number(itemCountAvg?.c || 0);
      const itemAvg = itemCountAvg && itemCountAvg.avg != null ? Number(itemCountAvg.avg) : null;

      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        try {
          await env.DB.prepare(`UPDATE episodes
                                SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
                                WHERE id=?`).bind(epNumCards, epAvg, epStatsJson, episode.id).run();
        } catch { }
        try {
          await env.DB.prepare(`UPDATE content_items
                                SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
                                WHERE id=?`).bind(itemNumCards, itemAvg, itemStatsJson, filmRow.id).run();
        } catch { }
        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }

      return json({ ok: true, episode: { num_cards: epNumCards, avg_difficulty_score: epAvg }, item: { num_cards: itemNumCards, avg_difficulty_score: itemAvg } });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // GET /items/:slug/episodes/:episode/cards
  router.get('/items/:slug/episodes/:episode/cards', async (request, env) => {
    const url = new URL(request.url);
    const filmSlug = decodeURIComponent(request.params.slug);
    const episodeSlug = decodeURIComponent(request.params.episode);
    const limitRaw = Number(url.searchParams.get('limit') || '50');
    const limit = Math.min(5000, Math.max(1, limitRaw));
    const startFromRaw = url.searchParams.get('start_from');
    const startFrom = startFromRaw != null ? Number(startFromRaw) : null;
    const userId = url.searchParams.get('exclude_saved_for_user');
    try {
      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) return json([]);
      let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
      if (!epNum || Number.isNaN(epNum)) {
        const m = String(episodeSlug).match(/_(\d+)$/);
        epNum = m ? Number(m[1]) : 1;
      }
      let ep;
      try {
        ep = await env.DB.prepare('SELECT id,slug,episode_number FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
      } catch (e) {
        try {
          ep = await env.DB.prepare('SELECT id,slug,episode_num AS episode_number FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
        } catch { }
      }
      if (!ep) {
        try {
          ep = await env.DB.prepare('SELECT id,slug,episode_number FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
        } catch (e) {
          try {
            ep = await env.DB.prepare('SELECT id,slug,episode_num AS episode_number FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
          } catch { }
        }
      }
      if (!ep) return json([]);
      let res;
      const excludeSavedCondition = userId ? `AND NOT EXISTS (
        SELECT 1 FROM user_card_states ucs
        WHERE ucs.user_id = ? AND ucs.card_id = c.id AND ucs.srs_state != 'none'
      )` : '';
      const excludeSavedBind = userId ? [userId] : [];

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
                       JOIN episodes e ON e.id = c.episode_id
                       JOIN content_items ci ON ci.id = e.content_item_id
                       WHERE c.episode_id=? 
                         AND c.start_time >= ?
                         AND c.is_available = 1
                         AND EXISTS (
                           SELECT 1 FROM card_subtitles cs
                           WHERE cs.card_id = c.id
                             AND cs.language = ci.main_language
                             AND cs.text IS NOT NULL
                             AND TRIM(cs.text) != ''
                         )
                         ${excludeSavedCondition}
                       ORDER BY c.start_time ASC, c.end_time ASC
                       LIMIT ?`;
          res = await env.DB.prepare(sql).bind(ep.id, Math.floor(startFrom), ...excludeSavedBind, limit).all();
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
                       JOIN episodes e ON e.id = c.episode_id
                       JOIN content_items ci ON ci.id = e.content_item_id
                       WHERE c.episode_id=?
                         AND c.is_available = 1
                         AND EXISTS (
                           SELECT 1 FROM card_subtitles cs
                           WHERE cs.card_id = c.id
                             AND cs.language = ci.main_language
                             AND cs.text IS NOT NULL
                             AND TRIM(cs.text) != ''
                         )
                         ${excludeSavedCondition}
                       ORDER BY c.start_time ASC, c.end_time ASC
                       LIMIT ?`;
          res = await env.DB.prepare(sql).bind(ep.id, ...excludeSavedBind, limit).all();
        }
      } catch (e) {
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
                             JOIN episodes e ON e.id = c.episode_id
                             JOIN content_items ci ON ci.id = e.content_item_id
                             WHERE c.episode_id=? 
                               AND c.start_time_ms >= ?
                               AND c.is_available = 1
                               AND EXISTS (
                                 SELECT 1 FROM card_subtitles cs
                                 WHERE cs.card_id = c.id
                                   AND cs.language = ci.main_language
                                   AND cs.text IS NOT NULL
                                   AND TRIM(cs.text) != ''
                               )
                               ${excludeSavedCondition}
                             ORDER BY c.start_time_ms ASC
                             LIMIT ?`;
          res = await env.DB.prepare(sqlLegacy).bind(ep.id, Math.floor(startFrom * 1000), ...excludeSavedBind, limit).all();
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
                             JOIN episodes e ON e.id = c.episode_id
                             JOIN content_items ci ON ci.id = e.content_item_id
                             WHERE c.episode_id=?
                               AND c.is_available = 1
                               AND EXISTS (
                                 SELECT 1 FROM card_subtitles cs
                                 WHERE cs.card_id = c.id
                                   AND cs.language = ci.main_language
                                   AND cs.text IS NOT NULL
                                   AND TRIM(cs.text) != ''
                               )
                               ${excludeSavedCondition}
                             ORDER BY c.start_time_ms ASC
                             LIMIT ?`;
          res = await env.DB.prepare(sqlLegacy).bind(ep.id, ...excludeSavedBind, limit).all();
        }
      }
      const rows = res.results || [];
      const cardIds = rows.map(r => r.internal_id);
      const subsMap = new Map();
      const levelsMap = new Map();
      if (cardIds.length > 0) {
        const batchSize = 50;
        const subtitleBatches = [];
        const levelsBatches = [];

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
              .catch(e => {
                console.error('[WORKER] Error fetching subtitles batch:', e);
              })
          );

          levelsBatches.push(
            env.DB.prepare(`SELECT card_id, framework, level, language FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...batch).all()
              .then(result => {
                (result.results || []).forEach(l => {
                  if (!levelsMap.has(l.card_id)) levelsMap.set(l.card_id, []);
                  levelsMap.get(l.card_id).push({
                    framework: l.framework || 'CEFR',
                    level: l.level,
                    language: l.language || null
                  });
                });
              })
              .catch(e => {
                console.error('[WORKER] Error fetching difficulty levels batch:', e);
              })
          );
        }

        try {
          await Promise.all([...subtitleBatches, ...levelsBatches]);
        } catch (e) {
          console.error('[WORKER] Error in batch fetch:', e);
        }
      }
      const out = [];
      for (const r of rows) {
        const subtitle = subsMap.get(r.internal_id) || {};
        const levels = levelsMap.get(r.internal_id) || [];
        const displayId = String(r.card_number ?? '').padStart(3, '0');
        const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
        const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
        const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
        const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
        const basePublic = (env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
        const imageUrl = r.image_key
          ? (basePublic ? `${basePublic}/${r.image_key}` : `/${r.image_key}`)
          : '';
        const audioUrl = r.audio_key
          ? (basePublic ? `${basePublic}/${r.audio_key}` : `/${r.audio_key}`)
          : '';
        out.push({ id: displayId, episode_id: outEpisodeId, start: startS, end: endS, duration: dur, image_url: imageUrl, audio_url: audioUrl, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, levels: levels, is_available: r.is_available, subtitle });
      }
      return json(out);
    } catch (e) {
      return json([]);
    }
  });

  // GET /items/:slug/episodes/:episode
  router.get('/items/:slug/episodes/:episode', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    const episodeSlugRaw = decodeURIComponent(request.params.episode);
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
        episode = await env.DB.prepare('SELECT id, title, slug, description, cover_key, is_available, num_cards, avg_difficulty_score, level_framework_stats FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
      } catch (e) {
        try {
          episode = await env.DB.prepare('SELECT id, title, slug, cover_key, is_available FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
        } catch { }
      }
      if (!episode) return json({ error: 'Not found' }, { status: 404 });
      const base = env.R2_PUBLIC_BASE || '';
      const padded = String(epNum).padStart(3, '0');
      const out = {
        episode_number: epNum,
        title: episode.title || null,
        slug: episode.slug || `${filmSlug}_${epNum}`,
        description: episode.description || null,
        cover_url: episode.cover_key ? (base ? `${base}/${episode.cover_key}` : `/${episode.cover_key}`) : null,
        display_id: `e${padded}`,
        num_cards: episode.num_cards ?? null,
        avg_difficulty_score: episode.avg_difficulty_score ?? null,
        level_framework_stats: episode.level_framework_stats ?? null,
        is_available: episode.is_available ?? 1,
      };
      return json(out);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // PATCH /items/:slug/episodes/:episode
  router.patch('/items/:slug/episodes/:episode', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    const episodeSlugRaw = decodeURIComponent(request.params.episode);
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
        episode = await env.DB.prepare('SELECT id, title, slug, description, cover_key, is_available, num_cards, avg_difficulty_score, level_framework_stats FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
      } catch (e) {
        try {
          episode = await env.DB.prepare('SELECT id, title, slug, cover_key, is_available FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
        } catch { }
      }
      if (!episode) return json({ error: 'Not found' }, { status: 404 });
      const body = await request.json().catch(() => ({}));
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
      if (coverKeyRaw && typeof coverKeyRaw === 'string' && coverKeyRaw.trim() !== '') {
        try {
          const contentInfo = await env.DB.prepare('SELECT ci.type FROM content_items ci JOIN episodes e ON ci.id = e.content_item_id WHERE e.id = ?').bind(episode.id).first();
          if (contentInfo && contentInfo.type === 'video') {
            const coverKey = String(coverKeyRaw).replace(/^https?:\/\/[^/]+\//, '');
            await env.DB.prepare('UPDATE cards SET image_key = ? WHERE episode_id = ?').bind(coverKey, episode.id).run();
          }
        } catch (e) {
          console.error('Failed to sync cards with cover_key:', e);
        }
      }
      return json({ ok: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // DELETE /items/:slug/episodes/:episode
  router.delete('/items/:slug/episodes/:episode', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    const episodeSlugRaw = decodeURIComponent(request.params.episode);
    try {
      const filmRow = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
      let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
      if (!epNum || Number.isNaN(epNum)) {
        const m = String(episodeSlugRaw).match(/_(\d+)$/);
        epNum = m ? Number(m[1]) : 1;
      }
      let episode;
      try {
        episode = await env.DB.prepare('SELECT id, episode_number, slug, cover_key FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
      } catch (e) {
        try { episode = await env.DB.prepare('SELECT id, episode_num AS episode_number, slug, cover_key FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch { }
      }
      if (!episode) return json({ error: 'Not found' }, { status: 404 });
      const epId = episode.id;
      try {
        let minRow;
        try {
          minRow = await env.DB.prepare('SELECT MIN(episode_number) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first();
        } catch (e) {
          try { minRow = await env.DB.prepare('SELECT MIN(episode_num) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first(); } catch { }
        }
        const minEp = minRow ? Number(minRow.mn) : 1;
        if (epNum === minEp) {
          return json({ error: 'Cannot delete the first episode' }, { status: 400 });
        }
      } catch { }
      const mediaKeys = new Set();
      const mediaErrors = [];
      const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
      if (episode.cover_key) mediaKeys.add(normalizeKey(episode.cover_key));
      const epPadded = String(epNum).padStart(3, '0');
      const epFolderLegacy = `${filmRow.slug}_${epNum}`;
      const epFolderPadded = `${filmRow.slug}_${epPadded}`;
      mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
      mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
      let cardsRows = { results: [] };
      try {
        cardsRows = await env.DB.prepare('SELECT id, image_key, audio_key FROM cards WHERE episode_id=?').bind(epId).all();
      } catch { }
      const cardIds = [];
      for (const c of (cardsRows.results || [])) {
        cardIds.push(c.id);
        if (c.image_key) mediaKeys.add(normalizeKey(c.image_key));
        if (c.audio_key) mediaKeys.add(normalizeKey(c.audio_key));
      }
      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        if (cardIds.length) {
          const ph = cardIds.map(() => '?').join(',');
          try { await env.DB.prepare(`DELETE FROM card_subtitles WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch { }
          try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch { }
          try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch { }
          updateCardSubtitleLanguageMapBatch(env, cardIds).catch(err => {
            console.error('[delete cards] Failed to update summary table:', err.message);
          });
          try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch { }
        } else {
          try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch { }
        }
        try { await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(epId).run(); } catch { }
        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }
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
  });

  // GET /items/:slug/episodes
  router.get('/items/:slug/episodes', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    try {
      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
      if (!filmRow) return json([]);
      let rows;
      try {
        rows = await env.DB.prepare('SELECT episode_number,title,slug,description,cover_key,is_available,num_cards FROM episodes WHERE content_item_id=? ORDER BY episode_number ASC').bind(filmRow.id).all();
      } catch (e) {
        try {
          rows = await env.DB.prepare('SELECT episode_num AS episode_number,title,slug,cover_key,is_available FROM episodes WHERE content_item_id=? ORDER BY episode_num ASC').bind(filmRow.id).all();
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
        is_available: r.is_available ?? 1,
        num_cards: typeof r.num_cards === 'number' ? r.num_cards : Number(r.num_cards ?? 0),
      }));
      return json(out);
    } catch (e) {
      return json([]);
    }
  });

  // GET /items/:slug/cards
  router.get('/items/:slug/cards', async (request, env) => {
    const url = new URL(request.url);
    const filmSlug = request.params.slug;
    const limitRaw = Number(url.searchParams.get('limit') || '50');
    const limit = Math.min(5000, Math.max(1, limitRaw));
    try {
      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) return json([]);
      let res;
      try {
        const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                   FROM cards c 
                   JOIN episodes e ON c.episode_id=e.id
                   JOIN content_items ci ON ci.id = e.content_item_id
                   WHERE e.content_item_id=?
                     AND c.is_available = 1
                     AND EXISTS (
                       SELECT 1 FROM card_subtitles cs
                       WHERE cs.card_id = c.id
                         AND cs.language = ci.main_language
                         AND cs.text IS NOT NULL
                         AND TRIM(cs.text) != ''
                     )
                   ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
        res = await env.DB.prepare(sql).bind(filmRow.id, limit).all();
      } catch (e) {
        try {
          const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                   FROM cards c 
                   JOIN episodes e ON c.episode_id=e.id
                   JOIN content_items ci ON ci.id = e.content_item_id
                   WHERE e.content_item_id=?
                     AND c.is_available = 1
                     AND EXISTS (
                       SELECT 1 FROM card_subtitles cs
                       WHERE cs.card_id = c.id
                         AND cs.language = ci.main_language
                         AND cs.text IS NOT NULL
                         AND TRIM(cs.text) != ''
                     )
                   ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
          res = await env.DB.prepare(sql2).bind(filmRow.id, limit).all();
        } catch (e2) {
          const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                   FROM cards c 
                   JOIN episodes e ON c.episode_id=e.id
                   JOIN content_items ci ON ci.id = e.content_item_id
                   WHERE e.content_item_id=?
                     AND c.is_available = 1
                     AND EXISTS (
                       SELECT 1 FROM card_subtitles cs
                       WHERE cs.card_id = c.id
                         AND cs.language = ci.main_language
                         AND cs.text IS NOT NULL
                         AND TRIM(cs.text) != ''
                     )
                   ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
          try {
            res = await env.DB.prepare(sql3).bind(filmRow.id, limit).all();
          } catch {
            res = { results: [] };
          }
        }
      }
      const rows = res.results || [];
      const cardIds = rows.map(r => r.internal_id);
      const subsMap = new Map();
      const cefrMap = new Map();
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
              .catch(e => console.error('[WORKER /items/cards] Error fetching subtitles batch:', e))
          );

          cefrBatches.push(
            env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${ph}) AND framework='CEFR'`).bind(...batch).all()
              .then(result => {
                (result.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              })
              .catch(e => console.error('[WORKER /items/cards] Error fetching CEFR levels batch:', e))
          );
        }

        try {
          await Promise.all([...subtitleBatches, ...cefrBatches]);
        } catch (e) {
          console.error('[WORKER /items/cards] Error in batch fetch:', e);
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
  });

  // GET /items/:slug/categories
  router.get('/items/:slug/categories', async (request, env) => {
    try {
      const filmSlug = request.params.slug;
      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) {
        return json({ error: 'Content item not found' }, { status: 404 });
      }
      const categories = await env.DB.prepare(`
        SELECT c.id, c.name, c.created_at, c.updated_at 
        FROM categories c
        INNER JOIN content_item_categories cic ON c.id = cic.category_id
        WHERE cic.content_item_id = ?
        ORDER BY c.name ASC
      `).bind(filmRow.id).all();
      return json({ categories: categories.results || [] });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // GET /items/:slug
  router.get('/items/:slug', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    try {
      let film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images,imdb_score FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
      if (!film) {
        film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images,imdb_score FROM content_items WHERE id=?').bind(filmSlug).first();
      }
      if (!film) return new Response('Not found', { status: 404 });
      let langs = { results: [] };
      let episodes = 0;
      try {
        langs = await env.DB.prepare('SELECT language FROM content_item_languages WHERE content_item_id=?').bind(film.id).all();
      } catch { }
      try {
        const epCountRow = await env.DB.prepare('SELECT COUNT(*) as cnt FROM episodes WHERE content_item_id=?').bind(film.id).first();
        episodes = epCountRow ? epCountRow.cnt : 0;
      } catch { }
      let cover_url = null;
      let cover_landscape_url = null;
      if (film.cover_key) {
        const base = env.R2_PUBLIC_BASE || '';
        cover_url = base ? `${base}/${film.cover_key}` : `/${film.cover_key}`;
      } else {
        const preferredKey = `items/${film.slug}/cover_image/cover.jpg`;
        const newDefaultKey = `items/${film.slug}/episodes/e1/cover.jpg`;
        const oldDefaultKey = `films/${film.slug}/episodes/e1/cover.jpg`;
        try {
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
            const base = env.R2_PUBLIC_BASE || '';
            cover_url = base ? `${base}/${preferredKey}` : `/${preferredKey}`;
          }
        } catch {
        }
      }
      if (film.cover_landscape_key) {
        const base = env.R2_PUBLIC_BASE || '';
        cover_landscape_url = base ? `${base}/${film.cover_landscape_key}` : `/${film.cover_landscape_key}`;
      }
      const episodesMetaRaw = (film.total_episodes != null ? Number(film.total_episodes) : null);
      const episodesMeta = (Number.isFinite(episodesMetaRaw) && episodesMetaRaw > 0) ? episodesMetaRaw : null;
      const episodesOut = episodesMeta !== null ? episodesMeta : episodes;
      const isOriginal = (film.is_original == null) ? 1 : film.is_original;

      let levelStats = null;
      if (film.level_framework_stats) {
        try {
          levelStats = JSON.parse(film.level_framework_stats);
        } catch { }
      }

      let categories = [];
      try {
        const catRows = await env.DB.prepare(`
          SELECT c.id, c.name 
          FROM categories c
          INNER JOIN content_item_categories cic ON c.id = cic.category_id
          WHERE cic.content_item_id = ?
          ORDER BY c.name ASC
        `).bind(film.id).all();
        categories = (catRows.results || []).map(c => ({ id: c.id, name: c.name }));
      } catch { }

      return json({ id: film.slug, title: film.title, main_language: film.main_language, type: film.type, release_year: film.release_year, description: film.description, available_subs: (langs.results || []).map(r => r.language), episodes: episodesOut, total_episodes: episodesMeta !== null ? episodesMeta : episodesOut, cover_url, cover_landscape_url, is_original: !!Number(isOriginal), num_cards: film.num_cards ?? null, avg_difficulty_score: film.avg_difficulty_score ?? null, level_framework_stats: levelStats, is_available: film.is_available ?? 1, video_has_images: film.video_has_images === 1 || film.video_has_images === true, imdb_score: film.imdb_score ?? null, categories });
    } catch (e) {
      return new Response('Not found', { status: 404 });
    }
  });

  // PATCH /items/:slug
  router.patch('/items/:slug', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    try {
      const body = await request.json().catch(() => ({}));
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

      if (has('type')) {
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

      if (has('is_original')) {
        const raw = body.is_original;
        let val = null;
        if (raw === null) {
          val = null;
        } else if (typeof raw === 'boolean') {
          val = raw ? 1 : 0;
        } else if (raw !== '' && raw != null) {
          val = Number(raw) ? 1 : 0;
        }
        if (val !== null) { setClauses.push('is_original=?'); values.push(val); }
      }

      if (has('video_has_images')) {
        const raw = body.video_has_images;
        let val = null;
        if (raw === null) {
          val = null;
        } else if (typeof raw === 'boolean') {
          val = raw ? 1 : 0;
        } else if (raw !== '' && raw != null) {
          val = Number(raw) ? 1 : 0;
        }
        if (val !== null) { setClauses.push('video_has_images=?'); values.push(val); }
      }

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

      if (has('imdb_score')) {
        let imdbScore = null;
        if (body.imdb_score !== null && body.imdb_score !== '' && body.imdb_score !== undefined) {
          const n = Number(body.imdb_score);
          imdbScore = Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
        }
        setClauses.push('imdb_score=?'); values.push(imdbScore);
      }

      if (!setClauses.length) {
        return json({ ok: true, note: 'No fields to update' });
      }

      const existing = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
      if (!existing) return json({ error: 'Not found' }, { status: 404 });

      const sql = `UPDATE content_items SET ${setClauses.join(', ')}, updated_at=strftime('%s','now') WHERE id=?`;
      values.push(existing.id);
      await env.DB.prepare(sql).bind(...values).run();

      if (has('category_ids')) {
        const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
        if (filmRow) {
          await env.DB.prepare('DELETE FROM content_item_categories WHERE content_item_id=?').bind(filmRow.id).run();

          if (Array.isArray(body.category_ids) && body.category_ids.length) {
            try {
              const categoryStmts = [];
              for (const catNameOrId of body.category_ids) {
                const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
                if (isUUID) {
                  const existing = await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(catNameOrId).first();
                  if (!existing) continue;
                } else {
                  const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
                  if (!existing) {
                    const catUuid = crypto.randomUUID();
                    await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catNameOrId).run();
                    categoryStmts.push(env.DB.prepare('INSERT INTO content_item_categories (content_item_id, category_id) VALUES (?, ?)').bind(filmRow.id, catUuid));
                  } else {
                    categoryStmts.push(env.DB.prepare('INSERT INTO content_item_categories (content_item_id, category_id) VALUES (?, ?)').bind(filmRow.id, existing.id));
                  }
                }
              }
              const assignStmts = [];
              for (const catNameOrId of body.category_ids) {
                const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
                let catId;
                if (isUUID) {
                  catId = catNameOrId;
                } else {
                  const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
                  if (existing) {
                    catId = existing.id;
                  } else {
                    const catUuid = crypto.randomUUID();
                    await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catNameOrId).run();
                    catId = catUuid;
                  }
                }
                if (catId) {
                  assignStmts.push(env.DB.prepare('INSERT OR IGNORE INTO content_item_categories (content_item_id, category_id) VALUES (?,?)').bind(filmRow.id, catId));
                }
              }
              if (assignStmts.length) await env.DB.batch(assignStmts);
            } catch (e) {
              console.error('Failed to handle categories:', e);
            }
          }
        }
      }

      return json({ ok: true, updated_fields: setClauses.length });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // DELETE /items/:slug
  router.delete('/items/:slug', async (request, env) => {
    const filmSlug = decodeURIComponent(request.params.slug);
    try {
      const filmRow = await env.DB.prepare('SELECT id, slug, cover_key FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
      if (!filmRow) return json({ error: 'Not found' }, { status: 404 });

      const mediaKeys = new Set();
      const mediaErrors = [];
      const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);

      if (filmRow.cover_key) mediaKeys.add(normalizeKey(filmRow.cover_key));
      mediaKeys.add(`items/${filmRow.slug}/cover_image/cover.jpg`);
      mediaKeys.add(`items/${filmRow.slug}/cover_image/cover_landscape.jpg`);
      mediaKeys.add(`items/${filmRow.slug}/full/audio.mp3`);
      mediaKeys.add(`items/${filmRow.slug}/full/video.mp4`);

      const episodeRows = await env.DB.prepare('SELECT id, episode_number, cover_key FROM episodes WHERE content_item_id=?').bind(filmRow.id).all().catch(() => ({ results: [] }));
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
        const epFolderPadded = `${filmRow.slug}_${String(epNum).padStart(3, '0')}`;
        if (ep.cover_key) mediaKeys.add(normalizeKey(ep.cover_key));
        mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
        mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover_landscape.jpg`);
        mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
        mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover_landscape.jpg`);
      }
      for (const c of cardsResults) {
        if (c.image_key) mediaKeys.add(normalizeKey(c.image_key));
        if (c.audio_key) mediaKeys.add(normalizeKey(c.audio_key));
      }

      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        try { await env.DB.prepare(`
          DELETE FROM card_subtitles 
          WHERE card_id IN (
            SELECT c.id FROM cards c
            INNER JOIN episodes e ON e.id = c.episode_id
            WHERE e.content_item_id = ?
          )
        `).bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare(`
          DELETE FROM card_subtitles_fts 
          WHERE card_id IN (
            SELECT c.id FROM cards c
            INNER JOIN episodes e ON e.id = c.episode_id
            WHERE e.content_item_id = ?
          )
        `).bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare(`
          DELETE FROM card_difficulty_levels 
          WHERE card_id IN (
            SELECT c.id FROM cards c
            INNER JOIN episodes e ON e.id = c.episode_id
            WHERE e.content_item_id = ?
          )
        `).bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare(`
          DELETE FROM card_subtitle_language_map 
          WHERE card_id IN (
            SELECT c.id FROM cards c
            INNER JOIN episodes e ON e.id = c.episode_id
            WHERE e.content_item_id = ?
          )
        `).bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare(`
          DELETE FROM cards 
          WHERE episode_id IN (
            SELECT id FROM episodes WHERE content_item_id = ?
          )
        `).bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare('DELETE FROM episodes WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare('DELETE FROM content_item_languages WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }

        try { await env.DB.prepare('DELETE FROM content_item_categories WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }

        await env.DB.prepare('DELETE FROM content_items WHERE id = ?').bind(filmRow.id).run();

        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }

      let mediaDeletedCount = 0;
      if (env.MEDIA_BUCKET && mediaKeys.size) {
        const keys = Array.from(mediaKeys).filter(Boolean);
        const concurrency = 40;
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
  });
}
