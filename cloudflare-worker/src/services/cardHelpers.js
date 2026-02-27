// Helper function to get card UUID from display ID
export async function getCardUUID(env, filmId, episodeId, cardDisplayId) {
  if (!filmId || !episodeId || !cardDisplayId) return null;

  // Try to parse card number from display ID (e.g., "000" -> 0)
  const cardNum = parseInt(cardDisplayId);
  if (isNaN(cardNum)) return null;

  // Get film internal ID
  const film = await env.DB.prepare(`
    SELECT id FROM content_items WHERE slug = ?
  `).bind(filmId).first();

  if (!film) return null;

  // Parse episode number from episode ID (e.g., "e1" -> 1)
  let epNum = parseInt(String(episodeId).replace(/^e/i, ''));
  if (isNaN(epNum)) {
    const m = String(episodeId).match(/_(\d+)$/);
    epNum = m ? parseInt(m[1]) : 1;
  }

  // Get episode internal ID
  const ep = await env.DB.prepare(`
    SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
  `).bind(film.id, epNum).first();

  if (!ep) return null;

  // Get card UUID
  const card = await env.DB.prepare(`
    SELECT id FROM cards WHERE episode_id = ? AND card_number = ?
  `).bind(ep.id, cardNum).first();

  return card?.id || null;
}

// Helper function to update card_subtitle_language_map normalized table
// This normalized table speeds up subtitle language filtering queries with index
export async function updateCardSubtitleLanguageMap(env, cardId) {
  try {
    // We use a batch to ensure the delete and insert happen together 
    // and to minimize network latency.
    await env.DB.batch([
      // 1. Clear existing mappings for this card
      env.DB.prepare('DELETE FROM card_subtitle_language_map WHERE card_id = ?')
        .bind(cardId),

      // 2. Sync directly from the source table in one shot.
      // This avoids pulling data into JS and pushing it back down.
      env.DB.prepare(`
        INSERT INTO card_subtitle_language_map (card_id, language)
        SELECT DISTINCT card_id, language 
        FROM card_subtitles 
        WHERE card_id = ?
      `).bind(cardId)
    ]);

  } catch (e) {
    // Optimization-only table, so we log but don't crash
    console.error(`[updateCardSubtitleLanguageMap] Error for card ${cardId}:`, e.message);
  }
}

// Batch update mapping table for multiple cards
export async function updateCardSubtitleLanguageMapBatch(env, cardIds) {
  if (!cardIds || cardIds.length === 0) return;

  try {
    // 1. Create placeholders (?,?,?)
    const placeholders = cardIds.map(() => '?').join(',');

    // 2. Execute everything in a single DB transaction (Atomic Batch)
    await env.DB.batch([
      // STEP A: Delete old mappings for all targeted cardIds
      env.DB.prepare(`
        DELETE FROM card_subtitle_language_map 
        WHERE card_id IN (${placeholders})
      `).bind(...cardIds),

      // STEP B: Insert fresh mappings directly from the source table
      // This "INSERT INTO ... SELECT" is O(1) in terms of data transfer to JS
      env.DB.prepare(`
        INSERT INTO card_subtitle_language_map (card_id, language)
        SELECT DISTINCT card_id, language 
        FROM card_subtitles 
        WHERE card_id IN (${placeholders})
      `).bind(...cardIds)
    ]);

    console.log(`[Batch Sync] Successfully updated ${cardIds.length} cards.`);
  } catch (e) {
    console.error(`[updateCardSubtitleLanguageMapBatch] Error:`, e.message);
  }
}

// Populate mapping table asynchronously (called when table is empty)
// This runs in background and populates data in batches to avoid timeout
export async function populateMappingTableAsync(env) {
  try {
    console.log("[populateMappingTable] Starting optimized migration...");

    // 1. One-shot migration using SQL only.
    // This is significantly faster and uses 99% fewer "Rows Read".
    // "INSERT OR IGNORE" handles duplicates automatically at the DB level.
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO card_subtitle_language_map (card_id, language)
      SELECT DISTINCT card_id, language
      FROM card_subtitles
    `).run();

    console.log(`[populateMappingTable] Migration complete.`);
    
  } catch (e) {
    // If the table is massive and hits a D1 timeout, we use a smarter Batching method
    console.error(`[populateMappingTable] One-shot failed, attempting chunked migration:`, e.message);
    await populateInChunks(env);
  }
}

/**
 * Smart chunking that avoids 'WHERE NOT EXISTS'
 * Instead of checking what's missing, we process the source table by card_id ranges.
 */
export async function populateInChunks(env) {
  let lastId = 0;
  const chunkSize = 10000;
  let hasMore = true;

  while (hasMore) {
    const result = await env.DB.prepare(`
      INSERT OR IGNORE INTO card_subtitle_language_map (card_id, language)
      SELECT DISTINCT card_id, language
      FROM card_subtitles
      WHERE card_id > ?
      ORDER BY card_id ASC
      LIMIT ?
    `).bind(lastId, chunkSize).run();

    // Find the last card_id processed to move the "window" forward
    const lastRow = await env.DB.prepare(`
       SELECT card_id FROM card_subtitles 
       WHERE card_id > ? 
       ORDER BY card_id ASC 
       LIMIT 1 OFFSET ?
    `).bind(lastId, chunkSize - 1).first();

    if (lastRow) {
      lastId = lastRow.card_id;
      console.log(`[populateMappingTable] Processed up to Card ID: ${lastId}`);
    } else {
      hasMore = false;
    }
  }
}
