import { json } from '../utils/response.js';

export function registerUsersRoutes(router) {
  // Register/Create user (upsert)
  router.post('/api/users/register', async (request, env) => {
    try {
      const body = await request.json();
      const { id, email, display_name, photo_url, auth_provider } = body;

      if (!id) {
        return json({ error: 'User ID is required' }, { status: 400 });
      }

      const now = Date.now();

      // Check if user is new
      const existingUser = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first();
      const isNewUser = !existingUser;

      // Upsert user
      await env.DB.prepare(`
        INSERT INTO users (id, email, display_name, photo_url, auth_provider, last_login_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          email = COALESCE(?, email),
          display_name = COALESCE(?, display_name),
          photo_url = COALESCE(?, photo_url),
          last_login_at = ?,
          updated_at = ?
      `).bind(
        id, email, display_name, photo_url, auth_provider || 'firebase', now, now,
        email, display_name, photo_url, now, now
      ).run();

      // Assign role based on email whitelist
      if (email) {
        const adminEmails = [
          'phungnguyeniufintechclub@gmail.com',
          'trang.vtae@gmail.com',
          'nhungngth03@gmail.com'
        ];
        const superAdminEmail = 'tranminhquoc0711@gmail.com';

        let assignedRole = 'user'; // default
        if (email === superAdminEmail) {
          assignedRole = 'superadmin';
        } else if (adminEmails.includes(email)) {
          assignedRole = 'admin';
        }

        // Insert or update user role
        await env.DB.prepare(`
          INSERT INTO user_roles (user_id, role_name, granted_by, granted_at)
          VALUES (?, ?, 'system', ?)
          ON CONFLICT(user_id, role_name) DO UPDATE SET granted_at = ?
        `).bind(id, assignedRole, now, now).run();
      } else if (isNewUser) {
        // No email (shouldn't happen with Firebase), assign default 'user' role
        await env.DB.prepare(`
          INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
          VALUES (?, 'user', 'system', ?)
        `).bind(id, now).run();
      }

      // Get user with preferences and role
      const user = await env.DB.prepare(`
        SELECT u.*, up.main_language, up.subtitle_languages, up.require_all_languages,
               GROUP_CONCAT(ur.role_name) as roles
        FROM users u
        LEFT JOIN user_preferences up ON u.id = up.user_id
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        WHERE u.id = ?
        GROUP BY u.id
      `).bind(id).first();

      return json(user);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Update last login
  router.post('/api/users/login', async (request, env) => {
    try {
      const body = await request.json();
      const { user_id } = body;

      if (!user_id) {
        return json({ error: 'User ID is required' }, { status: 400 });
      }

      const now = Date.now();
      await env.DB.prepare(`
        UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?
      `).bind(now, now, user_id).run();

      return json({ success: true, last_login_at: now });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get all users (admin endpoint)
  router.get('/api/users', async (request, env) => {
    try {
      const users = await env.DB.prepare(`
        SELECT * FROM v_user_profiles ORDER BY created_at DESC
      `).all();

      return json(users.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user preferences
  router.get('/api/users/:userId/preferences', async (request, env) => {
    try {
      const userId = request.params.userId;

      let prefs = await env.DB.prepare(`
        SELECT * FROM user_preferences WHERE user_id = ?
      `).bind(userId).first();

      // Create default preferences if not exist
      if (!prefs) {
        const now = Date.now();
        await env.DB.prepare(`
          INSERT INTO user_preferences (user_id, created_at, updated_at)
          VALUES (?, ?, ?)
        `).bind(userId, now, now).run();

        prefs = await env.DB.prepare(`
          SELECT * FROM user_preferences WHERE user_id = ?
        `).bind(userId).first();
      }

      return json(prefs);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Update user preferences
  router.put('/api/users/:userId/preferences', async (request, env) => {
    try {
      const userId = request.params.userId;
      const body = await request.json();

      const now = Date.now();

      // Convert array to JSON string if needed
      const subLangsJson = Array.isArray(body.subtitle_languages)
        ? JSON.stringify(body.subtitle_languages)
        : body.subtitle_languages;

      // Build update fields dynamically to avoid undefined values
      const updates = [];
      const updateValues = [];

      if (body.main_language !== undefined) {
        updates.push('main_language = ?');
        updateValues.push(body.main_language);
      }
      if (subLangsJson !== undefined) {
        updates.push('subtitle_languages = ?');
        updateValues.push(subLangsJson);
      }
      if (body.require_all_languages !== undefined) {
        updates.push('require_all_languages = ?');
        updateValues.push(body.require_all_languages);
      }
      if (body.difficulty_min !== undefined) {
        updates.push('difficulty_min = ?');
        updateValues.push(body.difficulty_min);
      }
      if (body.difficulty_max !== undefined) {
        updates.push('difficulty_max = ?');
        updateValues.push(body.difficulty_max);
      }
      if (body.auto_play !== undefined) {
        updates.push('auto_play = ?');
        updateValues.push(body.auto_play);
      }
      if (body.playback_speed !== undefined) {
        updates.push('playback_speed = ?');
        updateValues.push(body.playback_speed);
      }
      if (body.theme !== undefined) {
        updates.push('theme = ?');
        updateValues.push(body.theme);
      }
      if (body.show_romanization !== undefined) {
        updates.push('show_romanization = ?');
        updateValues.push(body.show_romanization);
      }

      // Always update timestamp
      updates.push('updated_at = ?');
      updateValues.push(now);

      // Check if preferences exist
      const existing = await env.DB.prepare(`
        SELECT id FROM user_preferences WHERE user_id = ?
      `).bind(userId).first();

      if (existing) {
        // Update existing preferences
        if (updates.length > 1) { // More than just updated_at
          await env.DB.prepare(`
            UPDATE user_preferences SET ${updates.join(', ')} WHERE user_id = ?
          `).bind(...updateValues, userId).run();
        }
      } else {
        // Insert new preferences with defaults
        await env.DB.prepare(`
          INSERT INTO user_preferences (
            user_id, main_language, subtitle_languages, require_all_languages,
            auto_play, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).bind(
          userId,
          body.main_language || 'en',
          subLangsJson || '["en"]',
          body.require_all_languages ?? 0,
          body.auto_play ?? 1,
          now,
          now
        ).run();
      }

      const prefs = await env.DB.prepare(`
        SELECT * FROM user_preferences WHERE user_id = ?
      `).bind(userId).first();

      return json(prefs);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user statistics
  router.get('/api/users/:userId/stats', async (request, env) => {
    try {
      const userId = request.params.userId;

      const stats = await env.DB.prepare(`
        SELECT * FROM v_user_stats WHERE user_id = ?
      `).bind(userId).first();

      return json(stats || {});
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user roles
  router.get('/api/users/:userId/roles', async (request, env) => {
    try {
      const userId = request.params.userId;

      const roles = await env.DB.prepare(`
        SELECT ur.role_name, r.description, r.permissions
        FROM user_roles ur
        JOIN roles r ON ur.role_name = r.name
        WHERE ur.user_id = ?
      `).bind(userId).all();

      return json(roles.results || []);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user progress details (admin endpoint)
  router.get('/api/users/:userId/progress', async (request, env) => {
    try {
      const userId = request.params.userId;

      // Get all episode stats for this user
      const episodeStats = await env.DB.prepare(`
        SELECT * FROM user_episode_stats 
        WHERE user_id = ? 
        ORDER BY last_completed_at DESC
      `).bind(userId).all();

      // Get recent card completions
      const recentCards = await env.DB.prepare(`
        SELECT * FROM user_progress 
        WHERE user_id = ? 
        ORDER BY completed_at DESC 
        LIMIT 100
      `).bind(userId).all();

      return json({
        episode_stats: episodeStats.results || [],
        recent_cards: recentCards.results || []
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Get user profile
  router.get('/api/users/:userId', async (request, env) => {
    try {
      const userId = request.params.userId;

      const user = await env.DB.prepare(`
        SELECT * FROM v_user_profiles WHERE id = ?
      `).bind(userId).first();

      if (!user) {
        return json({ error: 'User not found' }, { status: 404 });
      }

      return json(user);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Update user profile
  router.put('/api/users/:userId', async (request, env) => {
    try {
      const userId = request.params.userId;
      const body = await request.json();
      const { email, display_name, photo_url } = body;

      const now = Date.now();
      await env.DB.prepare(`
        UPDATE users 
        SET email = COALESCE(?, email),
            display_name = COALESCE(?, display_name),
            photo_url = COALESCE(?, photo_url),
            updated_at = ?
        WHERE id = ?
      `).bind(email, display_name, photo_url, now, userId).run();

      const user = await env.DB.prepare(`
        SELECT * FROM v_user_profiles WHERE id = ?
      `).bind(userId).first();

      return json(user);
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Delete user (deactivate only - set is_active to false)
  router.delete('/api/users/:userId', async (request, env) => {
    try {
      const userId = request.params.userId;

      const now = Date.now();

      // Deactivate user instead of deleting
      const userResult = await env.DB.prepare(`
        UPDATE users SET is_active = 0, updated_at = ? WHERE id = ?
      `).bind(now, userId).run();

      if (userResult.meta.changes === 0) {
        return json({ error: 'User not found' }, { status: 404 });
      }

      return json({
        success: true,
        message: 'User deactivated successfully',
        deleted: {
          user: userResult.meta.changes || 0,
          progress: 0,
          episode_stats: 0,
          study_sessions: 0,
          preferences: 0,
          roles: 0,
          logins: 0,
        }
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
