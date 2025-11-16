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

function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: withCors({ 'Content-Type': 'application/json', ...(init.headers || {}) }) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: withCors() });
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

      // 2) PUT upload proxy: actually store into R2
      if (path === '/r2/upload' && request.method === 'PUT') {
        const key = url.searchParams.get('key');
        const ct = url.searchParams.get('ct') || 'application/octet-stream';
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        await env.MEDIA_BUCKET.put(key, request.body, { httpMetadata: { contentType: ct } });
        return json({ ok: true, key });
      }

      // 3) Content items list (generic across films, music, books)
      if (path === '/items' && request.method === 'GET') {
        try {
          const res = await env.DB.prepare('SELECT slug as id,title,main_language,type,release_year,description,total_episodes as episodes,is_original FROM content_items').all();
          return json(res.results || []);
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
          let film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,total_episodes,is_original,num_cards,avg_difficulty_score,level_framework_stats FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!film) {
            // Fallback: allow direct UUID id lookup in case caller still uses internal id
            film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,total_episodes,is_original,num_cards,avg_difficulty_score,level_framework_stats FROM content_items WHERE id=?').bind(filmSlug).first();
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
          const episodesMetaRaw = (film.total_episodes != null ? Number(film.total_episodes) : null);
          const episodesMeta = (Number.isFinite(episodesMetaRaw) && episodesMetaRaw > 0) ? episodesMetaRaw : null;
          const episodesOut = episodesMeta !== null ? episodesMeta : episodes;
          const isOriginal = (film.is_original == null) ? 1 : film.is_original; // default true when absent
          return json({ id: film.slug, title: film.title, main_language: film.main_language, type: film.type, release_year: film.release_year, description: film.description, available_subs: (langs.results || []).map(r => r.language), episodes: episodesOut, total_episodes: episodesMeta !== null ? episodesMeta : episodesOut, cover_url, is_original: !!Number(isOriginal), num_cards: film.num_cards ?? null, avg_difficulty_score: film.avg_difficulty_score ?? null, level_framework_stats: film.level_framework_stats ?? null });
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
            rows = await env.DB.prepare('SELECT episode_number,title,slug,cover_key,full_audio_key,full_video_key FROM episodes WHERE content_item_id=? ORDER BY episode_number ASC').bind(filmRow.id).all();
          } catch (e) {
            // Backward compatibility: older column name episode_num
            try {
              rows = await env.DB.prepare('SELECT episode_num AS episode_number,title,slug,cover_key,full_audio_key,full_video_key FROM episodes WHERE content_item_id=? ORDER BY episode_num ASC').bind(filmRow.id).all();
            } catch (e2) {
              rows = { results: [] };
            }
          }
          const base = env.R2_PUBLIC_BASE || '';
          const out = (rows.results || []).map(r => ({
            episode_number: r.episode_number,
            title: r.title || null,
            slug: r.slug || `${filmSlug}_${r.episode_number}`,
            cover_url: r.cover_key ? (base ? `${base}/${r.cover_key}` : `/${r.cover_key}`) : null,
            full_audio_url: r.full_audio_key ? (base ? `${base}/${r.full_audio_key}` : `/${r.full_audio_key}`) : null,
            full_video_url: r.full_video_key ? (base ? `${base}/${r.full_video_key}` : `/${r.full_video_key}`) : null,
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
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/audio.mp3`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/full/video.mp4`);
            // New padded variants
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
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
          let mediaDeletedCount = 0;
            if (env.MEDIA_BUCKET) {
              for (const key of mediaKeys) {
                if (!key) continue;
                try {
                  await env.MEDIA_BUCKET.delete(key);
                  mediaDeletedCount += 1;
                } catch (err) {
                  mediaErrors.push(`fail:${key}`);
                }
              }
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
            episode = await env.DB.prepare('SELECT id, title, slug, cover_key, full_audio_key, full_video_key, num_cards, avg_difficulty_score, level_framework_stats FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            // Fallback older schema
            try {
              episode = await env.DB.prepare('SELECT id, title, slug, cover_key, full_audio_key, full_video_key FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
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
              cover_url: episode.cover_key ? (base ? `${base}/${episode.cover_key}` : `/${episode.cover_key}`) : null,
              full_audio_url: episode.full_audio_key ? (base ? `${base}/${episode.full_audio_key}` : `/${episode.full_audio_key}`) : null,
              full_video_url: episode.full_video_key ? (base ? `${base}/${episode.full_video_key}` : `/${episode.full_video_key}`) : null,
              display_id: `e${padded}`,
              num_cards: episode.num_cards ?? null,
              avg_difficulty_score: episode.avg_difficulty_score ?? null,
              level_framework_stats: episode.level_framework_stats ?? null,
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
  const filmSlug = filmCardsMatch[1];
  const episodeSlug = filmCardsMatch[2];
        const limit = Number(url.searchParams.get('limit') || '50');
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
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.id as internal_id FROM cards c WHERE c.episode_id=? ORDER BY c.card_number ASC, c.start_time ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(ep.id, limit).all();
          } catch (e) {
            // Backward compatibility: legacy ms columns
            const sqlLegacy = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.id as internal_id FROM cards c WHERE c.episode_id=? ORDER BY c.card_number ASC, c.start_time_ms ASC LIMIT ?`;
            res = await env.DB.prepare(sqlLegacy).bind(ep.id, limit).all();
          }
          const rows = res.results || [];
          const out = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.internal_id).all();
            const subtitle = {};
            (subs.results || []).forEach(s => { subtitle[s.language] = s.text; });
            // Fetch CEFR level for compatibility output
            let cefr = null;
            try {
              const lvl = await env.DB.prepare('SELECT level FROM card_difficulty_levels WHERE card_id=? AND framework=?').bind(r.internal_id, 'CEFR').first();
              cefr = lvl ? lvl.level : null;
            } catch {}
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode_id: outEpisodeId, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 5b) Cards for a given item across all parts (optional episode filter omitted)
  const filmAllCardsMatch = path.match(/^\/items\/([^/]+)\/cards$/);
      if (filmAllCardsMatch && request.method === 'GET') {
        const filmSlug = filmAllCardsMatch[1];
        const limit = Number(url.searchParams.get('limit') || '50');
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json([]);
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(filmRow.id, limit).all();
          } catch (e) {
            // Fallback older schema (episode_num)
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(filmRow.id, limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.episode_number,e.slug as episode_slug,c.id as internal_id
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
            const episodeSlug = r.episode_slug || `${filmSlug}_${Number(r.episode_number) || 1}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode_id: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 6) Global cards (return film slug, display id, and episode slug e{N} instead of UUID)
  if (path === '/cards' && request.method === 'GET') {
        const limit = Number(url.searchParams.get('limit') || '100');
        try {
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(limit).all();
          } catch (e) {
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.content_item_id as film_id,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
              try { res = await env.DB.prepare(sql3).bind(limit).all(); }
              catch { res = { results: [] }; }
            }
          }
          const rows = res.results || [];
          const out = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.internal_id).all();
            const subtitle = {};
            (subs.results || []).forEach(s => { subtitle[s.language] = s.text; });
            const film = await env.DB.prepare('SELECT slug FROM content_items WHERE id=?').bind(r.film_id).first();
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${film?.slug || 'item'}_${Number(r.episode_number) || 1}`;
            let cefr = null;
            try {
              const lvl = await env.DB.prepare('SELECT level FROM card_difficulty_levels WHERE card_id=? AND framework=?').bind(r.internal_id, 'CEFR').first();
              cefr = lvl ? lvl.level : null;
            } catch {}
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, film_id: film?.slug, subtitle });
          }
          return json(out);
        } catch { return json([]); }
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
          let row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
          if (!row) {
            // Legacy fallback
            row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
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
          return json({ id: displayId, episode_id: outEpisodeId, episode_display: displayPadded, film_id: filmSlug, start: startS, end: endS, duration: dur, image_key: row.image_key, audio_key: row.audio_key, sentence: row.sentence, card_type: row.card_type, length: row.length, difficulty_score: row.difficulty_score, cefr_level: cefr, subtitle });
        } catch { return new Response('Not found', { status: 404, headers: withCors() }); }
      }

      // 8) Import bulk (server generates UUIDs; client provides slug and numbers)
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
          if (Array.isArray(film.available_subs)) {
            for (const lang of film.available_subs) {
              await env.DB.prepare('INSERT OR IGNORE INTO content_item_languages (content_item_id,language) VALUES (?,?)').bind(filmRow.id, lang).run();
            }
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
            // Insert with slug column if available; fallback without slug on older schema
            try {
              await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_number,title,slug) VALUES (?,?,?,?,?)').bind(
                epUuid,
                filmRow.id,
                episodeNumber,
                `e${episodeNumber}`,
                `${filmSlug}_${episodeNumber}`
              ).run();
            } catch (e) {
              // Fallback older schema with episode_num
              try {
                await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_num,title,slug) VALUES (?,?,?,?,?)').bind(
                  epUuid,
                  filmRow.id,
                  episodeNumber,
                  `e${episodeNumber}`,
                  `${filmSlug}_${episodeNumber}`
                ).run();
              } catch (e2) {
                await env.DB.prepare('INSERT INTO episodes (id,content_item_id,episode_num,title) VALUES (?,?,?,?)').bind(
                  epUuid,
                  filmRow.id,
                  episodeNumber,
                  `e${episodeNumber}`
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
              const existing = await env.DB.prepare('SELECT id FROM cards WHERE episode_id=?').bind(episode.id).all();
              for (const row of existing.results || []) {
                await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run();
              }
              await env.DB.prepare('DELETE FROM cards WHERE episode_id=?').bind(episode.id).run();
            } catch (e) {
              // Non-fatal; continue even if cleanup fails
            }
          }
          for (const c of cards) {
            const cardUuid = crypto.randomUUID();
            const cardNum = c.card_number != null ? Number(c.card_number) : (c.id ? Number(String(c.id).replace(/^0+/, '')) : null);
            // Derive difficulty_score; if legacy 'difficulty' 1-5 provided, scale to 0-100; if >5 treat as already percent
            let diffScoreVal = null;
            if (typeof c.difficulty_score === 'number') {
              diffScoreVal = c.difficulty_score;
            } else if (typeof c.difficulty === 'number') {
              diffScoreVal = c.difficulty <= 5 ? (c.difficulty / 5) * 100 : c.difficulty;
            }
            const sStart = Math.max(0, Math.round(Number(c.start || 0)));
            const sEnd = Math.max(0, Math.round(Number(c.end || 0)));
            const dur = Math.max(0, sEnd - sStart);
            try {
              await env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time,end_time,duration,image_key,audio_key,sentence,card_type,length,difficulty_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(
                cardUuid,
                episode.id,
                cardNum,
                sStart,
                sEnd,
                dur,
                c.image_url ? String(c.image_url).replace(/^https?:\/\/[^/]+\//, '') : null,
                c.audio_url ? String(c.audio_url).replace(/^https?:\/\/[^/]+\//, '') : null,
                c.sentence || null,
                c.type || c.card_type || null,
                (typeof c.length === 'number' ? Math.floor(c.length) : null),
                (typeof diffScoreVal === 'number' ? diffScoreVal : null)
              ).run();
            } catch (e) {
              // Legacy fallback: old ms schema
              await env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time_ms,end_time_ms,image_key,audio_key,sentence,card_type,length,difficulty_score) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(
                cardUuid,
                episode.id,
                cardNum,
                sStart * 1000,
                sEnd * 1000,
                c.image_url ? String(c.image_url).replace(/^https?:\/\/[^/]+\//, '') : null,
                c.audio_url ? String(c.audio_url).replace(/^https?:\/\/[^/]+\//, '') : null,
                c.sentence || null,
                c.type || c.card_type || null,
                (typeof c.length === 'number' ? Math.floor(c.length) : null),
                (typeof diffScoreVal === 'number' ? diffScoreVal : null)
              ).run();
            }
            if (c.subtitle) {
              for (const [lang, text] of Object.entries(c.subtitle)) {
                if (!text) continue;
                await env.DB.prepare('INSERT OR IGNORE INTO card_subtitles (card_id,language,text) VALUES (?,?,?)').bind(cardUuid, lang, text).run();
              }
            }
            // Insert difficulty frameworks if provided
            if (Array.isArray(c.difficulty_levels)) {
              for (const d of c.difficulty_levels) {
                if (!d || !d.framework || !d.level) continue;
                const lang = d.language || null;
                await env.DB.prepare('INSERT OR REPLACE INTO card_difficulty_levels (card_id,framework,level,language) VALUES (?,?,?,?)').bind(cardUuid, String(d.framework), String(d.level), lang).run();
              }
            } else if (c.CEFR_Level) {
              // Back-compat: accept CEFR_Level string
              await env.DB.prepare('INSERT OR REPLACE INTO card_difficulty_levels (card_id,framework,level,language) VALUES (?,?,?,?)').bind(cardUuid, 'CEFR', String(c.CEFR_Level), 'en').run();
            }
          }
          return json({ ok: true, inserted: cards.length, mode });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      return new Response('Not found', { status: 404, headers: withCors() });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  }
};
