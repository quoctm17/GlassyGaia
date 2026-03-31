import { json } from '../utils/response.js';

export function registerStarredRoutes(router) {

  // POST /api/content/star — toggle star/unstar a content item
  router.post('/api/content/star', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_id } = body;

      if (!user_id || !film_id) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      // Resolve content_item_id from slug
      const contentItem = await env.DB.prepare(`
        SELECT id FROM content_items WHERE slug = ?
      `).bind(film_id).first();

      if (!contentItem) {
        return json({ error: 'Content not found' }, { status: 404 });
      }

      const contentItemId = contentItem.id;

      // Check if already starred
      const existing = await env.DB.prepare(`
        SELECT id FROM user_starred_content
        WHERE user_id = ? AND content_item_id = ?
        LIMIT 1
      `).bind(user_id, contentItemId).first();

      let starred = false;

      if (existing) {
        // Unstar — delete
        await env.DB.prepare(`
          DELETE FROM user_starred_content
          WHERE user_id = ? AND content_item_id = ?
        `).bind(user_id, contentItemId).run();
        starred = false;
      } else {
        // Star — insert
        const id = crypto.randomUUID();
        await env.DB.prepare(`
          INSERT INTO user_starred_content (id, user_id, content_item_id, created_at, updated_at)
          VALUES (?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
        `).bind(id, user_id, contentItemId).run();
        starred = true;
      }

      return json({ starred });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // GET /api/content/star-status — single content star status
  router.get('/api/content/star-status', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const filmId = url.searchParams.get('film_id');

      if (!userId || !filmId) {
        return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
      }

      const result = await env.DB.prepare(`
        SELECT 1 FROM user_starred_content
        WHERE user_id = ?
          AND content_item_id = (SELECT id FROM content_items WHERE slug = ?)
        LIMIT 1
      `).bind(userId, filmId).first();

      return json({ starred: !!result });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // POST /api/content/star-status-batch — batch star status for multiple films
  router.post('/api/content/star-status-batch', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id, film_ids } = body;

      if (!user_id || !Array.isArray(film_ids)) {
        return json({ error: 'Missing required parameters (user_id, film_ids[])' }, { status: 400 });
      }

      const maxItems = Math.min(film_ids.length, 100);
      const idsToCheck = film_ids.slice(0, maxItems);
      if (idsToCheck.length === 0) {
        return json({});
      }

      // Build placeholders
      const placeholders = idsToCheck.map(() => '?').join(',');

      // Resolve slugs to content_item_ids
      const contentItems = await env.DB.prepare(`
        SELECT id, slug FROM content_items WHERE slug IN (${placeholders})
      `).bind(...idsToCheck).all();

      const slugToId = {};
      for (const row of contentItems.results) {
        slugToId[row.slug] = row.id;
      }

      const contentIds = Object.values(slugToId);
      if (contentIds.length === 0) {
        const empty = {};
        for (const id of idsToCheck) empty[id] = { starred: false };
        return json(empty);
      }

      // Query starred status for all
      const starredPlaceholders = contentIds.map(() => '?').join(',');
      const starredRows = await env.DB.prepare(`
        SELECT content_item_id FROM user_starred_content
        WHERE user_id = ? AND content_item_id IN (${starredPlaceholders})
      `).bind(user_id, ...contentIds).all();

      const starredSet = new Set(starredRows.results.map(r => r.content_item_id));

      // Build result: map back by film_id (slug)
      const result = {};
      for (const id of idsToCheck) {
        const contentId = slugToId[id];
        result[id] = { starred: contentId ? starredSet.has(contentId) : false };
      }

      return json(result);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // GET /api/user/starred-content — list starred content items for a user (paginated)
  router.get('/api/user/starred-content', async (request, env) => {
    try {
      const url = new URL(request.url);
      const userId = url.searchParams.get('user_id');
      const page = Math.max(1, Number(url.searchParams.get('page') || '1'));
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || '20')));
      const offset = (page - 1) * limit;

      if (!userId) {
        return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
      }

      // Get total count
      const countResult = await env.DB.prepare(`
        SELECT COUNT(*) as total FROM user_starred_content WHERE user_id = ?
      `).bind(userId).first();
      const total = countResult?.total || 0;

      // Get paginated results — join to get content metadata
      const results = await env.DB.prepare(`
        SELECT
          ci.slug as film_id,
          ci.title,
          ci.main_language,
          ci.type,
          ci.cover_key,
          ci.num_cards,
          usc.created_at as starred_at
        FROM user_starred_content usc
        JOIN content_items ci ON ci.id = usc.content_item_id
        WHERE usc.user_id = ?
        ORDER BY usc.created_at DESC
        LIMIT ? OFFSET ?
      `).bind(userId, limit, offset).all();

      return json({
        items: results.results || [],
        film_ids: (results.results || []).map(r => r.film_id),
        total,
        page,
        limit,
        has_more: offset + (results.results?.length || 0) < total,
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

}
