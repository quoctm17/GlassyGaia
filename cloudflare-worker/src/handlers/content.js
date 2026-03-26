import { json } from '../utils/response.js';

export function registerContentRoutes(router) {
  router.get('/api/content/saved-cards-count', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');

      if (!userId || !filmId) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      // Count saved cards (cards with any SRS state except 'none')
      const result = await env.DB.prepare(`
        SELECT COUNT(*) as count
        FROM user_card_states
        WHERE user_id = ? AND film_id = ? AND srs_state != 'none'
      `).bind(userId, filmId).first();

      return json({ count: result?.count || 0 });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/content/like-count', async (request, env) => {
    try {
      const url = new URL(request.url);
      const filmId = url.searchParams.get('film_id');

      if (!filmId) {
        return json({ error: 'Missing required parameter (film_id)' }, { status: 400 });
      }

      // Get like count from denormalized table
      const result = await env.DB.prepare(`
        SELECT like_count
        FROM content_like_counts
        WHERE content_item_id = (SELECT id FROM content_items WHERE slug = ?)
      `).bind(filmId).first();

      return json({ count: result?.like_count || 0 });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/content/like-status', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');

      if (!userId || !filmId) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      const result = await env.DB.prepare(`
        SELECT 1
        FROM content_likes
        WHERE user_id = ? AND content_item_id = (SELECT id FROM content_items WHERE slug = ?)
        LIMIT 1
      `).bind(userId, filmId).first();

      return json({ liked: !!result });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/content/like', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_id } = body;

      if (!user_id || !film_id) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      // Get content_item_id from slug
      const contentItem = await env.DB.prepare(`
        SELECT id FROM content_items WHERE slug = ?
      `).bind(film_id).first();

      if (!contentItem) {
        return json({ error: 'Content not found' }, { status: 404 });
      }

      const contentItemId = contentItem.id;

      // Check if already liked
      const existing = await env.DB.prepare(`
        SELECT id FROM content_likes
        WHERE user_id = ? AND content_item_id = ?
        LIMIT 1
      `).bind(user_id, contentItemId).first();

      let liked = false;

      if (existing) {
        // Unlike: delete the like
        await env.DB.prepare(`
          DELETE FROM content_likes
          WHERE user_id = ? AND content_item_id = ?
        `).bind(user_id, contentItemId).run();
        liked = false;

        // Manually update like count (decrement)
        await env.DB.prepare(`
          UPDATE content_like_counts 
          SET like_count = MAX(0, like_count - 1), updated_at = unixepoch() * 1000
          WHERE content_item_id = ?
        `).bind(contentItemId).run();
      } else {
        // Like: insert new like
        const likeId = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO content_likes (id, user_id, content_item_id, created_at, updated_at)
          VALUES (?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
        `).bind(likeId, user_id, contentItemId).run();
        liked = true;

        // Manually update like count (increment)
        // First try to update existing row
        const updateResult = await env.DB.prepare(`
          UPDATE content_like_counts 
          SET like_count = like_count + 1, updated_at = unixepoch() * 1000
          WHERE content_item_id = ?
        `).bind(contentItemId).run();

        // If no row was updated, insert a new one
        if (updateResult.changes === 0) {
          await env.DB.prepare(`
            INSERT INTO content_like_counts (content_item_id, like_count, updated_at)
            VALUES (?, 1, unixepoch() * 1000)
          `).bind(contentItemId).run();
        }
      }

      // Get updated like count
      const countResult = await env.DB.prepare(`
        SELECT like_count FROM content_like_counts WHERE content_item_id = ?
      `).bind(contentItemId).first();

      return json({
        liked,
        like_count: countResult?.like_count || 0
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // POST /api/content/film-stats — batch fetch SRS, saved count, like count, like status for N films
  router.post('/api/content/film-stats', async (request, env) => {
    try {
      const { user_id, film_ids } = await request.json();

      if (!film_ids || !Array.isArray(film_ids) || film_ids.length === 0) {
        return json({ error: 'film_ids must be a non-empty array' }, { status: 400 });
      }

      // Build IN clause placeholders
      const inClause = film_ids.map(() => '?').join(',');

      // 1. Get num_cards per film (for SRS percentage calculation)
      const numCardsRows = await env.DB.prepare(`
        SELECT slug, num_cards FROM content_items WHERE slug IN (${inClause})
      `).bind(...film_ids).all();
      const numCardsMap = {};
      for (const r of (numCardsRows.results || [])) {
        numCardsMap[r.slug] = r.num_cards || 0;
      }

      // 2. Get SRS state distribution per film
      const srsRows = user_id
        ? await env.DB.prepare(`
            SELECT film_id, srs_state, COUNT(*) as count
            FROM user_card_states
            WHERE user_id = ? AND film_id IN (${inClause})
            GROUP BY film_id, srs_state
          `).bind(user_id, ...film_ids).all()
        : { results: [] };

      // 3. Get like counts (from denormalized table)
      const likeCountRows = await env.DB.prepare(`
        SELECT ci.slug as film_id, clc.like_count
        FROM content_like_counts clc
        JOIN content_items ci ON ci.id = clc.content_item_id
        WHERE ci.slug IN (${inClause})
      `).bind(...film_ids).all();

      // 4. Get user like statuses (if logged in)
      const userLikeRows = user_id
        ? await env.DB.prepare(`
            SELECT ci.slug as film_id
            FROM content_likes cl
            JOIN content_items ci ON ci.id = cl.content_item_id
            WHERE cl.user_id = ? AND ci.slug IN (${inClause})
          `).bind(user_id, ...film_ids).all()
        : { results: [] };

      // Build liked set for fast lookup
      const likedSet = new Set((userLikeRows.results || []).map(r => r.film_id));

      // Build result
      const result = {};
      for (const fid of film_ids) {
        const totalCards = numCardsMap[fid] || 0;

        // SRS distribution for this film
        const filmSrs = (srsRows.results || []).filter(r => r.film_id === fid);
        const dist = { none: 0, new: 0, again: 0, hard: 0, good: 0, easy: 0 };
        const savedCards = filmSrs.reduce((s, r) => s + (r.count || 0), 0);

        if (totalCards === 0) {
          dist.none = 100;
        } else {
          // Fill in non-none states
          filmSrs.forEach(row => {
            const state = row.srs_state || 'none';
            if (state in dist) {
              dist[state] = Math.round((row.count / totalCards) * 100);
            }
          });
          // none = cards not saved
          dist.none = Math.round(((totalCards - savedCards) / totalCards) * 100);
          // Normalize to 100%
          const total = Object.values(dist).reduce((a, b) => a + b, 0);
          if (total !== 100) {
            const diff = 100 - total;
            // Find largest non-none state to adjust
            const nonNoneStates = ['new', 'again', 'hard', 'good', 'easy'];
            let maxState = 'new';
            let maxVal = 0;
            for (const s of nonNoneStates) {
              if (dist[s] > maxVal) { maxVal = dist[s]; maxState = s; }
            }
            dist[maxState] += diff;
          }
        }

        result[fid] = {
          srsDistribution: dist,
          savedCount: savedCards,
          likeCount: (likeCountRows.results || []).find(r => r.film_id === fid)?.like_count ?? 0,
          liked: likedSet.has(fid),
        };
      }

      return json(result);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
