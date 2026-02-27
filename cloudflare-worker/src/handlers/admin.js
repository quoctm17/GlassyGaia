import { json } from '../utils/response.js';
import { expandJaIndexText } from '../utils/japanese.js';
import { authenticateRequest } from '../middleware/auth.js';
import { getFrameworkFromLanguage, buildLevelStats } from '../utils/levels.js';

export function registerAdminRoutes(router) {

  router.post('/admin/update-image-path', async (request, env) => {
    try {
      const body = await request.json();
      const { table, slug, field, newPath, episodeFolder, episodeNum, cardNumber, cardId } = body;

      if (!table || !newPath) {
        return json({ error: 'Missing required fields (table, newPath)' }, { status: 400 });
      }

      if (table === 'content_items') {
        if (!slug) {
          return json({ error: 'slug required for content_items' }, { status: 400 });
        }

        const validFields = ['cover_key', 'cover_landscape_key'];
        if (!validFields.includes(field)) {
          return json({ error: 'Invalid field for content_items table' }, { status: 400 });
        }

        await env.DB.prepare(`
          UPDATE content_items SET ${field} = ? WHERE slug = ?
        `).bind(newPath, slug).run();

        return json({
          success: true,
          message: `Updated ${field} for content ${slug}`,
          newPath
        });

      } else if (table === 'episodes') {
        if (!slug || !episodeFolder) {
          return json({ error: 'slug and episodeFolder required for episodes' }, { status: 400 });
        }

        const validFields = ['cover_key', 'cover_landscape_key'];
        if (!validFields.includes(field)) {
          return json({ error: 'Invalid field for episodes table' }, { status: 400 });
        }

        const episodeNum = episodeFolder.match(/e?(\d+)/i)?.[1];
        if (!episodeNum) {
          return json({ error: 'Invalid episodeFolder format' }, { status: 400 });
        }

        const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(slug).first();
        if (!filmRow) {
          return json({ error: `Content not found: ${slug}` }, { status: 404 });
        }

        const episodeResult = await env.DB.prepare(`
          SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
        `).bind(filmRow.id, parseInt(episodeNum)).first();

        if (!episodeResult) {
          return json({ error: `Episode not found for ${slug}/e${episodeNum}` }, { status: 404 });
        }

        await env.DB.prepare(`
          UPDATE episodes SET ${field} = ? WHERE id = ?
        `).bind(newPath, episodeResult.id).run();

        return json({
          success: true,
          message: `Updated ${field} for episode ${slug}/e${episodeNum}`,
          newPath
        });

      } else if (table === 'cards') {
        const epNum = episodeNum !== undefined ? parseInt(episodeNum) : (episodeFolder ? parseInt(episodeFolder.match(/e?(\d+)/i)?.[1]) : null);
        const cNum = cardNumber !== undefined ? parseInt(cardNumber) : (cardId !== undefined ? parseInt(cardId) : null);

        if (!slug || epNum === null || cNum === null) {
          return json({ error: 'slug and (episodeNum or episodeFolder) and (cardNumber or cardId) required for cards' }, { status: 400 });
        }

        const validFields = ['image_key', 'audio_key'];
        if (!validFields.includes(field)) {
          return json({ error: 'Invalid field for cards table. Must be "image_key" or "audio_key"' }, { status: 400 });
        }

        const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(slug).first();
        if (!filmRow) {
          return json({ error: `Content not found: ${slug}` }, { status: 404 });
        }

        const episodeResult = await env.DB.prepare(`
          SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
        `).bind(filmRow.id, epNum).first();

        if (!episodeResult) {
          return json({ error: `Episode not found for ${slug}/e${epNum}` }, { status: 404 });
        }

        const cardResult = await env.DB.prepare(`
          SELECT id FROM cards WHERE episode_id = ? AND card_number = ?
        `).bind(episodeResult.id, cNum).first();

        if (!cardResult) {
          return json({ error: `Card not found: ${slug}/e${epNum}/card ${cNum}` }, { status: 404 });
        }

        await env.DB.prepare(`
          UPDATE cards SET ${field} = ? WHERE id = ?
        `).bind(newPath, cardResult.id).run();

        return json({
          success: true,
          message: `Updated ${field} for card ${slug}/e${epNum}/${cNum}`,
          newPath
        });

      } else {
        return json({ error: 'Invalid table. Must be "content_items", "episodes", or "cards"' }, { status: 400 });
      }
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/update-audio-path', async (request, env) => {
    try {
      const body = await request.json();
      const { slug, episodeFolder, field, newPath } = body;

      if (!slug || !episodeFolder || !field || !newPath) {
        return json({ error: 'Missing required fields (slug, episodeFolder, field, newPath)' }, { status: 400 });
      }

      if (field !== 'preview_audio_key') {
        return json({ error: 'Invalid field for audio update. Must be "preview_audio_key"' }, { status: 400 });
      }

      const episodeNum = episodeFolder.match(/e?(\d+)/i)?.[1];
      if (!episodeNum) {
        return json({ error: 'Invalid episodeFolder format' }, { status: 400 });
      }

      const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(slug).first();
      if (!filmRow) {
        return json({ error: `Content not found: ${slug}` }, { status: 404 });
      }

      const episodeResult = await env.DB.prepare(`
        SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
      `).bind(filmRow.id, parseInt(episodeNum)).first();

      if (!episodeResult) {
        return json({ error: `Episode not found for ${slug}/e${episodeNum}` }, { status: 404 });
      }

      await env.DB.prepare(`
        UPDATE episodes SET ${field} = ? WHERE id = ?
      `).bind(newPath, episodeResult.id).run();

      return json({
        success: true,
        message: `Updated ${field} for episode ${slug}/e${episodeNum}`,
        newPath
      });

    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/migrate-paths', async (request, env) => {
    try {
      const body = await request.json();
      const { dryRun = true, imageExtension = 'avif', audioExtension = 'opus' } = body;

      const stats = {
        contentCovers: 0,
        contentLandscapes: 0,
        episodeCovers: 0,
        episodeLandscapes: 0,
        cardImages: 0,
        cardAudios: 0,
        total: 0
      };

      const replaceExt = (path, oldExt, newExt) => {
        if (!path) return path;
        const regex = new RegExp(`\\.${oldExt}$`, 'i');
        return path.replace(regex, `.${newExt}`);
      };

      if (dryRun) {
        const contentCovers = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM content_items WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'`
        ).first();
        stats.contentCovers = contentCovers?.count || 0;

        const contentLandscapes = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM content_items WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg' OR cover_landscape_key LIKE '%.webp'`
        ).first();
        stats.contentLandscapes = contentLandscapes?.count || 0;

        const episodeCovers = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM episodes WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'`
        ).first();
        stats.episodeCovers = episodeCovers?.count || 0;

        stats.episodeLandscapes = 0;

        const cardImages = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM cards WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg' OR image_key LIKE '%.webp'`
        ).first();
        stats.cardImages = cardImages?.count || 0;

        const cardAudios = await env.DB.prepare(
          `SELECT COUNT(*) as count FROM cards WHERE audio_key LIKE '%.mp3'`
        ).first();
        stats.cardAudios = cardAudios?.count || 0;

        stats.total = stats.contentCovers + stats.contentLandscapes + stats.episodeCovers +
          stats.episodeLandscapes + stats.cardImages + stats.cardAudios;

        return json({
          success: true,
          dryRun: true,
          message: `Would update ${stats.total} paths`,
          stats
        });
      }

      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }

      try {
        const r1 = await env.DB.prepare(`
          UPDATE content_items 
          SET cover_key = REPLACE(REPLACE(REPLACE(cover_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
          WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'
        `).run();
        stats.contentCovers = r1.meta?.changes || 0;

        const r2 = await env.DB.prepare(`
          UPDATE content_items 
          SET cover_landscape_key = REPLACE(REPLACE(REPLACE(cover_landscape_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
          WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg' OR cover_landscape_key LIKE '%.webp'
        `).run();
        stats.contentLandscapes = r2.meta?.changes || 0;

        const r3 = await env.DB.prepare(`
          UPDATE episodes 
          SET cover_key = REPLACE(REPLACE(REPLACE(cover_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
          WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'
        `).run();
        stats.episodeCovers = r3.meta?.changes || 0;

        stats.episodeLandscapes = 0;

        const r5 = await env.DB.prepare(`
          UPDATE cards 
          SET image_key = REPLACE(REPLACE(REPLACE(image_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
          WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg' OR image_key LIKE '%.webp'
        `).run();
        stats.cardImages = r5.meta?.changes || 0;

        const r6 = await env.DB.prepare(`
          UPDATE cards 
          SET audio_key = REPLACE(audio_key, '.mp3', '.${audioExtension}')
          WHERE audio_key LIKE '%.mp3'
        `).run();
        stats.cardAudios = r6.meta?.changes || 0;

        stats.total = stats.contentCovers + stats.contentLandscapes + stats.episodeCovers +
          stats.episodeLandscapes + stats.cardImages + stats.cardAudios;

        try { await env.DB.prepare('COMMIT').run(); } catch { }

        return json({
          success: true,
          dryRun: false,
          message: `Updated ${stats.total} paths successfully`,
          stats
        });

      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }

    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/populate-fts', async (request, env) => {
    try {
      const body = await request.json();
      const { offset = 0, batchSize = 1000 } = body;

      const totalCount = await env.DB.prepare('SELECT COUNT(*) as count FROM card_subtitles').first();
      const total = totalCount?.count || 0;

      const ftsCount = await env.DB.prepare('SELECT COUNT(*) as count FROM card_subtitles_fts').first();
      const currentFtsCount = ftsCount?.count || 0;

      const rows = await env.DB.prepare(`
        SELECT id, card_id, language, text 
        FROM card_subtitles 
        ORDER BY id 
        LIMIT ? OFFSET ?
      `).bind(batchSize, offset).all();

      const items = rows.results || [];
      if (items.length === 0) {
        return json({
          ok: true,
          done: true,
          message: 'All subtitles have been populated',
          stats: {
            total,
            processed: offset,
            inserted: currentFtsCount,
            remaining: 0
          }
        });
      }

      const stmts = [];
      const hasBracketsRe = /\[[^\]]+\]/;

      for (const r of items) {
        let idxText;
        const lang = String(r.language).toLowerCase();
        const text = String(r.text);

        if (lang === 'ja') {
          if (hasBracketsRe.test(text)) {
            idxText = expandJaIndexText(text);
          } else {
            idxText = text.replace(/\s+/g, '');
          }
        } else {
          idxText = text;
        }

        stmts.push(env.DB.prepare(`
          INSERT OR IGNORE INTO card_subtitles_fts (text, language, card_id) 
          VALUES (?, ?, ?)
        `).bind(idxText, r.language, r.card_id));
      }

      let inserted = 0;
      const BATCH_SIZE = 1000;

      for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
        const slice = stmts.slice(i, i + BATCH_SIZE);
        if (slice.length) {
          const results = await env.DB.batch(slice);
          inserted += results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
        }
      }

      const nextOffset = offset + items.length;
      const remaining = Math.max(0, total - nextOffset);

      const cumulativeInserted = await env.DB.prepare('SELECT COUNT(*) as count FROM card_subtitles_fts').first();
      const totalInserted = cumulativeInserted?.count || 0;

      return json({
        ok: true,
        done: remaining === 0,
        message: `Processed ${items.length} subtitles, inserted ${inserted} new entries`,
        stats: {
          total,
          processed: nextOffset,
          inserted: totalInserted,
          remaining
        },
        nextOffset: remaining > 0 ? nextOffset : null
      });
    } catch (e) {
      return json({ error: String(e) }, { status: 500 });
    }
  });

  router.post('/admin/reindex-fts-ja', async (request, env) => {
    const url = new URL(request.url);
    if (url.searchParams.get('confirm') !== '1') {
      return json({ error: 'confirm=1 required' }, { status: 400 });
    }
    try {
      const rows = await env.DB.prepare('SELECT card_id, language, text FROM card_subtitles WHERE LOWER(language)=?').bind('ja').all();
      const items = rows.results || [];
      try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch { }
      try {
        try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE LOWER(language)=?').bind('ja').run(); } catch { }
        const stmts = [];
        for (const r of items) {
          const idxText = expandJaIndexText(r.text);
          stmts.push(env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, r.language, r.card_id));
        }
        for (let i = 0; i < stmts.length; i += 300) {
          const slice = stmts.slice(i, i + 300);
          if (slice.length) await env.DB.batch(slice);
        }
        try { await env.DB.prepare('COMMIT').run(); } catch { }
      } catch (e) {
        try { await env.DB.prepare('ROLLBACK').run(); } catch { }
        throw e;
      }
      return json({ ok: true, rebuilt: items.length });
    } catch (e) {
      return json({ error: String(e) }, { status: 500 });
    }
  });

  router.get('/api/admin/database-stats', async (request, env) => {
    try {
      const tables = [
        'users',
        'auth_providers',
        'user_logins',
        'roles',
        'user_roles',
        'user_preferences',
        'user_study_sessions',
        'user_progress',
        'user_episode_stats'
      ];

      const stats = {};

      for (const table of tables) {
        const result = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first();
        stats[table] = result?.count || 0;
      }

      return json(stats);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/admin/table-data/:tableName', async (request, env) => {
    try {
      const tableName = request.params.tableName;
      const url = new URL(request.url);
      const limit = parseInt(url.searchParams.get('limit') || '100', 10);

      const allowedTables = [
        'users', 'auth_providers', 'user_logins', 'roles', 'user_roles',
        'user_preferences', 'user_study_sessions',
        'user_progress', 'user_episode_stats'
      ];

      if (!allowedTables.includes(tableName)) {
        return json({ error: 'Invalid table name' }, { status: 400 });
      }

      const result = await env.DB.prepare(
        `SELECT * FROM ${tableName} LIMIT ?`
      ).bind(limit).all();

      return json(result.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.put('/api/admin/table-data/:tableName/:recordId', async (request, env) => {
    try {
      const tableName = request.params.tableName;
      const recordId = request.params.recordId;
      const body = await request.json();

      const allowedTables = [
        'users', 'auth_providers', 'user_logins', 'roles', 'user_roles',
        'user_preferences', 'user_study_sessions',
        'user_progress', 'user_episode_stats'
      ];

      if (!allowedTables.includes(tableName)) {
        return json({ error: 'Invalid table name' }, { status: 400 });
      }

      const fieldsToUpdate = Object.keys(body).filter(key =>
        key !== 'id' && key !== 'uid' && key !== 'created_at'
      );

      if (fieldsToUpdate.length === 0) {
        return json({ error: 'No fields to update' }, { status: 400 });
      }

      const setClause = fieldsToUpdate.map(key => `${key} = ?`).join(', ');
      const values = fieldsToUpdate.map(key => body[key]);

      let primaryKeyColumn = 'id';
      if (tableName === 'users' || tableName === 'user_logins' || tableName === 'user_roles' ||
        tableName === 'user_preferences' || tableName === 'user_study_sessions' ||
        tableName === 'user_progress' || tableName === 'user_episode_stats') {
        const hasUid = ['users', 'user_logins', 'user_roles', 'user_preferences',
          'user_study_sessions', 'user_progress',
          'user_episode_stats'].includes(tableName);
        if (hasUid && body.uid) {
          primaryKeyColumn = 'uid';
        }
      }

      const updateQuery = `UPDATE ${tableName} SET ${setClause}, updated_at = ? WHERE ${primaryKeyColumn} = ?`;
      values.push(Date.now());
      values.push(recordId);

      await env.DB.prepare(updateQuery).bind(...values).run();

      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.delete('/api/admin/table-data/:tableName/:recordId', async (request, env) => {
    try {
      const tableName = request.params.tableName;
      const recordId = request.params.recordId;

      const allowedTables = [
        'users', 'auth_providers', 'user_logins', 'roles', 'user_roles',
        'user_preferences', 'user_study_sessions',
        'user_progress', 'user_episode_stats'
      ];

      if (!allowedTables.includes(tableName)) {
        return json({ error: 'Invalid table name' }, { status: 400 });
      }

      let primaryKeyColumn = 'id';
      if (['users', 'user_logins', 'user_roles', 'user_preferences',
        'user_study_sessions', 'user_progress',
        'user_episode_stats'].includes(tableName)) {
        primaryKeyColumn = 'uid';
      }

      const deleteQuery = `DELETE FROM ${tableName} WHERE ${primaryKeyColumn} = ?`;
      await env.DB.prepare(deleteQuery).bind(recordId).run();

      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/admin/sync-roles', async (request, env) => {
    try {
      const body = await request.json();
      const { adminEmails, requesterId } = body;

      if (!adminEmails || !Array.isArray(adminEmails)) {
        return json({ error: 'adminEmails array is required' }, { status: 400 });
      }

      const requester = await env.DB.prepare(`
        SELECT is_admin, role FROM users WHERE id = ?
      `).bind(requesterId).first();

      if (!requester || (!requester.is_admin && requester.role !== 'admin')) {
        return json({ error: 'Unauthorized: Admin access required' }, { status: 403 });
      }

      const now = Date.now();
      let syncedCount = 0;
      let skippedCount = 0;

      for (const email of adminEmails) {
        const user = await env.DB.prepare(`
          SELECT id, is_admin, role FROM users WHERE email = ?
        `).bind(email).first();

        if (user) {
          await env.DB.prepare(`
            UPDATE users SET is_admin = 1, role = 'admin', updated_at = ? WHERE id = ?
          `).bind(now, user.id).run();

          await env.DB.prepare(`
            INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
            VALUES (?, 'admin', ?, ?)
          `).bind(user.id, requesterId, now).run();

          syncedCount++;
        } else {
          skippedCount++;
        }
      }

      return json({
        success: true,
        synced: syncedCount,
        skipped: skippedCount,
        message: `Synced ${syncedCount} admin users, skipped ${skippedCount} (not registered)`
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/admin/user-roles/:userId', async (request, env) => {
    try {
      const userId = request.params.userId;

      const roles = await env.DB.prepare(`
        SELECT role_name FROM user_roles WHERE user_id = ?
      `).bind(userId).all();

      const roleNames = roles.results?.map(r => r.role_name) || [];

      return json({ roles: roleNames });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.put('/api/admin/user-roles/:userId', async (request, env) => {
    try {
      const userId = request.params.userId;
      const body = await request.json();
      const { roles, requesterId } = body;

      if (!roles || !Array.isArray(roles)) {
        return json({ error: 'roles array is required' }, { status: 400 });
      }

      if (!requesterId) {
        return json({ error: 'requesterId is required' }, { status: 400 });
      }

      const requesterRoles = await env.DB.prepare(`
        SELECT role_name FROM user_roles WHERE user_id = ?
      `).bind(requesterId).all();

      const isSuperAdmin = requesterRoles.results?.some(r => r.role_name === 'superadmin');

      if (!isSuperAdmin) {
        return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
      }

      const validRoles = ['user', 'admin', 'superadmin'];
      for (const role of roles) {
        if (!validRoles.includes(role)) {
          return json({ error: `Invalid role: ${role}` }, { status: 400 });
        }
      }

      const now = Date.now();

      await env.DB.prepare(`
        DELETE FROM user_roles WHERE user_id = ?
      `).bind(userId).run();

      for (const role of roles) {
        await env.DB.prepare(`
          INSERT INTO user_roles (user_id, role_name, granted_by, granted_at)
          VALUES (?, ?, ?, ?)
        `).bind(userId, role, requesterId, now).run();
      }

      return json({
        success: true,
        message: `Updated roles for user ${userId}`,
        roles: roles
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/api/admin/rewards-config', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      if (!auth.roles.includes('superadmin')) {
        return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
      }

      const configs = await env.DB.prepare(`
        SELECT * FROM rewards_config
        ORDER BY action_type ASC
      `).all();

      return json({ configs: configs.results || [] });
    } catch (e) {
      console.error('Get rewards config error:', e);
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.put('/api/admin/rewards-config', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      if (!auth.roles.includes('superadmin')) {
        return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
      }

      const body = await request.json();
      const { id, xp_amount, coin_amount, interval_seconds, description } = body;

      if (!id) {
        return json({ error: 'id is required' }, { status: 400 });
      }

      if (xp_amount !== undefined && (typeof xp_amount !== 'number' || xp_amount < 0)) {
        return json({ error: 'xp_amount must be a non-negative number' }, { status: 400 });
      }

      if (coin_amount !== undefined && (typeof coin_amount !== 'number' || coin_amount < 0)) {
        return json({ error: 'coin_amount must be a non-negative number' }, { status: 400 });
      }

      if (interval_seconds !== undefined && interval_seconds !== null && (typeof interval_seconds !== 'number' || interval_seconds < 1)) {
        return json({ error: 'interval_seconds must be a positive number or null' }, { status: 400 });
      }

      const updateFields = [];
      const updateValues = [];

      if (xp_amount !== undefined) {
        updateFields.push('xp_amount = ?');
        updateValues.push(xp_amount);
      }

      if (coin_amount !== undefined) {
        updateFields.push('coin_amount = ?');
        updateValues.push(coin_amount);
      }

      if (interval_seconds !== undefined) {
        updateFields.push('interval_seconds = ?');
        updateValues.push(interval_seconds);
      }

      if (description !== undefined) {
        updateFields.push('description = ?');
        updateValues.push(description);
      }

      if (updateFields.length === 0) {
        return json({ error: 'No fields to update' }, { status: 400 });
      }

      updateValues.push(id);

      await env.DB.prepare(`
        UPDATE rewards_config
        SET ${updateFields.join(', ')}, updated_at = unixepoch() * 1000
        WHERE id = ?
      `).bind(...updateValues).run();

      const updated = await env.DB.prepare(`
        SELECT * FROM rewards_config WHERE id = ?
      `).bind(id).first();

      return json({ success: true, config: updated });
    } catch (e) {
      console.error('Update rewards config error:', e);
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/api/admin/populate-search-words', async (request, env) => {
    try {
      const auth = await authenticateRequest(request, env);
      if (!auth.authenticated) {
        return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
      }

      if (!auth.roles.includes('superadmin')) {
        return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
      }

      console.log('[populate-search-words] Starting word extraction...');
      const startTime = Date.now();

      const langResult = await env.DB.prepare(`
        SELECT DISTINCT language FROM card_subtitles
      `).all();

      const languages = (langResult.results || []).map(r => r.language);
      console.log(`[populate-search-words] Found ${languages.length} languages: ${languages.join(', ')}`);

      let totalWordsInserted = 0;
      let totalWordsUpdated = 0;

      for (const lang of languages) {
        console.log(`[populate-search-words] Processing language: ${lang}`);

        const wordQuery = `
          WITH RECURSIVE
          split(word, rest) AS (
            SELECT
              CASE
                WHEN LENGTH(text) = 0 THEN NULL
                WHEN INSTR(' ,.!?;:()[]{}"\'', SUBSTR(text, 1, 1)) > 0 THEN ''
                ELSE SUBSTR(text, 1, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(text, 1, 1)) - 1)
              END,
              CASE
                WHEN INSTR(' ,.!?;:()[]{}"\'', SUBSTR(text, 1, 1)) = 0 THEN SUBSTR(text, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(text, 1, 1)))
                ELSE SUBSTR(text, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(text, 1, 1)) + 1)
              END
            FROM card_subtitles
            WHERE language = ? AND text IS NOT NULL AND LENGTH(text) > 0

            UNION ALL

            SELECT
              CASE
                WHEN LENGTH(rest) = 0 THEN NULL
                WHEN INSTR(' ,.!?;:()[]{}"\'', SUBSTR(rest, 1, 1)) > 0 THEN ''
                ELSE SUBSTR(rest, 1, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(rest, 1, 1)) - 1)
              END,
              CASE
                WHEN INSTR(' ,.!?;:()[]{}"\'', SUBSTR(rest, 1, 1)) = 0 THEN SUBSTR(rest, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(rest, 1, 1)))
                ELSE SUBSTR(rest, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(rest, 1, 1)) + 1)
              END
            FROM split
            WHERE rest IS NOT NULL AND LENGTH(rest) > 0
          )
          SELECT
            LOWER(TRIM(word)) as word,
            COUNT(*) as frequency,
            COUNT(DISTINCT card_id) as context_count
          FROM (
            SELECT cs.card_id, TRIM(
              CASE
                WHEN INSTR(' ,.!?;:()[]{}"\'', SUBSTR(cs.text, 1, 1)) = 0 THEN SUBSTR(cs.text, 1, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(cs.text, 1, 1)) - 1)
                ELSE SUBSTR(cs.text, INSTR(' ,.!?;:()[]{}"\'', SUBSTR(cs.text, 1, 1)) + 1)
              END
            ) as word
            FROM card_subtitles cs
            WHERE cs.language = ? AND cs.text IS NOT NULL AND LENGTH(cs.text) > 0
          )
          WHERE word IS NOT NULL AND LENGTH(word) > 0
          GROUP BY word
          ORDER BY frequency DESC
        `;

        const cardsResult = await env.DB.prepare(`
          SELECT cs.card_id, cs.text
          FROM card_subtitles cs
          INNER JOIN cards c ON c.id = cs.card_id
          INNER JOIN episodes e ON e.id = c.episode_id
          INNER JOIN content_items ci ON ci.id = e.content_item_id
          WHERE cs.language = ?
            AND cs.text IS NOT NULL
            AND LENGTH(cs.text) > 0
            AND c.is_available = 1
            AND LOWER(ci.main_language) = 'en'
          ORDER BY cs.card_id
        `).bind(lang).all();

        console.log(`[populate-search-words] Processing ${cardsResult.results?.length || 0} cards for ${lang}`);

        const wordMap = new Map();
        const BATCH_SIZE = 500;

        for (let i = 0; i < (cardsResult.results || []).length; i += BATCH_SIZE) {
          const batch = (cardsResult.results || []).slice(i, i + BATCH_SIZE);

          for (const row of batch) {
            const words = (row.text || '')
              .toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter(w => w.length > 1);

            const uniqueWords = [...new Set(words)];

            for (const word of uniqueWords) {
              if (!wordMap.has(word)) {
                wordMap.set(word, { frequency: 0, context_count: new Set() });
              }
              const data = wordMap.get(word);
              data.frequency++;
              data.context_count.add(row.card_id);
            }
          }

          if ((i + BATCH_SIZE) % 5000 === 0) {
            console.log(`[populate-search-words] Processed ${Math.min(i + BATCH_SIZE, cardsResult.results.length)}/${cardsResult.results.length} cards for ${lang}`);
          }
        }

        console.log(`[populate-search-words] Found ${wordMap.size} unique words for ${lang}`);

        const wordArray = Array.from(wordMap.entries()).map(([word, data]) => ({
          word,
          frequency: data.frequency,
          context_count: data.context_count.size
        }));

        wordArray.sort((a, b) => b.frequency - a.frequency);
        const topWords = wordArray.slice(0, 10000);

        console.log(`[populate-search-words] Inserting ${topWords.length} top words for ${lang}`);

        const INSERT_BATCH_SIZE = 100;
        for (let i = 0; i < topWords.length; i += INSERT_BATCH_SIZE) {
          const batch = topWords.slice(i, i + INSERT_BATCH_SIZE);
          const placeholders = batch.map(() => '(?, ?, ?, ?, ?)').join(', ');
          const values = batch.flatMap(item => [
            item.word,
            lang,
            item.frequency,
            item.context_count,
            Date.now()
          ]);

          const result = await env.DB.prepare(`
            INSERT OR REPLACE INTO search_words (word, language, frequency, context_count, updated_at)
            VALUES ${placeholders}
          `).bind(...values).run();

          totalWordsInserted += result.success ? batch.length : 0;
        }

        console.log(`[populate-search-words] Completed language: ${lang}`);
      }

      const duration = Date.now() - startTime;
      console.log(`[populate-search-words] Complete! Inserted/updated ${totalWordsInserted} words in ${duration}ms`);

      return json({
        success: true,
        words_processed: totalWordsInserted,
        duration_ms: duration,
        message: 'search_words table populated successfully'
      });
    } catch (e) {
      console.error('[populate-search-words] Error:', e);
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/import-reference', async (request, env) => {
    try {
      const body = await request.json();
      const { type, data, framework } = body;

      if (!type || (type !== 'cefr' && type !== 'frequency')) {
        return json({ error: 'Invalid type. Must be "cefr" or "frequency"' }, { status: 400 });
      }

      if (!data || !Array.isArray(data) || data.length === 0) {
        return json({ error: 'data array is required and must not be empty' }, { status: 400 });
      }

      const errors = [];
      const batchSize = 500;

      if (type === 'cefr') {
        try {
          if (framework) {
            await env.DB.prepare('DELETE FROM reference_cefr_list WHERE framework = ?').bind(framework).run();
          } else {
            await env.DB.prepare('DELETE FROM reference_cefr_list').run();
          }
        } catch (e) {
          console.error('Failed to clear reference data:', e);
        }
      } else if (type === 'frequency') {
        try {
          await env.DB.prepare('DELETE FROM reference_word_frequency').run();
        } catch (e) {
          console.error('Failed to clear frequency data:', e);
        }
      }

      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const stmts = [];

        for (const row of batch) {
          try {
            if (type === 'cefr') {
              const headword = String(row.headword || '').trim();
              const pos = row.pos ? String(row.pos).trim() : null;
              const level = String(row.level || row.cefr_level || '').trim().toUpperCase();
              const fw = framework || 'CEFR';

              if (!headword || !level) {
                errors.push(`Row ${i + batch.indexOf(row) + 1}: Missing headword or level`);
                continue;
              }

              try {
                stmts.push(env.DB.prepare(`
                  INSERT OR REPLACE INTO reference_cefr_list (headword, pos, cefr_level, framework)
                  VALUES (?, ?, ?, ?)
                `).bind(headword, pos, level, fw));
              } catch (e) {
                stmts.push(env.DB.prepare(`
                  INSERT OR REPLACE INTO reference_cefr_list (headword, pos, cefr_level)
                  VALUES (?, ?, ?)
                `).bind(headword, pos, level));
              }
            } else if (type === 'frequency') {
              const word = String(row.word || '').trim();
              const rank = parseInt(row.rank, 10);
              const stem = row.stem ? String(row.stem).trim() : null;

              if (!word || isNaN(rank) || rank < 0) {
                errors.push(`Row ${i + batch.indexOf(row) + 1}: Invalid word or rank`);
                continue;
              }

              const fw = framework || null;
              try {
                stmts.push(env.DB.prepare(`
                  INSERT OR REPLACE INTO reference_word_frequency (word, rank, stem, framework)
                  VALUES (?, ?, ?, ?)
                `).bind(word, rank, stem, fw));
              } catch (e) {
                stmts.push(env.DB.prepare(`
                  INSERT OR REPLACE INTO reference_word_frequency (word, rank, stem)
                  VALUES (?, ?, ?)
                `).bind(word, rank, stem));
              }
            }
          } catch (e) {
            errors.push(`Row ${i + batch.indexOf(row) + 1}: ${e.message}`);
          }
        }

        if (stmts.length > 0) {
          try {
            await env.DB.batch(stmts);
          } catch (e) {
            errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${e.message}`);
          }
        }
      }

      return json({ success: true, errors: errors.length > 0 ? errors : undefined });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/admin/system-config/:key', async (request, env) => {
    try {
      const key = request.params.key;
      const row = await env.DB.prepare('SELECT value FROM system_configs WHERE key = ?').bind(key).first();

      if (!row) {
        return json({ error: 'Not found' }, { status: 404 });
      }

      return json({ key, value: row.value });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/system-config/:key', async (request, env) => {
    try {
      const key = request.params.key;
      const body = await request.json();
      const { value } = body;

      if (value === undefined) {
        return json({ error: 'value is required' }, { status: 400 });
      }

      await env.DB.prepare(`
        INSERT OR REPLACE INTO system_configs (key, value, updated_at)
        VALUES (?, ?, strftime('%s','now'))
      `).bind(key, String(value)).run();

      return json({ success: true });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.post('/admin/assess-content-level', async (request, env) => {
    try {
      const body = await request.json();
      const { contentSlug } = body;

      if (!contentSlug) {
        return json({ error: 'contentSlug is required' }, { status: 400 });
      }

      const contentItem = await env.DB.prepare('SELECT id, main_language FROM content_items WHERE slug = ?').bind(contentSlug).first();
      if (!contentItem) {
        return json({ error: 'Content item not found' }, { status: 404 });
      }

      const cardsRows = await env.DB.prepare(`
        SELECT c.id, c.sentence, c.difficulty_score
        FROM cards c
        JOIN episodes e ON c.episode_id = e.id
        WHERE e.content_item_id = ? AND c.sentence IS NOT NULL AND c.sentence != ''
      `).bind(contentItem.id).all();

      const cards = cardsRows.results || [];
      if (cards.length === 0) {
        return json({ success: true, message: 'No cards to assess' });
      }

      const framework = getFrameworkFromLanguage(contentItem.main_language);

      const configRow = await env.DB.prepare('SELECT value FROM system_configs WHERE key = ?').bind('CUTOFF_RANKS').first();
      let allCutoffs = configRow ? JSON.parse(configRow.value) : {};
      if (allCutoffs && !allCutoffs.CEFR && (allCutoffs.A1 !== undefined || allCutoffs.N5 !== undefined || allCutoffs['1'] !== undefined)) {
        if (allCutoffs.A1 !== undefined) {
          allCutoffs = { CEFR: allCutoffs };
        } else if (allCutoffs.N5 !== undefined) {
          allCutoffs = { JLPT: allCutoffs };
        } else if (allCutoffs['1'] !== undefined) {
          allCutoffs = { HSK: allCutoffs };
        }
      }
      const frameworkCutoffs = allCutoffs[framework] || {};

      const levelOrders = {
        CEFR: { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 },
        JLPT: { 'N5': 1, 'N4': 2, 'N3': 3, 'N2': 4, 'N1': 5 },
        HSK: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9 }
      };
      const difficultyMaps = {
        CEFR: { 'A1': 10, 'A2': 25, 'B1': 45, 'B2': 65, 'C1': 80, 'C2': 95 },
        JLPT: { 'N5': 10, 'N4': 25, 'N3': 45, 'N2': 70, 'N1': 90 },
        HSK: { '1': 5, '2': 15, '3': 30, '4': 50, '5': 70, '6': 85, '7': 92, '8': 96, '9': 98 }
      };

      const levelOrder = levelOrders[framework] || levelOrders.CEFR;
      const difficultyMap = difficultyMaps[framework] || difficultyMaps.CEFR;

      function tokenize(text) {
        return String(text || '')
          .toLowerCase()
          .replace(/[^\w\s]/g, ' ')
          .split(/\s+/)
          .filter(t => t.length > 0);
      }

      async function getWordLevel(word) {
        let refRow;
        try {
          refRow = await env.DB.prepare('SELECT cefr_level FROM reference_cefr_list WHERE headword = ? AND framework = ? LIMIT 1').bind(word, framework).first();
        } catch (e) {
          refRow = await env.DB.prepare('SELECT cefr_level FROM reference_cefr_list WHERE headword = ? LIMIT 1').bind(word).first();
        }
        if (refRow) {
          return refRow.cefr_level;
        }

        const freqRow = await env.DB.prepare('SELECT rank FROM reference_word_frequency WHERE word = ? OR stem = ? LIMIT 1').bind(word, word).first();
        if (freqRow && Object.keys(frameworkCutoffs).length > 0) {
          const rank = freqRow.rank;
          const levels = Object.keys(frameworkCutoffs).sort((a, b) => (frameworkCutoffs[a] || 0) - (frameworkCutoffs[b] || 0));
          for (const level of levels) {
            if (rank <= (frameworkCutoffs[level] || Infinity)) {
              return level;
            }
          }
          return levels[levels.length - 1] || null;
        }

        return null;
      }

      const updates = [];
      let cardsProcessed = 0;

      for (const card of cards) {
        const tokens = tokenize(card.sentence);
        let maxLevel = null;
        let maxLevelNum = 0;

        const levelPromises = tokens.map(token => getWordLevel(token));
        const levels = await Promise.all(levelPromises);

        for (const level of levels) {
          if (level && levelOrder[level] && levelOrder[level] > maxLevelNum) {
            maxLevelNum = levelOrder[level];
            maxLevel = level;
          }
        }

        if (maxLevel) {
          updates.push(env.DB.prepare(`
            INSERT OR REPLACE INTO card_difficulty_levels (card_id, framework, level, language)
            VALUES (?, ?, ?, ?)
          `).bind(card.id, framework, maxLevel, contentItem.main_language));

          const difficulty = difficultyMap[maxLevel] || card.difficulty_score || 50;
          updates.push(env.DB.prepare('UPDATE cards SET difficulty_score = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?').bind(difficulty, card.id));
        }

        cardsProcessed++;

        if (updates.length >= 200) {
          await env.DB.batch(updates);
          updates.length = 0;
        }
      }

      if (updates.length > 0) {
        await env.DB.batch(updates);
      }

      const episodes = await env.DB.prepare('SELECT id, episode_number FROM episodes WHERE content_item_id = ?').bind(contentItem.id).all();

      for (const ep of (episodes.results || [])) {
        const epCountAvg = await env.DB.prepare('SELECT COUNT(*) AS c, AVG(difficulty_score) AS avg FROM cards WHERE episode_id=? AND difficulty_score IS NOT NULL').bind(ep.id).first();
        const epLevelRows = await env.DB.prepare(`
          SELECT cdl.framework, cdl.level, cdl.language
          FROM card_difficulty_levels cdl
          JOIN cards c ON cdl.card_id = c.id
          WHERE c.episode_id = ?
        `).bind(ep.id).all();
        const epStatsJson = JSON.stringify(buildLevelStats(epLevelRows.results || []));
        const epNumCards = Number(epCountAvg?.c || 0);
        const epAvg = epCountAvg && epCountAvg.avg != null ? Number(epCountAvg.avg) : null;

        await env.DB.prepare(`
          UPDATE episodes
          SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
          WHERE id=?
        `).bind(epNumCards, epAvg, epStatsJson, ep.id).run();
      }

      const itemCountAvg = await env.DB.prepare(`
        SELECT COUNT(c.id) AS c, AVG(c.difficulty_score) AS avg
        FROM cards c
        JOIN episodes e ON c.episode_id = e.id
        WHERE e.content_item_id = ? AND c.difficulty_score IS NOT NULL
      `).bind(contentItem.id).first();
      const itemLevelRows = await env.DB.prepare(`
        SELECT cdl.framework, cdl.level, cdl.language
        FROM card_difficulty_levels cdl
        JOIN cards c ON cdl.card_id = c.id
        JOIN episodes e ON c.episode_id = e.id
        WHERE e.content_item_id = ?
      `).bind(contentItem.id).all();
      const itemStatsJson = JSON.stringify(buildLevelStats(itemLevelRows.results || []));
      const itemNumCards = Number(itemCountAvg?.c || 0);
      const itemAvg = itemCountAvg && itemCountAvg.avg != null ? Number(itemCountAvg.avg) : null;

      await env.DB.prepare(`
        UPDATE content_items
        SET num_cards=?, avg_difficulty_score=?, level_framework_stats=?, updated_at=strftime('%s','now')
        WHERE id=?
      `).bind(itemNumCards, itemAvg, itemStatsJson, contentItem.id).run();

      return json({ success: true, cardsProcessed, totalCards: cards.length });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  router.get('/admin/check-reference-data', async (request, env) => {
    try {
      const url = new URL(request.url);
      const framework = url.searchParams.get('framework');

      if (!framework) {
        return json({ error: 'framework parameter is required' }, { status: 400 });
      }

      const refListCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM reference_cefr_list WHERE framework = ?').bind(framework).first();
      const hasReferenceList = (refListCount?.count || 0) > 0;

      const freqCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM reference_word_frequency WHERE framework = ? OR framework IS NULL').bind(framework).first();
      const hasFrequencyData = (freqCount?.count || 0) > 0;

      return json({
        exists: hasReferenceList || hasFrequencyData,
        hasReferenceList,
        hasFrequencyData
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
