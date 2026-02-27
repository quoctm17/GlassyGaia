import { json } from '../utils/response.js';
import { hashPassword, verifyPassword, generateToken, generateUserId, generateJWT } from '../middleware/auth.js';
import { retryD1Query } from '../utils/db.js';

export function registerAuthRoutes(router) {
  router.post('/auth/signup', async (request, env) => {
    try {
      const body = await request.json();
      const { email, password, displayName } = body;

      if (!email || !password) {
        return json({ error: 'Email and password are required' }, { status: 400 });
      }

      if (password.length < 6) {
        return json({ error: 'Password must be at least 6 characters' }, { status: 400 });
      }

      // Check if email already exists
      const existing = await env.DB.prepare(`
        SELECT id FROM users WHERE email = ?
      `).bind(email.toLowerCase()).first();

      if (existing) {
        return json({ error: 'Email already registered' }, { status: 409 });
      }

      // Hash password
      const passwordHash = await hashPassword(password);

      // Generate user ID and verification token
      const userId = generateUserId();
      const verificationToken = generateToken();
      const now = Date.now();
      const tokenExpires = now + (24 * 60 * 60 * 1000); // 24 hours

      // Create user
      await env.DB.prepare(`
        INSERT INTO users (
          id, email, display_name, password_hash,
          auth_provider, email_verified, verification_token,
          verification_token_expires, is_active, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        userId, email.toLowerCase(), displayName || email.split('@')[0],
        passwordHash, 'email', 0, verificationToken,
        tokenExpires, 1, now, now
      ).run();

      // Create default preferences
      await env.DB.prepare(`
        INSERT INTO user_preferences (user_id, created_at, updated_at)
        VALUES (?, ?, ?)
      `).bind(userId, now, now).run();

      // Auto-assign default 'user' role
      await env.DB.prepare(`
        INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
        VALUES (?, 'user', 'system', ?)
      `).bind(userId, now).run();

      // Update last_login_at for immediate login after signup
      await env.DB.prepare(`
        UPDATE users SET last_login_at = ? WHERE id = ?
      `).bind(now, userId).run();

      // Get user with roles
      const userWithRoles = await env.DB.prepare(`
        SELECT u.*, GROUP_CONCAT(ur.role_name) as roles
        FROM users u
        LEFT JOIN user_roles ur ON u.id = ur.user_id
        WHERE u.id = ?
        GROUP BY u.id
      `).bind(userId).first();

      const roleNames = userWithRoles.roles ? userWithRoles.roles.split(',') : [];

      // Generate JWT token
      const jwtSecret = env.JWT_SECRET;
      if (!jwtSecret) {
        return json({ error: 'JWT secret not configured' }, { status: 500 });
      }

      const token = await generateJWT(
        userId,
        email.toLowerCase(),
        roleNames,
        jwtSecret,
        7 // 7 days expiration
      );

      return json({
        success: true,
        token: token,
        user: {
          id: userId,
          email: email.toLowerCase(),
          display_name: displayName || email.split('@')[0],
          auth_provider: 'email',
          roles: roleNames
        },
        message: 'Account created successfully. Please check your email for verification.'
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });

  // Google OAuth login
  router.post('/auth/google', async (request, env) => {
    try {
      const body = await request.json();
      const { id_token } = body;

      if (!id_token) {
        return json({ error: 'Google ID token is required' }, { status: 400 });
      }

      const clientId = env.GOOGLE_CLIENT_ID;
      const clientSecret = env.GOOGLE_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        return json({ error: 'Google OAuth not configured' }, { status: 500 });
      }

      // Verify token with Google
      const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${id_token}`;
      const verifyRes = await fetch(verifyUrl);

      if (!verifyRes.ok) {
        return json({ error: 'Invalid Google token' }, { status: 401 });
      }

      const tokenInfo = await verifyRes.json();

      // Verify audience matches our client ID
      if (tokenInfo.aud !== clientId) {
        return json({ error: 'Token audience mismatch' }, { status: 401 });
      }

      // Extract user info
      const googleId = tokenInfo.sub;
      const email = tokenInfo.email;
      const displayName = tokenInfo.name || email?.split('@')[0];
      const photoUrl = tokenInfo.picture;
      const emailVerified = tokenInfo.email_verified === 'true';

      if (!email) {
        return json({ error: 'Email not provided by Google' }, { status: 400 });
      }

      // Generate user ID from Google ID (consistent with Firebase approach)
      const userId = googleId;

      const now = Date.now();

      // Determine role based on email whitelist (before database operations)
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

      // Optimized: Use retry logic for all database operations
      // Upsert user with retry
      await retryD1Query(async () => {
        return await env.DB.prepare(`
          INSERT INTO users (id, email, display_name, photo_url, auth_provider, email_verified, last_login_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            email = COALESCE(?, email),
            display_name = COALESCE(?, display_name),
            photo_url = COALESCE(?, photo_url),
            email_verified = ?,
            last_login_at = ?,
            updated_at = ?
        `).bind(
          userId, email, displayName, photoUrl, 'google', emailVerified ? 1 : 0, now, now,
          email, displayName, photoUrl, emailVerified ? 1 : 0, now, now
        ).run();
      });

      // Insert or update user role with retry
      await retryD1Query(async () => {
        return await env.DB.prepare(`
          INSERT INTO user_roles (user_id, role_name, granted_by, granted_at)
          VALUES (?, ?, 'system', ?)
          ON CONFLICT(user_id, role_name) DO UPDATE SET granted_at = ?
        `).bind(userId, assignedRole, now, now).run();
      });

      // Get user with preferences and roles (optimized single query) with retry
      const user = await retryD1Query(async () => {
        return await env.DB.prepare(`
          SELECT u.*, up.main_language, up.subtitle_languages, up.require_all_languages,
                 GROUP_CONCAT(ur.role_name) as roles
          FROM users u
          LEFT JOIN user_preferences up ON u.id = up.user_id
          LEFT JOIN user_roles ur ON u.id = ur.user_id
          WHERE u.id = ?
          GROUP BY u.id
        `).bind(userId).first();
      });

      // Parse roles from comma-separated string
      const roleNames = user.roles ? user.roles.split(',') : [];

      // Generate JWT token
      const jwtSecret = env.JWT_SECRET;
      if (!jwtSecret) {
        return json({ error: 'JWT secret not configured' }, { status: 500 });
      }

      const token = await generateJWT(
        userId,
        email,
        roleNames,
        jwtSecret,
        7 // 7 days expiration
      );

      return json({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          photo_url: user.photo_url,
          auth_provider: 'google',
          roles: roleNames
        }
      });
    } catch (e) {
      console.error('Google OAuth error:', e);
      const errorMsg = e?.message || String(e);
      
      // Provide more helpful error messages
      if (errorMsg.includes('D1_ERROR') || errorMsg.includes('overloaded') || errorMsg.includes('queued for too long')) {
        return json({ 
          error: 'Database temporarily unavailable. Please try again in a few moments.',
          details: 'D1 database is experiencing high load. Retrying...'
        }, { status: 503 }); // 503 Service Unavailable
      }
      
      return json({ 
        error: errorMsg || 'Authentication failed',
        details: process.env.NODE_ENV === 'development' ? e.stack : undefined
      }, { status: 500 });
    }
  });

  // Login with email/password
  router.post('/auth/login', async (request, env) => {
    try {
      const body = await request.json();
      const { email, password } = body;

      if (!email || !password) {
        return json({ error: 'Email and password are required' }, { status: 400 });
      }

      // Find user by email or phone
      const user = await env.DB.prepare(`
        SELECT * FROM users 
        WHERE (email = ? OR phone_number = ?) 
        AND auth_provider = 'email'
      `).bind(email.toLowerCase(), email).first();

      if (!user) {
        return json({ error: 'Invalid credentials' }, { status: 401 });
      }

      if (!user.is_active) {
        return json({ error: 'Account is deactivated' }, { status: 403 });
      }

      if (user.account_locked) {
        const now = Date.now();
        if (user.lockout_until && user.lockout_until > now) {
          return json({ error: 'Account is temporarily locked. Please try again later.' }, { status: 403 });
        }
        // Unlock if lockout period has expired
        await env.DB.prepare(`
          UPDATE users SET account_locked = 0, lockout_until = NULL, failed_login_attempts = 0
          WHERE id = ?
        `).bind(user.id).run();
      }

      // Verify password
      const isValid = await verifyPassword(password, user.password_hash);

      if (!isValid) {
        // Increment failed attempts
        const failedAttempts = (user.failed_login_attempts || 0) + 1;
        const now = Date.now();

        if (failedAttempts >= 5) {
          // Lock account for 30 minutes
          const lockoutUntil = now + (30 * 60 * 1000);
          await env.DB.prepare(`
            UPDATE users 
            SET failed_login_attempts = ?, account_locked = 1, lockout_until = ?
            WHERE id = ?
          `).bind(failedAttempts, lockoutUntil, user.id).run();

          return json({ error: 'Too many failed attempts. Account locked for 30 minutes.' }, { status: 429 });
        } else {
          await env.DB.prepare(`
            UPDATE users SET failed_login_attempts = ? WHERE id = ?
          `).bind(failedAttempts, user.id).run();

          return json({ error: 'Invalid credentials' }, { status: 401 });
        }
      }

      // Success - reset failed attempts and update last login
      const now = Date.now();
      await env.DB.prepare(`
        UPDATE users 
        SET failed_login_attempts = 0, last_login_at = ?, updated_at = ?
        WHERE id = ?
      `).bind(now, now, user.id).run();

      // Log login
      await env.DB.prepare(`
        INSERT INTO user_logins (user_id, login_method, success, created_at)
        VALUES (?, ?, ?, ?)
      `).bind(user.id, 'email', 1, now).run();

      // Get user roles
      const rolesResult = await env.DB.prepare(`
        SELECT role_name FROM user_roles WHERE user_id = ?
      `).bind(user.id).all();

      const roleNames = (rolesResult.results || []).map(r => r.role_name);

      // Generate JWT token
      const jwtSecret = env.JWT_SECRET;
      if (!jwtSecret) {
        return json({ error: 'JWT secret not configured' }, { status: 500 });
      }

      const token = await generateJWT(
        user.id,
        user.email,
        roleNames,
        jwtSecret,
        7 // 7 days expiration
      );

      return json({
        success: true,
        token: token,
        user: {
          id: user.id,
          email: user.email,
          display_name: user.display_name,
          photo_url: user.photo_url,
          auth_provider: user.auth_provider,
          roles: roleNames
        }
      });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  });
}
