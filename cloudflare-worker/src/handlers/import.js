import { json } from '../utils/response.js';
import { expandJaIndexText } from '../utils/japanese.js';
import { updateCardSubtitleLanguageMapBatch } from '../services/cardHelpers.js';

export function registerImportRoutes(router) {

  // POST /import
  router.post('/import', async (request, env) => {
    const body = await request.json();
    const film = body.film || {};
    const cards = body.cards || [];
    const episodeNumber = Number(body.episodeNumber ?? String(body.episodeId || '').replace(/^e/i, '')) || 1;
    const filmSlug = film.slug || film.id;
    if (!filmSlug) return json({ error: 'Missing film.slug' }, { status: 400 });
    const mode = body.mode === 'replace' ? 'replace' : 'append';
    try {
      let filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
      if (!filmRow) {
        const uuid = crypto.randomUUID();
        const coverKey = (film.cover_key || film.cover_url) ? String((film.cover_key || film.cover_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
        const coverLandscapeKey = (film.cover_landscape_key || film.cover_landscape_url) ? String((film.cover_landscape_key || film.cover_landscape_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
        const totalEpisodesIns = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : 1;
        const imdbScore = (film.imdb_score != null && film.imdb_score !== '') ? Number(film.imdb_score) : null;
        await env.DB.prepare('INSERT INTO content_items (id,slug,title,main_language,type,description,cover_key,cover_landscape_key,release_year,total_episodes,is_original,imdb_score) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)').bind(
          uuid,
          filmSlug,
          film.title || filmSlug,
          film.language || film.main_language || 'en',
          film.type || 'movie',
          film.description || '',
          coverKey,
          coverLandscapeKey,
          film.release_year || null,
          totalEpisodesIns,
          (film.is_original === false ? 0 : 1),
          imdbScore
        ).run();
        filmRow = { id: uuid };
      } else {
        const coverKey = (film.cover_key || film.cover_url) ? String((film.cover_key || film.cover_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
        const coverLandscapeKey = (film.cover_landscape_key || film.cover_landscape_url) ? String((film.cover_landscape_key || film.cover_landscape_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
        const totalEpisodes = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : null;
        const imdbScore = (film.imdb_score != null && film.imdb_score !== '') ? Number(film.imdb_score) : null;
        await env.DB.prepare('UPDATE content_items SET title=COALESCE(?,title), main_language=COALESCE(?,main_language), type=COALESCE(?,type), description=COALESCE(?,description), cover_key=COALESCE(?,cover_key), cover_landscape_key=COALESCE(?,cover_landscape_key), release_year=COALESCE(?,release_year), total_episodes=COALESCE(?,total_episodes), is_original=COALESCE(?,is_original), imdb_score=COALESCE(?,imdb_score) WHERE id=?').bind(
          film.title || null,
          film.language || film.main_language || null,
          film.type || null,
          film.description || null,
          coverKey,
          coverLandscapeKey,
          film.release_year || null,
          totalEpisodes,
          (typeof film.is_original === 'boolean' ? (film.is_original ? 1 : 0) : null),
          imdbScore,
          filmRow.id
        ).run();
      }
      if (Array.isArray(film.available_subs) && film.available_subs.length) {
        const subLangStmts = film.available_subs.map((lang) => env.DB.prepare('INSERT OR IGNORE INTO content_item_languages (content_item_id,language) VALUES (?,?)').bind(filmRow.id, lang));
        try { await env.DB.batch(subLangStmts); } catch { }
      }
      if (Array.isArray(film.category_ids) && film.category_ids.length) {
        try {
          const categoryStmts = [];
          for (const catNameOrId of film.category_ids) {
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
            if (isUUID) {
              const existing = await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(catNameOrId).first();
              if (!existing) continue;
            } else {
              const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
              if (!existing) {
                const catUuid = crypto.randomUUID();
                categoryStmts.push(env.DB.prepare('INSERT INTO categories (id,name) VALUES (?,?)').bind(catUuid, catNameOrId));
              }
            }
          }
          if (categoryStmts.length) await env.DB.batch(categoryStmts);

          const assignStmts = [];
          for (const catNameOrId of film.category_ids) {
            const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
            let catId;
            if (isUUID) {
              catId = catNameOrId;
            } else {
              const catRow = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
              if (catRow) catId = catRow.id;
            }
            if (catId) {
              assignStmts.push(env.DB.prepare('INSERT OR IGNORE INTO content_item_categories (content_item_id,category_id) VALUES (?,?)').bind(filmRow.id, catId));
            }
          }
          if (assignStmts.length) await env.DB.batch(assignStmts);
        } catch (e) {
          console.error('Failed to handle categories:', e);
        }
      }
      let episode;
      try {
        episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, episodeNumber).first();
      } catch (e) {
        try { episode = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, episodeNumber).first(); } catch { }
      }
      if (!episode) {
        const epUuid = crypto.randomUUID();
        const epPadded = String(episodeNumber).padStart(3, '0');
        const episodeTitle = (film.episode_title && String(film.episode_title).trim()) ? String(film.episode_title).trim() : `e${epPadded}`;
        const episodeDescription = (film.episode_description && String(film.episode_description).trim()) ? String(film.episode_description).trim() : null;
        const episodeSlug = `${filmSlug}_${epPadded}`;
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
      try {
        let maxRow;
        try {
          maxRow = await env.DB.prepare('SELECT IFNULL(MAX(episode_number),0) as mx FROM episodes WHERE content_item_id=?').bind(filmRow.id).first();
        } catch (e) {
          try { maxRow = await env.DB.prepare('SELECT IFNULL(MAX(episode_num),0) as mx FROM episodes WHERE content_item_id=?').bind(filmRow.id).first(); } catch { }
        }
        const maxUploaded = maxRow ? Number(maxRow.mx) : 0;
        const totalEpisodes = Number(film.total_episodes || 0);
        if (totalEpisodes && totalEpisodes < maxUploaded) {
          return json({ error: `Total Episodes (${totalEpisodes}) cannot be less than highest uploaded episode (${maxUploaded}).` }, { status: 400 });
        }
      } catch { }
      if (mode === 'replace') {
        try {
          await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
        } catch { }
        try {
          await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
        } catch { }
        try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run(); } catch { }
        try { await env.DB.prepare('DELETE FROM cards WHERE episode_id=?').bind(episode.id).run(); } catch { }
      }

      async function runStmtBatches(stmts, size = 200) {
        for (let i = 0; i < stmts.length; i += size) {
          const slice = stmts.slice(i, i + size);
          if (slice.length) await env.DB.batch(slice);
        }
      }

      const cardsNewSchema = [];
      const cardsLegacySchema = [];
      const subStmts = [];
      const ftsStmts = [];
      const diffStmts = [];
      const cardIdsForSummaryUpdate = new Set();

      const normalizeKey = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+\//, '') : null);

      let contentType = null;
      let episodeCoverKey = null;
      try {
        const contentInfo = await env.DB.prepare('SELECT ci.type, e.cover_key FROM content_items ci JOIN episodes e ON ci.id = e.content_item_id WHERE e.id = ?').bind(episode.id).first();
        if (contentInfo) {
          contentType = contentInfo.type;
          episodeCoverKey = contentInfo.cover_key || null;
        }
      } catch (e) {
        try {
          const contentInfo = await env.DB.prepare('SELECT type FROM content_items WHERE id = (SELECT content_item_id FROM episodes WHERE id = ?)').bind(episode.id).first();
          if (contentInfo) contentType = contentInfo.type;
        } catch { }
      }

      const cardIds = [];
      let seqCounter = 1;
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
        const isAvail = (c.is_available === false || c.is_available === 0) ? 0 : 1;

        let imageKey = normalizeKey(c.image_url);
        if (contentType === 'video' && episodeCoverKey) {
          if (!imageKey || imageKey === '') {
            imageKey = episodeCoverKey;
          }
        }

        cardsNewSchema.push(
          env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time,end_time,duration,image_key,audio_key,sentence,card_type,length,difficulty_score,is_available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(cardUuid, episode.id, cardNum, sStart, sEnd, dur, imageKey, normalizeKey(c.audio_url), c.sentence || null, c.type || c.card_type || null, (typeof c.length === 'number' ? Math.floor(c.length) : null), (typeof diffScoreVal === 'number' ? diffScoreVal : null), isAvail)
        );
        cardsLegacySchema.push(
          env.DB.prepare('INSERT INTO cards (id,episode_id,card_number,start_time_ms,end_time_ms,image_key,audio_key,sentence,card_type,length,difficulty_score,is_available) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(cardUuid, episode.id, cardNum, sStart * 1000, sEnd * 1000, imageKey, normalizeKey(c.audio_url), c.sentence || null, c.type || c.card_type || null, (typeof c.length === 'number' ? Math.floor(c.length) : null), (typeof diffScoreVal === 'number' ? diffScoreVal : null), isAvail)
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

      const runImport = async (useLegacy) => {
        try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
        try {
          await runStmtBatches(useLegacy ? cardsLegacySchema : cardsNewSchema, 200);
          await runStmtBatches(subStmts, 400);
          await runStmtBatches(ftsStmts, 400);
          await runStmtBatches(diffStmts, 400);
          try { await env.DB.prepare('COMMIT').run(); } catch { }

          if (cardIdsForSummaryUpdate.size > 0) {
            updateCardSubtitleLanguageMapBatch(env, Array.from(cardIdsForSummaryUpdate)).catch(err => {
              console.error('[ingestion] Failed to update mapping table:', err.message);
            });
          }

          return true;
        } catch (e) {
          try { await env.DB.prepare('ROLLBACK').run(); } catch { }
          throw e;
        }
      };

      try {
        await runImport(false);
      } catch (e1) {
        const msg = (e1 && e1.message) ? String(e1.message) : String(e1);
        const isNewSchemaMissing = /no\s+such\s+column\s*:.*start_time\b/i.test(msg) || /no\s+such\s+column\s*:.*end_time\b/i.test(msg) || /no\s+column\s+named\s+start_time\b/i.test(msg);
        if (isNewSchemaMissing) {
          try {
            await runImport(true);
          } catch (e2) {
            const m2 = (e2 && e2.message) ? String(e2.message) : String(e2);
            return json({ error: `Import failed (legacy fallback also failed): new-schema error='${msg}', legacy error='${m2}'` }, { status: 500 });
          }
        } else {
          return json({ error: msg }, { status: 500 });
        }
      }

      return json({ ok: true, inserted: cards.length, mode });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
