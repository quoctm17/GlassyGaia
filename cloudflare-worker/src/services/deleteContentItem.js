/**
 * Shared logic to delete a content item by slug (cascading episodes, cards, media).
 * Used by DELETE /items/:slug and by admin bulk delete (avoids internal fetch 404).
 * @param {object} env - Worker env (DB, MEDIA_BUCKET)
 * @param {string} filmSlug - content_items.slug
 * @returns {Promise<{ ok: true, deleted: string, episodes_deleted: number, cards_deleted: number, media_deleted: number, media_errors: string[] } | { ok: false, error: string, status?: number }>}
 */
export async function deleteContentItemBySlug(env, filmSlug) {
  const slug = String(filmSlug).trim();
  if (!slug) return { ok: false, error: 'Missing slug', status: 400 };

  const filmRow = await env.DB.prepare('SELECT id, slug, cover_key FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(slug).first();
  if (!filmRow) return { ok: false, error: 'Not found', status: 404 };

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
    const MAX_SQL_VARS = 100;
    for (let i = 0; i < episodeIds.length; i += MAX_SQL_VARS) {
      const chunk = episodeIds.slice(i, i + MAX_SQL_VARS);
      const placeholders = chunk.map(() => '?').join(',');
      const cardsRows = await env.DB.prepare(`SELECT id, image_key, audio_key, episode_id, card_number FROM cards WHERE episode_id IN (${placeholders})`).bind(...chunk).all().catch(() => ({ results: [] }));
      cardsResults = cardsResults.concat(cardsRows.results || []);
    }
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

  try {
    await env.DB.prepare('BEGIN TRANSACTION').run();
  } catch { }
  try {
    try { await env.DB.prepare(`DELETE FROM card_subtitles WHERE card_id IN (SELECT c.id FROM cards c INNER JOIN episodes e ON e.id = c.episode_id WHERE e.content_item_id = ?)`).bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (SELECT c.id FROM cards c INNER JOIN episodes e ON e.id = c.episode_id WHERE e.content_item_id = ?)`).bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (SELECT c.id FROM cards c INNER JOIN episodes e ON e.id = c.episode_id WHERE e.content_item_id = ?)`).bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare(`DELETE FROM card_subtitle_language_map WHERE card_id IN (SELECT c.id FROM cards c INNER JOIN episodes e ON e.id = c.episode_id WHERE e.content_item_id = ?)`).bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id IN (SELECT id FROM episodes WHERE content_item_id = ?)`).bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare('DELETE FROM episodes WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare('DELETE FROM content_item_languages WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }
    try { await env.DB.prepare('DELETE FROM content_item_categories WHERE content_item_id = ?').bind(filmRow.id).run(); } catch { }
    await env.DB.prepare('DELETE FROM content_items WHERE id = ?').bind(filmRow.id).run();
    try { await env.DB.prepare('COMMIT').run(); } catch { }
  } catch (e) {
    try { await env.DB.prepare('ROLLBACK').run(); } catch { }
    return { ok: false, error: e.message || String(e), status: 500 };
  }

  let mediaDeletedCount = 0;
  if (env.MEDIA_BUCKET && mediaKeys.size) {
    const keys = Array.from(mediaKeys).filter(Boolean);
    const concurrency = 40;
    let idx = 0;
    while (idx < keys.length) {
      const batch = [];
      for (let i = 0; i < concurrency && idx < keys.length; i++, idx++) {
        const k = keys[idx];
        batch.push(
          env.MEDIA_BUCKET.delete(k).then(() => { mediaDeletedCount += 1; }).catch(() => { mediaErrors.push(`fail:${k}`); })
        );
      }
      await Promise.allSettled(batch);
    }
  }

  return {
    ok: true,
    deleted: filmRow.slug,
    episodes_deleted: episodesResults.length,
    cards_deleted: cardsResults.length,
    media_deleted: mediaDeletedCount,
    media_errors: mediaErrors,
  };
}
