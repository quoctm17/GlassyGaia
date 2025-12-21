// Cloudflare Worker (JavaScript) compatible with Dashboard Quick Edit and wrangler
// Bindings required: DB (D1), MEDIA_BUCKET (R2)

function withCors(headers = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cross-Origin-Opener-Policy': 'unsafe-none',
    'Cross-Origin-Embedder-Policy': 'unsafe-none',
    ...headers,
  };
}

function buildFtsQuery(q, language) {
  const cleaned = (q || '').trim();
  if (!cleaned) return '';
  
  // Detect if query contains Japanese characters (Hiragana, Katakana, or Kanji)
  const hasJapanese = /[\u3040-\u309F\u30A0-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(cleaned);
  
  // For Japanese: normalize whitespace AND remove furigana brackets from query
  // User might search "番線" but DB has "番線[ばんせん]" - we need to match the base kanji
  // This handles cases like "番線に" vs "番線 に" or "番線[ばんせん]に" in subtitle text
  let normalized = (hasJapanese || language === 'ja') ? cleaned.replace(/\s+/g, '') : cleaned;
  
  // For Japanese: also remove any furigana brackets from the query itself
  // e.g., user searches "番線[ばんせん]" -> normalize to "番線"
  if (hasJapanese || language === 'ja') {
    normalized = normalized.replace(/\[[^\]]+\]/g, '');
  }
  
  // If the user wraps text in quotes, treat it as an exact phrase
  const quotedMatch = normalized.match(/^\s*"([\s\S]+)"\s*$/);
  if (quotedMatch) {
    const phrase = quotedMatch[1].replace(/["']/g, '').replace(/[^\p{L}\p{N}\s]+/gu, ' ').trim().replace(/\s+/g, ' ');
    return phrase ? `"${phrase}"` : '';
  }
  
  // Tokenize: For CJK, each character is a token. For others, split by whitespace.
  // Japanese/Chinese: return empty string to trigger LIKE-based search instead of FTS
  // FTS5 doesn't handle CJK phrase search well, so we use database LIKE for accuracy
  if (hasJapanese || language === 'ja') {
    // Return special marker to indicate we should use LIKE search
    // The search endpoint will detect this and use LIKE '%query%' instead of FTS
    return ''; // Empty FTS query triggers LIKE fallback in search endpoint
  }
  
  // Non-Japanese: tokenize by whitespace
  const tokens = normalized
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
  if (!tokens.length) return '';
  
  if (tokens.length === 1) {
    const t = escapeFtsToken(tokens[0]);
    if (!t) return '';
    // Exact word matching (quoted) to avoid substring matches
    return `"${t}"`;
  }
  
  // Multi-word non-Japanese: exact phrase matching
  const phrase = tokens.map(escapeFtsToken).join(' ');
  return phrase ? `"${phrase}"` : '';
}

function escapeFtsToken(t) {
  // Remove quotes and stray punctuation that might slip through
  return String(t).replace(/["'.,;:!?()\[\]{}]/g, '');
}

// Japanese helpers: normalize Katakana to Hiragana and full-width forms
function kataToHira(s) {
  return String(s).replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}
function normalizeJaInput(s) {
  try {
    // NFKC to normalize width; then convert Katakana to Hiragana
    return kataToHira(String(s).normalize('NFKC'));
  } catch {
    return kataToHira(String(s));
  }
}

function hasHanAndKana(s) {
  return /\p{Script=Han}/u.test(s) && /[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(s);
}

function kanaOnlyString(s) {
  // Keep only Hiragana/Katakana and ASCII letters/numbers for safety
  return String(s).replace(/[^\p{Script=Hiragana}\p{Script=Katakana}\p{L}\p{N}\s]/gu, '').trim();
}

// Expand Japanese index text by adding mixed kanji/kana tokens from bracketed furigana: 例) 黒川[くろかわ]
// Also normalizes whitespace for consistent FTS matching
// IMPORTANT: Indexes BOTH the base text (without brackets) AND the reading separately
// e.g., "番線[ばんせん]" -> indexes: "番線" (base) + "ばんせん" (reading) + mixed variants
function expandJaIndexText(text) {
  // First, normalize whitespace (remove all spaces) for consistent FTS matching
  const src = String(text || '').replace(/\s+/g, '');
  
  const extra = [];
  const re = /(\p{Script=Han}+[\p{Script=Han}・・]*)\[([\p{Script=Hiragana}\p{Script=Katakana}]+)\]/gu;
  let baseText = src; // text with brackets removed
  let m;
  
  while ((m = re.exec(src)) !== null) {
    const kan = m[1];
    const rawKana = m[2];
    const hira = normalizeJaInput(rawKana);
    if (!kan || !hira) continue;
    
    // Add base kanji (without brackets) and reading separately to index
    extra.push(kan);
    extra.push(hira);
    
    // Add mixed kanji/kana variants for partial matching
    const firstKan = kan[0];
    const lastKan = kan[kan.length - 1];
    for (let i = 1; i < hira.length; i++) {
      const pref = hira.slice(0, i);
      const suff = hira.slice(i);
      extra.push(pref + lastKan);
      extra.push(firstKan + suff);
    }
  }
  
  // Remove all brackets from base text so "番線[ばんせん]" becomes "番線"
  baseText = baseText.replace(/\[[^\]]+\]/g, '');
  
  if (!extra.length) return baseText;
  
  // Deduplicate extras to keep FTS text compact
  const uniq = Array.from(new Set(extra.filter(Boolean)));
  
  // Index format: base_text + space + all_variants
  // This allows searching by base kanji OR reading OR mixed
  return `${baseText} ${uniq.join(' ')}`;
}
function json(data, init = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: withCors({ 'Content-Type': 'application/json', ...(init.headers || {}) }) });
}

// Normalize Chinese text by removing pinyin brackets [pinyin] for search
// Example: "请[qǐng]问[wèn]" -> "请问"
function normalizeChineseTextForSearch(text) {
  if (!text) return text;
  // Remove all [pinyin] patterns
  return text.replace(/\[[^\]]+\]/g, '');
}

// Map level to numeric index for range filtering
function getLevelIndex(level, language) {
  const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  if (!level) return -1;
  const upper = level.toUpperCase();
  
  // Try CEFR first
  const cefrIdx = CEFR.indexOf(upper);
  if (cefrIdx >= 0) return cefrIdx;
  
  // Try JLPT
  const jlptIdx = JLPT.indexOf(upper);
  if (jlptIdx >= 0) return jlptIdx;
  
  // Try HSK (numeric)
  const hskIdx = HSK.indexOf(level);
  if (hskIdx >= 0) return hskIdx;
  
  return -1;
}

// Compare two levels within the same framework
// Returns: -1 if level1 < level2, 0 if equal, 1 if level1 > level2
function compareLevels(level1, level2, framework) {
  const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
  const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  const fwUpper = framework ? String(framework).toUpperCase() : '';
  let order = [];
  
  if (fwUpper === 'CEFR') {
    order = CEFR;
  } else if (fwUpper === 'JLPT') {
    order = JLPT;
  } else if (fwUpper === 'HSK') {
    order = HSK;
  } else {
    // Try to detect framework from levels
    const l1Upper = String(level1).toUpperCase();
    const l2Upper = String(level2).toUpperCase();
    
    if (CEFR.includes(l1Upper) && CEFR.includes(l2Upper)) {
      order = CEFR;
    } else if (JLPT.includes(l1Upper) && JLPT.includes(l2Upper)) {
      order = JLPT;
    } else if (HSK.includes(String(level1)) && HSK.includes(String(level2))) {
      order = HSK;
    } else {
      return 0; // Cannot compare
    }
  }
  
  const idx1 = order.indexOf(String(level1).toUpperCase());
  const idx2 = order.indexOf(String(level2).toUpperCase());
  
  if (idx1 === -1 || idx2 === -1) return 0;
  return idx1 - idx2;
}

// Get framework from main language
function getFrameworkFromLanguage(language) {
  if (!language) return 'CEFR';
  const langLower = String(language).toLowerCase();
  if (langLower === 'ja' || langLower === 'japanese') return 'JLPT';
  if (langLower === 'zh' || langLower === 'chinese' || langLower === 'zh-cn' || langLower === 'zh-tw') return 'HSK';
  return 'CEFR'; // Default to CEFR for English and other languages
}

// ==================== AUTHENTICATION HELPERS ====================

// Hash password using PBKDF2
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const passwordBuffer = encoder.encode(password);
  
  const key = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  
  const hashBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    key,
    256
  );
  
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const saltArray = Array.from(salt);
  
  const combined = saltArray.concat(hashArray);
  return btoa(String.fromCharCode(...combined));
}

// Verify password against hash
async function verifyPassword(password, hash) {
  try {
    const encoder = new TextEncoder();
    const combined = Uint8Array.from(atob(hash), c => c.charCodeAt(0));
    
    const salt = combined.slice(0, 16);
    const storedHash = combined.slice(16);
    
    const passwordBuffer = encoder.encode(password);
    const key = await crypto.subtle.importKey(
      'raw',
      passwordBuffer,
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    
    const hashBuffer = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: 100000,
        hash: 'SHA-256'
      },
      key,
      256
    );
    
    const hashArray = new Uint8Array(hashBuffer);
    
    if (hashArray.length !== storedHash.length) return false;
    
    let isValid = true;
    for (let i = 0; i < hashArray.length; i++) {
      if (hashArray[i] !== storedHash[i]) {
        isValid = false;
      }
    }
    
    return isValid;
  } catch (e) {
    return false;
  }
}

// Generate random token
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate user ID
function generateUserId() {
  return `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '');

    try {
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: withCors() });
      }

      // ==================== AUTHENTICATION ENDPOINTS ====================
      
      // Sign up with email/password
      if (path === '/auth/signup' && request.method === 'POST') {
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
          
          return json({
            success: true,
            user: {
              id: userId,
              email: email.toLowerCase(),
              display_name: displayName || email.split('@')[0],
              auth_provider: 'email',
            },
            message: 'Account created successfully. Please check your email for verification.'
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Google OAuth login
      if (path === '/auth/google' && request.method === 'POST') {
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
          
          // Check if user exists
          const existingUser = await env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(userId).first();
          const isNewUser = !existingUser;
          
          // Upsert user
          await env.DB.prepare(`
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
            `).bind(userId, assignedRole, now, now).run();
          } else if (isNewUser) {
            // Assign default 'user' role
            await env.DB.prepare(`
              INSERT OR IGNORE INTO user_roles (user_id, role_name, granted_by, granted_at)
              VALUES (?, 'user', 'system', ?)
            `).bind(userId, now).run();
          }
          
          // Get user with preferences and roles
          const user = await env.DB.prepare(`
            SELECT u.*, up.main_language, up.subtitle_languages, up.require_all_languages,
                   GROUP_CONCAT(ur.role_name) as roles
            FROM users u
            LEFT JOIN user_preferences up ON u.id = up.user_id
            LEFT JOIN user_roles ur ON u.id = ur.user_id
            WHERE u.id = ?
            GROUP BY u.id
          `).bind(userId).first();
          
          // Parse roles from comma-separated string
          const roleNames = user.roles ? user.roles.split(',') : [];
          
          return json({
            success: true,
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
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Login with email/password
      if (path === '/auth/login' && request.method === 'POST') {
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
          
          return json({
            success: true,
            user: {
              id: user.id,
              email: user.email,
              display_name: user.display_name,
              photo_url: user.photo_url,
              auth_provider: user.auth_provider,
              role: user.role,
              is_admin: user.is_admin,
            }
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Search API: FTS-backed card subtitles with caching + main_language filtering + fallback listing
      if (path === '/api/search' && request.method === 'GET') {
        try {
          const q = url.searchParams.get('q') || '';
          const mainLanguage = url.searchParams.get('main_language');
          const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || '';
          const contentIdsCsv = url.searchParams.get('content_ids') || '';
          const page = Math.max(parseInt(url.searchParams.get('page') || '1', 10), 1);
          const size = Math.min(Math.max(parseInt(url.searchParams.get('size') || '50', 10), 1), 100);
          const offset = (page - 1) * size;

          const basePublic = env.R2_PUBLIC_BASE || '';
          const makeMediaUrl = (k) => {
            if (!k) return null;
            return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
          };

          // Parse subtitle languages into array
          const subtitleLangsArr = subtitleLanguagesCsv 
            ? Array.from(new Set(subtitleLanguagesCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const subtitleLangsCount = subtitleLangsArr.length;

          // Parse content IDs into array
          const contentIdsArr = contentIdsCsv
            ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const contentIdsCount = contentIdsArr.length;

          // Parse difficulty filters
          const difficultyMinRaw = url.searchParams.get('difficulty_min');
          const difficultyMaxRaw = url.searchParams.get('difficulty_max');
          const difficultyMin = difficultyMinRaw ? Number(difficultyMinRaw) : null;
          const difficultyMax = difficultyMaxRaw ? Number(difficultyMaxRaw) : null;
          const hasDifficultyFilter = (difficultyMin !== null && difficultyMin > 0) || (difficultyMax !== null && difficultyMax < 100);

          // Parse level filters
          const levelMinRaw = url.searchParams.get('level_min');
          const levelMaxRaw = url.searchParams.get('level_max');
          const levelMin = levelMinRaw ? String(levelMinRaw).trim() : null;
          const levelMax = levelMaxRaw ? String(levelMaxRaw).trim() : null;
          const hasLevelFilter = levelMin !== null || levelMax !== null;
          const framework = getFrameworkFromLanguage(mainLanguage);

          // Build allowed levels list for level filter
          let allowedLevels = null;
          if (hasLevelFilter) {
            const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
            const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
            const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
            
            let levelOrder = [];
            if (framework === 'CEFR') levelOrder = CEFR;
            else if (framework === 'JLPT') levelOrder = JLPT;
            else if (framework === 'HSK') levelOrder = HSK;
            
            if (levelOrder.length > 0) {
              const minIdx = levelMin ? levelOrder.indexOf(levelMin.toUpperCase()) : 0;
              const maxIdx = levelMax ? levelOrder.indexOf(levelMax.toUpperCase()) : levelOrder.length - 1;
              if (minIdx >= 0 && maxIdx >= 0 && minIdx <= maxIdx) {
                allowedLevels = levelOrder.slice(minIdx, maxIdx + 1);
              }
            }
          }

          // NOTE: Text search (q=...) is handled by the dedicated /search endpoint using FTS,
          // to avoid heavy queries inside this paginated /api/search. Here we ignore q
          // and only filter by main_language, subtitle_languages and content_ids.
          const hasTextQuery = false;
          const ftsQuery = '';
          const useLikeSearch = false;

          let items = [];
          let total = 0;

          // Build WHERE clause with content_ids filter and text search
          // Use positional placeholders (?) and bind in order
          const contentIdsPlaceholders = contentIdsCount > 0 
            ? contentIdsArr.map(() => '?').join(',')
            : '';

          // Build query with FTS or LIKE search
          let textSearchCondition = '';
          if (hasTextQuery) {
            if (useLikeSearch) {
              // LIKE search for Japanese/CJK (normalize query)
              textSearchCondition = `
                AND EXISTS (
                  SELECT 1 FROM card_subtitles cs
                  WHERE cs.card_id = c.id
                    AND cs.text LIKE ?
                )
              `;
            } else {
              // FTS5 search for non-CJK languages
              // Restrict by subtitle language to reduce search space and CPU
              textSearchCondition = `
                AND EXISTS (
                  SELECT 1 FROM card_subtitles_fts
                  WHERE card_subtitles_fts.card_id = c.id
                    AND card_subtitles_fts.language = ?
                    AND card_subtitles_fts MATCH ?
                )
              `;
            }
          }

          // Simple query: get cards from content_items with matching main_language
          // When subtitle_languages provided: filter cards that have ALL selected subtitle languages
          // When content_ids provided: filter cards that belong to selected content items
          // When text query provided: filter cards that match text in subtitles (FTS or LIKE)
          // When no subtitle_languages: return all cards matching main_language (subtitles optional)
          // Use positional placeholders (?) and bind in order
          const stmt = `
            WITH filtered_cards AS (
              SELECT DISTINCT c.id AS card_id
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE (? IS NULL OR ci.main_language = ?)
                ${subtitleLangsCount > 0 ? `
                AND (
                  SELECT COUNT(DISTINCT cs.language)
                  FROM card_subtitles cs
                  WHERE cs.card_id = c.id
                    AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                ) = ?
                ` : ''}
                ${contentIdsCount > 0 ? `
                AND ci.slug IN (${contentIdsPlaceholders})
                ` : ''}
                ${hasDifficultyFilter ? `AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?` : ''}
                ${hasLevelFilter && allowedLevels && allowedLevels.length > 0 ? `AND EXISTS (
                  SELECT 1 FROM card_difficulty_levels cdl
                  WHERE cdl.card_id = c.id
                    AND cdl.framework = ?
                    AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
                )` : ''}
                ${textSearchCondition}
            )
            SELECT
              c.id AS card_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.image_key,
              c.audio_key,
              c.difficulty_score,
              e.slug AS episode_slug,
              e.episode_number,
              ci.slug AS content_slug,
              ci.main_language AS content_main_language,
              ci.title AS content_title
            FROM filtered_cards fc
            JOIN cards c ON c.id = fc.card_id
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            ORDER BY ci.slug, e.episode_number, c.card_number
            LIMIT ? OFFSET ?;
          `;

          const countStmt = `
            SELECT COUNT(DISTINCT c.id) AS total
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE (? IS NULL OR ci.main_language = ?)
              ${subtitleLangsCount > 0 ? `
              AND (
                SELECT COUNT(DISTINCT cs.language)
                FROM card_subtitles cs
                WHERE cs.card_id = c.id
                  AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              ) = ?
              ` : ''}
              ${contentIdsCount > 0 ? `
              AND ci.slug IN (${contentIdsPlaceholders})
              ` : ''}
              ${hasDifficultyFilter ? `AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?` : ''}
              ${hasLevelFilter && allowedLevels && allowedLevels.length > 0 ? `AND EXISTS (
                SELECT 1 FROM card_difficulty_levels cdl
                WHERE cdl.card_id = c.id
                  AND cdl.framework = ?
                  AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
              )` : ''}
              ${textSearchCondition};
          `;

          // Build params array in order:
          // 1. mainLanguage
          // 2. subtitleLangsCount (if any)
          // 3. subtitleLangs (if any)
          // 4. contentIds (if any)
          // 5. textQuery (if any)
          // 6. size (LIMIT)
          // 7. offset (OFFSET)
          let params = [];
          let countParams = [];
          
          // 1. Add mainLanguage (used twice: once for NULL check, once for comparison)
          params.push(mainLanguage || null);
          params.push(mainLanguage || null);
          countParams.push(mainLanguage || null);
          countParams.push(mainLanguage || null);
          
          // 2. Add subtitle language params if needed
          // Order MUST match the SQL:
          //   ... cs.language IN (?, ?, ...) ) = ?
          // => first all languages, then the required count
          if (subtitleLangsCount > 0) {
            // languages go first
            params.push(...subtitleLangsArr);
            // then the expected count
            params.push(subtitleLangsCount);

            countParams.push(...subtitleLangsArr);
            countParams.push(subtitleLangsCount);
          }
          
          // 3. Add content IDs if needed
          if (contentIdsCount > 0) {
            params.push(...contentIdsArr);
            countParams.push(...contentIdsArr);
          }
          
          // 4. Add difficulty filters if needed
          if (hasDifficultyFilter) {
            params.push(difficultyMin !== null ? difficultyMin : 0);
            params.push(difficultyMax !== null ? difficultyMax : 100);
            countParams.push(difficultyMin !== null ? difficultyMin : 0);
            countParams.push(difficultyMax !== null ? difficultyMax : 100);
          }
          
          // 5. Add level filters if needed
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            params.push(framework);
            params.push(...allowedLevels);
            countParams.push(framework);
            countParams.push(...allowedLevels);
          }
          
          // 6. Add text search query if needed
          if (hasTextQuery) {
            if (useLikeSearch) {
              // LIKE search: use normalized query with wildcards
              const likeQuery = `%${q.trim().replace(/\s+/g, '').replace(/\[[^\]]+\]/g, '')}%`;
              params.push(likeQuery);
              countParams.push(likeQuery);
            } else {
              // FTS search: use built FTS query
              const langForFts = (mainLanguage || '').toLowerCase() || null;
              // language filter then FTS query string
              params.push(langForFts);
              params.push(ftsQuery);
              countParams.push(langForFts);
              countParams.push(ftsQuery);
            }
          }
          
          // 7. Add pagination params (only for main query, not count)
          params.push(size);
          params.push(offset);

          // Execute queries
          const [cardsResult, countResult] = await Promise.all([
            env.DB.prepare(stmt).bind(...params).all(),
            env.DB.prepare(countStmt).bind(...countParams).first()
          ]);

          total = countResult?.total || 0;
          const cardRows = cardsResult.results || [];

          if (cardRows.length > 0) {
            // Fetch subtitles for all matched cards
            const cardIds = cardRows.map(r => r.card_id);
            const placeholders = cardIds.map((_, i) => `?${i + 1}`).join(',');
            const subsStmt = `
              SELECT card_id, language, text
              FROM card_subtitles
              WHERE card_id IN (${placeholders})
            `;
            const subsResult = await env.DB.prepare(subsStmt).bind(...cardIds).all();
            const subsMap = new Map();
            
            for (const row of (subsResult.results || [])) {
              if (!subsMap.has(row.card_id)) {
                subsMap.set(row.card_id, {});
              }
              subsMap.get(row.card_id)[row.language] = row.text;
            }

            // Fetch difficulty levels for all matched cards
            const levelsStmt = `
              SELECT card_id, framework, level, language
              FROM card_difficulty_levels
              WHERE card_id IN (${placeholders})
            `;
            const levelsResult = await env.DB.prepare(levelsStmt).bind(...cardIds).all();
            const levelsMap = new Map();
            
            for (const row of (levelsResult.results || [])) {
              if (!levelsMap.has(row.card_id)) {
                levelsMap.set(row.card_id, []);
              }
              levelsMap.get(row.card_id).push({
                framework: row.framework,
                level: row.level,
                language: row.language || null
              });
            }

            // Map cards to response format
            items = cardRows.map(r => ({
              card_id: r.card_id,
              content_slug: r.content_slug,
              content_title: r.content_title,
              episode_slug: r.episode_slug,
              episode_number: r.episode_number,
              card_number: r.card_number,
              start_time: r.start_time,
              end_time: r.end_time,
              image_url: makeMediaUrl(r.image_key),
              audio_url: makeMediaUrl(r.audio_key),
              difficulty_score: r.difficulty_score,
              text: '', // Will be filled from subtitle
              subtitle: subsMap.get(r.card_id) || {},
              levels: levelsMap.get(r.card_id) || undefined
            }));
          }

          const response = json({ items, total, page, size });
          return response;

        } catch (e) {
          console.error('Search error:', e);
          return json({ error: 'search_failed', message: String(e) }, { status: 500 });
        }
      }

      // Get card counts per content item (for ContentSelector)
      if (path === '/api/search/counts' && request.method === 'GET') {
        try {
          const mainLanguage = url.searchParams.get('main_language');
          const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || '';
          const contentIdsCsv = url.searchParams.get('content_ids') || '';
          const qRaw = url.searchParams.get('q') || '';
          const q = qRaw.trim();

          // Parse subtitle languages into array
          const subtitleLangsArr = subtitleLanguagesCsv 
            ? Array.from(new Set(subtitleLanguagesCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const subtitleLangsCount = subtitleLangsArr.length;

          // Parse content ids
          const contentIdsArr = contentIdsCsv
            ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const contentIdsCount = contentIdsArr.length;

          // Parse difficulty filters
          const difficultyMinRaw = url.searchParams.get('difficulty_min');
          const difficultyMaxRaw = url.searchParams.get('difficulty_max');
          const difficultyMin = difficultyMinRaw ? Number(difficultyMinRaw) : null;
          const difficultyMax = difficultyMaxRaw ? Number(difficultyMaxRaw) : null;
          const hasDifficultyFilter = (difficultyMin !== null && difficultyMin > 0) || (difficultyMax !== null && difficultyMax < 100);

          // Parse level filters
          const levelMinRaw = url.searchParams.get('level_min');
          const levelMaxRaw = url.searchParams.get('level_max');
          const levelMin = levelMinRaw ? String(levelMinRaw).trim() : null;
          const levelMax = levelMaxRaw ? String(levelMaxRaw).trim() : null;
          const hasLevelFilter = levelMin !== null || levelMax !== null;
          const framework = getFrameworkFromLanguage(mainLanguage);

          // Build allowed levels list for level filter
          let allowedLevels = null;
          if (hasLevelFilter) {
            const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
            const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
            const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
            
            let levelOrder = [];
            if (framework === 'CEFR') levelOrder = CEFR;
            else if (framework === 'JLPT') levelOrder = JLPT;
            else if (framework === 'HSK') levelOrder = HSK;
            
            if (levelOrder.length > 0) {
              const minIdx = levelMin ? levelOrder.indexOf(levelMin.toUpperCase()) : 0;
              const maxIdx = levelMax ? levelOrder.indexOf(levelMax.toUpperCase()) : levelOrder.length - 1;
              if (minIdx >= 0 && maxIdx >= 0 && minIdx <= maxIdx) {
                allowedLevels = levelOrder.slice(minIdx, maxIdx + 1);
              }
            }
          }

          // If there is a text query, use FTS/LIKE to compute counts for the matching cards
          if (q) {
            const mainCanon = mainLanguage ? String(mainLanguage).toLowerCase() : null;
            const ftsQuery = buildFtsQuery(q, mainLanguage || '');

            // If FTS not applicable (e.g. Japanese query), fall back to CJK LIKE matching
            const isCjkQuery = /[\u3040-\u30FF\u3400-\u9FFF]/u.test(q);
            if (ftsQuery) {
              let sql = `
                SELECT 
                  ci.slug AS content_id,
                  COUNT(DISTINCT c.id) AS count
                FROM card_subtitles_fts
                JOIN cards c ON c.id = card_subtitles_fts.card_id
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE card_subtitles_fts MATCH ?`;
              const params = [ftsQuery];

              if (mainCanon) {
                // Search only in main language subtitles and main_language content
                sql += ' AND LOWER(card_subtitles_fts.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)';
                params.push(mainCanon, mainCanon);
              }
              if (subtitleLangsCount > 0) {
                // Require that card has all selected subtitle languages (filter layer)
                sql += ` AND (
                  SELECT COUNT(DISTINCT cs.language)
                  FROM card_subtitles cs
                  WHERE cs.card_id = c.id
                    AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                ) = ?`;
                params.push(...subtitleLangsArr, subtitleLangsCount);
              }
              if (contentIdsCount > 0) {
                sql += ` AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`;
                params.push(...contentIdsArr);
              }
              sql += ' GROUP BY ci.slug';

              const det = await env.DB.prepare(sql).bind(...params).all();
              const countsMap = {};
              for (const row of (det.results || [])) {
                countsMap[row.content_id] = row.count || 0;
              }
              return json({ counts: countsMap });
            } else if (isCjkQuery) {
              // CJK fallback: LIKE search on subtitles
              // Check if this is a Chinese query
              const isChineseQuery = mainLanguage && (mainLanguage.toLowerCase() === 'zh' || mainLanguage.toLowerCase() === 'zh_trad' || mainLanguage.toLowerCase() === 'zh_hans' || mainLanguage.toLowerCase() === 'zh-cn' || mainLanguage.toLowerCase() === 'zh-tw' || mainLanguage.toLowerCase() === 'chinese') || /[\u4E00-\u9FFF]/.test(q);
              
              // For Chinese, normalize query by removing any brackets
              const normalizedQuery = isChineseQuery ? normalizeChineseTextForSearch(q) : q;
              
              // Build pattern for Chinese: allow optional brackets between characters
              let likePattern;
              if (isChineseQuery && normalizedQuery.length > 0) {
                const chars = normalizedQuery.split('');
                likePattern = '%' + chars.join('%[%]%') + '%';
              } else {
                likePattern = `%${normalizedQuery}%`;
              }
              
              let sql = `
                SELECT 
                  ci.slug AS content_id,
                  COUNT(DISTINCT c.id) AS count
                FROM card_subtitles cs
                JOIN cards c ON c.id = cs.card_id
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE cs.text LIKE ?`;
              const params = [likePattern];
              if (mainCanon) {
                // Search only in main language subtitles and main_language content
                sql += ' AND LOWER(cs.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)';
                params.push(mainCanon, mainCanon);
              }
              if (subtitleLangsCount > 0) {
                // Require that card has all selected subtitle languages (filter layer)
                sql += ` AND (
                  SELECT COUNT(DISTINCT cs2.language)
                  FROM card_subtitles cs2
                  WHERE cs2.card_id = c.id
                    AND cs2.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                ) = ?`;
                params.push(...subtitleLangsArr, subtitleLangsCount);
              }
              if (contentIdsCount > 0) {
                sql += ` AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`;
                params.push(...contentIdsArr);
              }
              if (hasDifficultyFilter) {
                sql += ' AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?';
                params.push(difficultyMin !== null ? difficultyMin : 0);
                params.push(difficultyMax !== null ? difficultyMax : 100);
              }
              if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
                sql += ` AND EXISTS (
                  SELECT 1 FROM card_difficulty_levels cdl
                  WHERE cdl.card_id = c.id
                    AND cdl.framework = ?
                    AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
                )`;
                params.push(framework);
                params.push(...allowedLevels);
              }
              sql += ' GROUP BY ci.slug';

              const det = await env.DB.prepare(sql).bind(...params).all();
              const countsMap = {};
              for (const row of (det.results || [])) {
                countsMap[row.content_id] = row.count || 0;
              }
              return json({ counts: countsMap });
            } else {
              // Non-CJK query but FTS disabled: no matches
              return json({ counts: {} });
            }
          }

          // No text query: simple counts by main_language / subtitle_languages / content_ids
          // Use positional placeholders for easier binding
          const countsWhere = [];
          const countsParams = [];
          
          // Main language filter
          countsWhere.push('(? IS NULL OR ci.main_language = ?)');
          countsParams.push(mainLanguage || null);
          countsParams.push(mainLanguage || null);
          
          // Subtitle languages filter
          if (subtitleLangsCount > 0) {
            countsWhere.push(`(
              SELECT COUNT(DISTINCT cs.language)
              FROM card_subtitles cs
              WHERE cs.card_id = c.id
                AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
            ) = ?`);
            countsParams.push(...subtitleLangsArr);
            countsParams.push(subtitleLangsCount);
          }
          
          // Content IDs filter
          if (contentIdsCount > 0) {
            countsWhere.push(`ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`);
            countsParams.push(...contentIdsArr);
          }
          
          // Difficulty filter
          if (hasDifficultyFilter) {
            countsWhere.push('c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?');
            countsParams.push(difficultyMin !== null ? difficultyMin : 0);
            countsParams.push(difficultyMax !== null ? difficultyMax : 100);
          }
          
          // Level filter
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            countsWhere.push(`EXISTS (
              SELECT 1 FROM card_difficulty_levels cdl
              WHERE cdl.card_id = c.id
                AND cdl.framework = ?
                AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
            )`);
            countsParams.push(framework);
            countsParams.push(...allowedLevels);
          }

          const countsStmt = `
            SELECT 
              ci.slug AS content_id,
              COUNT(DISTINCT c.id) AS count
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE ${countsWhere.join('\n              AND ')}
            GROUP BY ci.slug
          `;

          const countsResult = await env.DB.prepare(countsStmt).bind(...countsParams).all();
          const countsMap = {};
          for (const row of (countsResult.results || [])) {
            countsMap[row.content_id] = row.count || 0;
          }
          return json({ counts: countsMap });

        } catch (e) {
          console.error('Counts error:', e);
          return json({ error: 'counts_failed', message: String(e) }, { status: 500 });
        }
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

      // 1b) Batch sign upload: accepts array of {path, contentType} and returns array of signed URLs
      // Reduces round-trips for bulk uploads (e.g., 1000 files from 1000 requests to ~10 batched requests)
      if (path === '/r2/sign-upload-batch' && request.method === 'POST') {
        const body = await request.json();
        const items = body.items; // Array of {path, contentType?}
        if (!Array.isArray(items) || items.length === 0) {
          return json({ error: 'Missing or empty items array' }, { status: 400 });
        }
        const urls = items.map(item => {
          const key = item.path;
          const contentType = item.contentType || 'application/octet-stream';
          if (!key) return null;
          return {
            path: key,
            url: url.origin + '/r2/upload?key=' + encodeURIComponent(key) + '&ct=' + encodeURIComponent(contentType)
          };
        }).filter(Boolean);
        return json({ urls });
      }

      // 2) PUT upload proxy: actually store into R2
      if (path === '/r2/upload' && request.method === 'PUT') {
        const key = url.searchParams.get('key');
        const ct = url.searchParams.get('ct') || 'application/octet-stream';
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        await env.MEDIA_BUCKET.put(key, request.body, { httpMetadata: { contentType: ct } });
        return json({ ok: true, key });
      }

      // 2c) Multipart upload endpoints for large files (video)
      // INIT: POST /r2/multipart/init { key, contentType }
      if (path === '/r2/multipart/init' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key;
          const contentType = body.contentType || 'application/octet-stream';
          if (!key) return json({ error: 'Missing key' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.createMultipartUpload(key, { httpMetadata: { contentType } });
          return json({ uploadId: mpu.uploadId, key });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // UPLOAD PART: PUT /r2/multipart/part?key=...&uploadId=...&partNumber=1  (body=bytes)
      if (path === '/r2/multipart/part' && request.method === 'PUT') {
        try {
          const key = url.searchParams.get('key');
          const uploadId = url.searchParams.get('uploadId');
          const pn = url.searchParams.get('partNumber');
          const partNumber = Number(pn);
          if (!key || !uploadId || !partNumber) return json({ error: 'Missing key/uploadId/partNumber' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          const res = await mpu.uploadPart(partNumber, request.body);
          return json({ etag: res.etag, partNumber });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // COMPLETE: POST /r2/multipart/complete { key, uploadId, parts:[{partNumber,etag}] }
      if (path === '/r2/multipart/complete' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key; const uploadId = body.uploadId; const parts = body.parts || [];
          if (!key || !uploadId || !Array.isArray(parts) || !parts.length) return json({ error: 'Missing key/uploadId/parts' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          await mpu.complete(parts.map(p => ({ partNumber: Number(p.partNumber), etag: String(p.etag) })));
          return json({ ok: true, key });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      // ABORT: POST /r2/multipart/abort { key, uploadId }
      if (path === '/r2/multipart/abort' && request.method === 'POST') {
        try {
          const body = await request.json();
          const key = body.key; const uploadId = body.uploadId;
          if (!key || !uploadId) return json({ error: 'Missing key/uploadId' }, { status: 400 });
          const mpu = await env.MEDIA_BUCKET.resumeMultipartUpload(key, uploadId);
          if (!mpu) return json({ error: 'Not found' }, { status: 404 });
          await mpu.abort();
          return json({ ok: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 2a) List R2 objects
      // Default: returns mixed directories and files under a prefix using delimiter '/'
      // When flat=1: returns a paginated flat list of objects with cursor for recursive operations
      if (path === '/r2/list' && request.method === 'GET') {
        if (!env.MEDIA_BUCKET) return json([], { status: 200 });
        const inputPrefix = url.searchParams.get('prefix') || '';
        const norm = String(inputPrefix).replace(/^\/+|\/+$/g, '');
        const flat = /^(1|true|yes)$/i.test(url.searchParams.get('flat') || '');
        if (flat) {
          const cursor = url.searchParams.get('cursor') || undefined;
          const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit') || '1000')));
          try {
            const prefixFlat = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
            const res = await env.MEDIA_BUCKET.list({ prefix: prefixFlat, cursor, limit });
            const objects = (res.objects || []).map((o) => ({
              key: o.key,
              size: o.size,
              modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
            }));
            return json({ objects, cursor: res.cursor || null, truncated: !!res.truncated });
          } catch (e) {
            return json({ error: e.message }, { status: 500 });
          }
        }
        const prefix = norm ? (norm.endsWith('/') ? norm : norm + '/') : '';
        const paged = /^(1|true|yes)$/i.test(url.searchParams.get('paged') || '');
        const cursor = url.searchParams.get('cursor') || undefined;
        const limitRaw = url.searchParams.get('limit');
        let limit = Number(limitRaw);
        if (!Number.isFinite(limit)) limit = 1000; // Cloudflare default
        limit = Math.min(1000, Math.max(1, limit));
        try {
          const listOpts = { prefix, delimiter: '/', cursor, limit };
          // When not paged we omit cursor/limit so behavior identical to previous implementation
          const res = paged ? await env.MEDIA_BUCKET.list(listOpts) : await env.MEDIA_BUCKET.list({ prefix, delimiter: '/' });
          const base = env.R2_PUBLIC_BASE || '';
          const makeUrl = (k) => base ? `${base}/${k}` : `${url.origin}/media/${k}`;
          const dirs = (res.delimitedPrefixes || []).map((p) => {
            const key = p;
            const name = key.replace(/^.*\//, '').replace(/\/$/, '') || key;
            return { key, name, type: 'directory' };
          });
            const files = (res.objects || []).map((o) => ({
              key: o.key,
              name: o.key.replace(/^.*\//, ''),
              type: 'file',
              size: o.size,
              modified: o.uploaded ? new Date(o.uploaded).toISOString() : null,
              url: makeUrl(o.key),
            }));
          if (paged) {
            return json({ items: [...dirs, ...files], cursor: res.cursor || null, truncated: !!res.truncated });
          }
          return json([ ...dirs, ...files ]);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 2b) Delete R2 object (file) or empty directory (prefix ending with '/')
      if (path === '/r2/delete' && request.method === 'DELETE') {
        if (!env.MEDIA_BUCKET) return json({ error: 'R2 not configured' }, { status: 400 });
        const key = url.searchParams.get('key');
        const recursive = /^(1|true|yes)$/i.test(url.searchParams.get('recursive') || '');
        if (!key) return json({ error: 'Missing key' }, { status: 400 });
        try {
          if (key.endsWith('/')) {
            if (!recursive) {
              // Delete directory only if empty
              const check = await env.MEDIA_BUCKET.list({ prefix: key, limit: 2 });
              const has = (check.objects && check.objects.length) || (check.delimitedPrefixes && check.delimitedPrefixes.length);
              if (has) return json({ error: 'not-empty' }, { status: 400 });
              return json({ ok: true });
            }
            // Recursive delete (performance optimized): delete objects in parallel batches
            let cursor = undefined; let total = 0;
            // allow optional concurrency override (?c=30)
            const concRaw = url.searchParams.get('c');
            let concurrency = 20;
            if (concRaw) {
              const n = Number(concRaw);
              if (Number.isFinite(n) && n > 0 && n <= 100) concurrency = Math.floor(n);
            }
            while (true) {
              const res = await env.MEDIA_BUCKET.list({ prefix: key, cursor, limit: 1000 });
              const objs = res.objects || [];
              if (!objs.length) {
                if (!res.truncated) break;
                cursor = res.cursor;
                continue;
              }
              // Delete in concurrent batches to reduce total time
              let idx = 0;
              async function runBatch() {
                while (idx < objs.length) {
                  const batch = [];
                  for (let j = 0; j < concurrency && idx < objs.length; j++, idx++) {
                    const objKey = objs[idx].key;
                    batch.push(env.MEDIA_BUCKET.delete(objKey));
                  }
                  await Promise.allSettled(batch);
                }
              }
              await runBatch();
              total += objs.length;
              if (!res.truncated) break;
              cursor = res.cursor;
            }
            return json({ ok: true, deleted: total, concurrency });
          } else {
            await env.MEDIA_BUCKET.delete(key);
            return json({ ok: true });
          }
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 3) Content items list (generic across films, music, books)
      if (path === '/items' && request.method === 'GET') {
        try {
          // Include available_subs aggregated from content_item_languages for each item
          const rows = await env.DB.prepare(`
            SELECT ci.id as internal_id, ci.slug as id, ci.title, ci.main_language, ci.type, ci.release_year, ci.description, ci.total_episodes as episodes, ci.is_original, ci.level_framework_stats,
                   cil.language as lang
            FROM content_items ci
            LEFT JOIN content_item_languages cil ON cil.content_item_id = ci.id
          `).all();
          const map = new Map();
          for (const r of (rows.results || [])) {
            const key = r.id;
            let it = map.get(key);
            if (!it) {
              // Parse level_framework_stats from JSON string to object
              let levelStats = null;
              if (r.level_framework_stats) {
                try {
                  levelStats = JSON.parse(r.level_framework_stats);
                } catch {}
              }
              
              it = {
                id: r.id,
                title: r.title,
                main_language: r.main_language,
                type: r.type,
                release_year: r.release_year,
                description: r.description,
                episodes: r.episodes,
                is_original: r.is_original,
                level_framework_stats: levelStats,
                available_subs: [],
              };
              map.set(key, it);
            }
            if (r.lang) {
              if (!it.available_subs.includes(r.lang)) it.available_subs.push(r.lang);
            }
          }
          const out = Array.from(map.values());
          return json(out);
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
          let film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!film) {
            // Fallback: allow direct UUID id lookup in case caller still uses internal id
            film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images FROM content_items WHERE id=?').bind(filmSlug).first();
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
          let cover_landscape_url = null;
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
          // Build cover_landscape_url from cover_landscape_key if present
          if (film.cover_landscape_key) {
            const base = env.R2_PUBLIC_BASE || '';
            cover_landscape_url = base ? `${base}/${film.cover_landscape_key}` : `/${film.cover_landscape_key}`;
          }
          const episodesMetaRaw = (film.total_episodes != null ? Number(film.total_episodes) : null);
          const episodesMeta = (Number.isFinite(episodesMetaRaw) && episodesMetaRaw > 0) ? episodesMetaRaw : null;
          const episodesOut = episodesMeta !== null ? episodesMeta : episodes;
          const isOriginal = (film.is_original == null) ? 1 : film.is_original; // default true when absent
          
          // Parse level_framework_stats from JSON string to object
          let levelStats = null;
          if (film.level_framework_stats) {
            try {
              levelStats = JSON.parse(film.level_framework_stats);
            } catch {}
          }
          
          return json({ id: film.slug, title: film.title, main_language: film.main_language, type: film.type, release_year: film.release_year, description: film.description, available_subs: (langs.results || []).map(r => r.language), episodes: episodesOut, total_episodes: episodesMeta !== null ? episodesMeta : episodesOut, cover_url, cover_landscape_url, is_original: !!Number(isOriginal), num_cards: film.num_cards ?? null, avg_difficulty_score: film.avg_difficulty_score ?? null, level_framework_stats: levelStats, is_available: film.is_available ?? 1, video_has_images: film.video_has_images === 1 || film.video_has_images === true });
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
            rows = await env.DB.prepare('SELECT episode_number,title,slug,description,cover_key,is_available,num_cards FROM episodes WHERE content_item_id=? ORDER BY episode_number ASC').bind(filmRow.id).all();
          } catch (e) {
            // Backward compatibility: older column name episode_num
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

          // New: video_has_images flag (boolean). Accepts boolean or number; coerces to 0/1.
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

          // New: is_available flag (boolean). Accepts boolean or number; coerces to 0/1.
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
          mediaKeys.add(`items/${filmRow.slug}/cover_image/cover_landscape.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/full/audio.mp3`);
          mediaKeys.add(`items/${filmRow.slug}/full/video.mp4`);

          // Episodes + cards keys
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
            const epFolderPadded = `${filmRow.slug}_${String(epNum).padStart(3,'0')}`;
            if (ep.cover_key) mediaKeys.add(normalizeKey(ep.cover_key));
            // Conventional episode-level paths
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover_landscape.jpg`);
            // New padded variants
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
            mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover_landscape.jpg`);
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
                try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (${cardPh})`).bind(...cardIds).run(); } catch {}
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
          // Previous implementation deleted sequentially causing long waits for large media sets.
          // Use batched concurrent deletes to reduce total time.
          let mediaDeletedCount = 0;
          if (env.MEDIA_BUCKET && mediaKeys.size) {
            const keys = Array.from(mediaKeys).filter(Boolean);
            const concurrency = 40; // reasonable parallelism without overwhelming R2
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
      // DELETE episode: remove episode, its cards, subtitles, difficulties, and media
      if (episodeMetaMatch && request.method === 'DELETE') {
        const filmSlug = decodeURIComponent(episodeMetaMatch[1]);
        const episodeSlugRaw = decodeURIComponent(episodeMetaMatch[2]);
        try {
          const filmRow = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlugRaw).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlugRaw).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          // Resolve episode row
          let episode;
          try {
            episode = await env.DB.prepare('SELECT id, episode_number, slug, cover_key FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            try { episode = await env.DB.prepare('SELECT id, episode_num AS episode_number, slug, cover_key FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first(); } catch {}
          }
          if (!episode) return json({ error: 'Not found' }, { status: 404 });
          const epId = episode.id;
          // Enforce rule: cannot delete the first episode of a film
          try {
            let minRow;
            try {
              minRow = await env.DB.prepare('SELECT MIN(episode_number) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first();
            } catch (e) {
              try { minRow = await env.DB.prepare('SELECT MIN(episode_num) AS mn FROM episodes WHERE content_item_id=?').bind(filmRow.id).first(); } catch {}
            }
            const minEp = minRow ? Number(minRow.mn) : 1;
            if (epNum === minEp) {
              return json({ error: 'Cannot delete the first episode' }, { status: 400 });
            }
          } catch {}
          // Collect related cards and media keys
          const mediaKeys = new Set();
          const mediaErrors = [];
          const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
          if (episode.cover_key) mediaKeys.add(normalizeKey(episode.cover_key));
          // Add conventional episode media locations (both legacy and padded)
          const epPadded = String(epNum).padStart(3,'0');
          const epFolderLegacy = `${filmRow.slug}_${epNum}`;
          const epFolderPadded = `${filmRow.slug}_${epPadded}`;
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderLegacy}/cover/cover.jpg`);
          mediaKeys.add(`items/${filmRow.slug}/episodes/${epFolderPadded}/cover/cover.jpg`);
          // Collect card keys
          let cardsRows = { results: [] };
          try {
            cardsRows = await env.DB.prepare('SELECT id, image_key, audio_key FROM cards WHERE episode_id=?').bind(epId).all();
          } catch {}
          const cardIds = [];
          for (const c of (cardsRows.results || [])) {
            cardIds.push(c.id);
            if (c.image_key) mediaKeys.add(normalizeKey(c.image_key));
            if (c.audio_key) mediaKeys.add(normalizeKey(c.audio_key));
          }
          // Delete DB rows in a transaction
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            if (cardIds.length) {
              const ph = cardIds.map(() => '?').join(',');
              try { await env.DB.prepare(`DELETE FROM card_subtitles WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM card_subtitles_fts WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch {}
            } else {
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id=?`).bind(epId).run(); } catch {}
            }
            try { await env.DB.prepare('DELETE FROM episodes WHERE id=?').bind(epId).run(); } catch {}
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          // Best-effort media deletion
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
      }
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
            episode = await env.DB.prepare('SELECT id, title, slug, description, cover_key, is_available, num_cards, avg_difficulty_score, level_framework_stats FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
          } catch (e) {
            // Fallback older schema
            try {
              episode = await env.DB.prepare('SELECT id, title, slug, cover_key, is_available FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
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
              description: episode.description || null,
              cover_url: episode.cover_key ? (base ? `${base}/${episode.cover_key}` : `/${episode.cover_key}`) : null,
              display_id: `e${padded}`,
              num_cards: episode.num_cards ?? null,
              avg_difficulty_score: episode.avg_difficulty_score ?? null,
              level_framework_stats: episode.level_framework_stats ?? null,
              is_available: episode.is_available ?? 1,
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
          // is_available flag (boolean or number → 0/1)
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
          // If cover_key was updated, sync cards for video content
          if (coverKeyRaw && typeof coverKeyRaw === 'string' && coverKeyRaw.trim() !== '') {
            try {
              // Check if content type is video
              const contentInfo = await env.DB.prepare('SELECT ci.type FROM content_items ci JOIN episodes e ON ci.id = e.content_item_id WHERE e.id = ?').bind(episode.id).first();
              if (contentInfo && contentInfo.type === 'video') {
                const coverKey = String(coverKeyRaw).replace(/^https?:\/\/[^/]+\//, '');
                // Update all cards in this episode for video content (replace any existing image_key)
                await env.DB.prepare('UPDATE cards SET image_key = ? WHERE episode_id = ?').bind(coverKey, episode.id).run();
              }
            } catch (e) {
              // Log but don't fail the update
              console.error('Failed to sync cards with cover_key:', e);
            }
          }
          return json({ ok: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
        if (filmCardsMatch && request.method === 'GET') {
      const filmSlug = decodeURIComponent(filmCardsMatch[1]);
      const episodeSlug = decodeURIComponent(filmCardsMatch[2]);
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '50');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        const startFromRaw = url.searchParams.get('start_from');
        const startFrom = startFromRaw != null ? Number(startFromRaw) : null;
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
          // Priority 1: Try to find by slug first (most reliable, exact match)
          try {
            ep = await env.DB.prepare('SELECT id,slug,episode_number FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
          } catch (e) {
            try { 
              ep = await env.DB.prepare('SELECT id,slug,episode_num AS episode_number FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
            } catch {}
          }
          // Priority 2: Fallback to episode_number if slug match failed
          if (!ep) {
            try {
              ep = await env.DB.prepare('SELECT id,slug,episode_number FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
            } catch (e) {
              try { 
                ep = await env.DB.prepare('SELECT id,slug,episode_num AS episode_number FROM episodes WHERE content_item_id=? AND episode_num=?').bind(filmRow.id, epNum).first();
              } catch {}
            }
          }
          if (!ep) return json([]);
          let res;
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
                           WHERE c.episode_id=? AND c.start_time >= ?
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, Math.floor(startFrom), limit).all();
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
                           WHERE c.episode_id=?
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, limit).all();
            }
          } catch (e) {
            // Backward compatibility: legacy ms columns
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
                                 WHERE c.episode_id=? AND c.start_time_ms >= ?
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, Math.floor(startFrom * 1000), limit).all();
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
                                 WHERE c.episode_id=?
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, limit).all();
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles and CEFR levels for all cards
          const cardIds = rows.map(r => r.internal_id);
          const subsMap = new Map();
          const cefrMap = new Map();
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
            } catch (e) {
              console.error('[WORKER] Error fetching subtitles:', e);
            }
            try {
              // Batch CEFR levels to avoid SQLite parameter limit (999)
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER] Error fetching CEFR levels:', e);
            }
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const cefr = cefrMap.get(r.internal_id) || null;
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode_id: outEpisodeId, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch (e) {
          return json([]);
        }
      }

      // 5b) Cards for a given item across all parts (optional episode filter omitted)
  const filmAllCardsMatch = path.match(/^\/items\/([^/]+)\/cards$/);
      if (filmAllCardsMatch && request.method === 'GET') {
        const filmSlug = filmAllCardsMatch[1];
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '50');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        try {
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json([]);
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(filmRow.id, limit).all();
          } catch (e) {
            // Fallback older schema (episode_num)
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       WHERE e.content_item_id=?
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(filmRow.id, limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
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
          // Optimize: Batch fetch subtitles and CEFR levels
          const cardIds = rows.map(r => r.internal_id);
          const subsMap = new Map();
          const cefrMap = new Map();
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
            } catch (e) {
              console.error('[WORKER /items/cards] Error fetching subtitles:', e);
            }
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER /items/cards] Error fetching CEFR levels:', e);
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
      }

      // 6) Global cards (return film slug, display id, and episode slug e{N} instead of UUID)
  if (path === '/cards' && request.method === 'GET') {
        // Allow higher limits for admin pages, but cap at 5000 to prevent overload
        const limitRaw = Number(url.searchParams.get('limit') || '100');
        const limit = Math.min(5000, Math.max(1, limitRaw));
        try {
          let res;
          try {
            const sql = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(limit).all();
          } catch (e) {
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.content_item_id as film_id,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c JOIN episodes e ON c.episode_id=e.id
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
              try { res = await env.DB.prepare(sql3).bind(limit).all(); }
              catch { res = { results: [] }; }
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles, CEFR, and film slugs
          const cardIds = rows.map(r => r.internal_id);
          const filmIds = [...new Set(rows.map(r => r.film_id))];
          const subsMap = new Map();
          const cefrMap = new Map();
          const filmSlugMap = new Map();
          if (cardIds.length > 0) {
            // Split into batches to avoid SQLite's 999 parameter limit
            const batchSize = 500;
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
                const batchSubs = await env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all();
                (batchSubs.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
              }
            } catch (e) {
              console.error('[WORKER /cards] Error fetching subtitles:', e);
            }
            try {
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const phCefr = batch.map(() => '?').join(',');
                const batchCefr = await env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${phCefr}) AND framework='CEFR'`).bind(...batch).all();
                (batchCefr.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
              }
            } catch (e) {
              console.error('[WORKER /cards] Error fetching CEFR levels:', e);
            }
          }
          if (filmIds.length > 0) {
            const phFilm = filmIds.map(() => '?').join(',');
            try {
              const allFilms = await env.DB.prepare(`SELECT id, slug FROM content_items WHERE id IN (${phFilm})`).bind(...filmIds).all();
              (allFilms.results || []).forEach(f => filmSlugMap.set(f.id, f.slug));
            } catch {}
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const film = { slug: filmSlugMap.get(r.film_id) || 'item' };
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${film.slug}_${Number(r.episode_number) || 1}`;
            const cefr = cefrMap.get(r.internal_id) || null;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, cefr_level: cefr, film_id: film?.slug, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch { return json([]); }
      }

      // 6b) Full-text search endpoint (FTS5) over subtitles
      if (path === '/search' && request.method === 'GET') {
        const qRaw = url.searchParams.get('q') || '';
        const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || '50')));
        const mainLang = url.searchParams.get('main'); // filter by content_items.main_language
        const subtitleLanguagesCsv = url.searchParams.get('subtitle_languages') || '';
        const contentIdsCsv = url.searchParams.get('content_ids') || '';
        const difficultyMinRaw = url.searchParams.get('difficulty_min');
        const difficultyMaxRaw = url.searchParams.get('difficulty_max');
        const levelMinRaw = url.searchParams.get('level_min');
        const levelMaxRaw = url.searchParams.get('level_max');
        const q = qRaw.trim();
        if (!q) return json([]);
        try {
          const mainCanon = mainLang ? String(mainLang).toLowerCase() : null;

          // Parse subtitle languages into array
          const subtitleLangsArr = subtitleLanguagesCsv
            ? Array.from(new Set(subtitleLanguagesCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const subtitleLangsCount = subtitleLangsArr.length;

          // Parse content ids into array
          const contentIdsArr = contentIdsCsv
            ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean)))
            : [];
          const contentIdsCount = contentIdsArr.length;

          // Parse difficulty filters
          const difficultyMin = difficultyMinRaw ? Number(difficultyMinRaw) : null;
          const difficultyMax = difficultyMaxRaw ? Number(difficultyMaxRaw) : null;
          const hasDifficultyFilter = (difficultyMin !== null && difficultyMin > 0) || (difficultyMax !== null && difficultyMax < 100);

          // Parse level filters
          const levelMin = levelMinRaw ? String(levelMinRaw).trim() : null;
          const levelMax = levelMaxRaw ? String(levelMaxRaw).trim() : null;
          const hasLevelFilter = levelMin !== null || levelMax !== null;
          const framework = getFrameworkFromLanguage(mainLang);

          // ---------- 1) Try FTS5 search on card_subtitles_fts (exact token / phrase, no substring) ----------
          let rows = [];
          try {
            // Build a MATCH query.
            //  - Single token: exact token match (no substring/prefix) → \"he\" matches only token \"he\", not \"there\".
            //  - Multi-word: exact phrase match → \"this is\" matches only that phrase.
            // FTS5 is case-insensitive by default but requires lowercase tokens.
            const tokens = q.toLowerCase().split(/\s+/).slice(0, 6).map(s => s.replace(/["'*]/g, ''));
            let match;
            if (tokens.length === 1) {
              const t = tokens[0];
              // Exact token match (quoted). No wildcard to avoid substring hits like \"he\" → \"there\".
              match = `"${t}"`;
            } else {
              // Multi-word: exact phrase match
              match = `"${tokens.join(' ')}"`;
            }

            // Build allowed levels list for level filter
            let allowedLevels = null;
            if (hasLevelFilter) {
              const CEFR = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
              const JLPT = ['N5', 'N4', 'N3', 'N2', 'N1'];
              const HSK = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
              
              let levelOrder = [];
              if (framework === 'CEFR') levelOrder = CEFR;
              else if (framework === 'JLPT') levelOrder = JLPT;
              else if (framework === 'HSK') levelOrder = HSK;
              
              if (levelOrder.length > 0) {
                const minIdx = levelMin ? levelOrder.indexOf(levelMin.toUpperCase()) : 0;
                const maxIdx = levelMax ? levelOrder.indexOf(levelMax.toUpperCase()) : levelOrder.length - 1;
                if (minIdx >= 0 && maxIdx >= 0 && minIdx <= maxIdx) {
                  allowedLevels = levelOrder.slice(minIdx, maxIdx + 1);
                }
              }
            }

            const sqlFts = `
              SELECT DISTINCT c.card_number,
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
                     e.episode_number,
                     e.slug as episode_slug,
                     ci.slug as film_slug,
                     c.id as internal_id
              FROM card_subtitles_fts
              JOIN cards c ON c.id = card_subtitles_fts.card_id
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE card_subtitles_fts MATCH ?
              ${mainCanon ? 'AND LOWER(card_subtitles_fts.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)' : ''}
              ${contentIdsCount > 0 ? `AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})` : ''}
              ${
                subtitleLangsCount > 0
                  ? `AND (
                       SELECT COUNT(DISTINCT cs.language)
                       FROM card_subtitles cs
                       WHERE cs.card_id = c.id
                         AND cs.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                     ) = ?`
                  : ''
              }
              ${hasDifficultyFilter ? `AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?` : ''}
              ${hasLevelFilter && allowedLevels && allowedLevels.length > 0 ? `AND EXISTS (
                SELECT 1 FROM card_difficulty_levels cdl
                WHERE cdl.card_id = c.id
                  AND cdl.framework = ?
                  AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
              )` : ''}
              LIMIT ?`;

            const bindFts = [match];
            if (mainCanon) {
              // language to search in subtitles (main audio language) AND content_items.main_language
              bindFts.push(mainCanon);
              bindFts.push(mainCanon);
            }
            if (contentIdsCount > 0) {
              bindFts.push(...contentIdsArr);
            }
            if (subtitleLangsCount > 0) {
              bindFts.push(...subtitleLangsArr);
              bindFts.push(subtitleLangsCount);
            }
            if (hasDifficultyFilter) {
              bindFts.push(difficultyMin !== null ? difficultyMin : 0);
              bindFts.push(difficultyMax !== null ? difficultyMax : 100);
            }
            if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
              bindFts.push(framework);
              bindFts.push(...allowedLevels);
            }
            bindFts.push(limit);
            const detFts = await env.DB.prepare(sqlFts).bind(...bindFts).all();
            rows = detFts.results || [];
          } catch {
            // ignore FTS errors and fall back to LIKE
            rows = [];
          }

          // ---------- 2) Fallback: LIKE search on card_subtitles.text if FTS returned nothing ----------
          // Only use LIKE for CJK languages; for Latin queries this causes many false positives.
          const isCjkQuery = /[\u3040-\u30FF\u3400-\u9FFF]/u.test(q);
          // Check if this is a Chinese query (zh, zh_trad, zh_hans)
          const isChineseQuery = mainCanon && (mainCanon === 'zh' || mainCanon === 'zh_trad' || mainCanon === 'zh_hans' || mainCanon === 'zh-cn' || mainCanon === 'zh-tw' || mainCanon === 'chinese') || /[\u4E00-\u9FFF]/.test(q);
          
          if (!rows.length && isCjkQuery) {
            // For Chinese, normalize query by removing any brackets (user might search with brackets)
            const normalizedQuery = isChineseQuery ? normalizeChineseTextForSearch(q) : q;
            
            // For Chinese text with pinyin brackets, we need to match the normalized version
            // Since SQLite doesn't support regex, we'll build a pattern that allows optional brackets
            // between each character. For "请问", we want to match "请[qǐng]问[wèn]"
            // Pattern: each Chinese char can be followed by optional [anything]
            let likePattern;
            if (isChineseQuery && normalizedQuery.length > 0) {
              // Build pattern that matches Chinese characters with optional [pinyin] brackets between them
              // Example: "请问" -> "%请%[%]%问%[%]%"
              // This will match: "请[qǐng]问[wèn]" because:
              // - %请% matches "请"
              // - [%] matches "[qǐng]" (literal [ + any chars + literal ])
              // - %问% matches "问"
              // - [%] matches "[wèn]"
              const chars = normalizedQuery.split('');
              // Pattern: char1 + % + [ + % + ] + % + char2 + ...
              // Use % before and after brackets to allow any characters (including the bracket content)
              likePattern = '%' + chars.join('%[%]%') + '%';
            } else {
              likePattern = `%${normalizedQuery}%`;
            }
            
            const sqlLike = `
              SELECT DISTINCT c.card_number,
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
                     e.episode_number,
                     e.slug as episode_slug,
                     ci.slug as film_slug,
                     c.id as internal_id
              FROM card_subtitles cs
              JOIN cards c ON c.id = cs.card_id
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              WHERE cs.text LIKE ?
              ${mainCanon ? 'AND LOWER(cs.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)' : ''}
              ${contentIdsCount > 0 ? `AND ci.slug IN (${contentIdsArr.map(() => '?').join(',')})` : ''}
              ${
                subtitleLangsCount > 0
                  ? `AND (
                       SELECT COUNT(DISTINCT cs2.language)
                       FROM card_subtitles cs2
                       WHERE cs2.card_id = c.id
                         AND cs2.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                     ) = ?`
                  : ''
              }
              ${hasDifficultyFilter ? `AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?` : ''}
              ${hasLevelFilter && allowedLevels && allowedLevels.length > 0 ? `AND EXISTS (
                SELECT 1 FROM card_difficulty_levels cdl
                WHERE cdl.card_id = c.id
                  AND cdl.framework = ?
                  AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
              )` : ''}
              LIMIT ?`;
            const bindLike = [likePattern];
            if (mainCanon) {
              // search in main language subtitles only
              bindLike.push(mainCanon);
              bindLike.push(mainCanon);
            }
            if (contentIdsCount > 0) {
              bindLike.push(...contentIdsArr);
            }
            if (subtitleLangsCount > 0) {
              bindLike.push(...subtitleLangsArr);
              bindLike.push(subtitleLangsCount);
            }
            if (hasDifficultyFilter) {
              bindLike.push(difficultyMin !== null ? difficultyMin : 0);
              bindLike.push(difficultyMax !== null ? difficultyMax : 100);
            }
            if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
              bindLike.push(framework);
              bindLike.push(...allowedLevels);
            }
            bindLike.push(limit);
            const detLike = await env.DB.prepare(sqlLike).bind(...bindLike).all();
            rows = detLike.results || [];
          }

          if (!rows.length) return json([]);
          const out = [];
          for (const r of rows) {
            const subs = await env.DB.prepare('SELECT language,text FROM card_subtitles WHERE card_id=?').bind(r.internal_id).all();
            const subtitle = {};
            (subs.results || []).forEach(s => { subtitle[s.language] = s.text; });
            // Fetch all difficulty levels for this card
            let levels = [];
            let cefr = null;
            try {
              const levelRows = await env.DB.prepare('SELECT framework, level, language FROM card_difficulty_levels WHERE card_id=?').bind(r.internal_id).all();
              if (levelRows.results && levelRows.results.length > 0) {
                levels = levelRows.results.map(l => ({
                  framework: l.framework,
                  level: l.level,
                  language: l.language || null
                }));
                // Keep cefr_level for backward compatibility
                const cefrRow = levelRows.results.find(l => l.framework === 'CEFR');
                cefr = cefrRow ? cefrRow.level : null;
              }
            } catch {}
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const episodeSlug = r.episode_slug || `${r.film_slug || 'item'}_${Number(r.episode_number) || 1}`;
            const startS = (r.start_time != null) ? r.start_time : 0;
            const endS = (r.end_time != null) ? r.end_time : 0;
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            out.push({ id: displayId, episode: episodeSlug, start: startS, end: endS, duration: dur, image_key: r.image_key, audio_key: r.audio_key, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, is_available: r.is_available, cefr_level: cefr, levels: levels.length > 0 ? levels : undefined, film_id: r.film_slug, subtitle });
          }
          return json(out);
        } catch (e) {
          return json([]);
        }
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
          let row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
          if (!row) {
            // Legacy fallback
            row = await env.DB.prepare('SELECT c.id as internal_id,c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available FROM cards c WHERE c.episode_id=? AND c.card_number=?').bind(ep.id, cardNum).first();
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
          return json({ id: displayId, episode_id: outEpisodeId, episode_display: displayPadded, film_id: filmSlug, start: startS, end: endS, duration: dur, image_key: row.image_key, audio_key: row.audio_key, sentence: row.sentence, card_type: row.card_type, length: row.length, difficulty_score: row.difficulty_score, cefr_level: cefr, subtitle, is_available: row.is_available ?? 1 });
        } catch { return new Response('Not found', { status: 404, headers: withCors() }); }
      }
      // PATCH card: update subtitles, audio_key, image_key
      if (cardMatch && request.method === 'PATCH') {
        const filmSlug = cardMatch[1];
        const episodeSlug = cardMatch[2];
        const cardDisplay = cardMatch[3];
        try {
          const body = await request.json();
          const film = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!film) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(film.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch {}
          }
          if (!ep) return json({ error: 'Not found' }, { status: 404 });
          const cardNum = Number(cardDisplay);
          const row = await env.DB.prepare('SELECT id FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
          if (!row) return json({ error: 'Not found' }, { status: 404 });
          
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            // Update subtitle if provided
            if (body.subtitle && typeof body.subtitle === 'object') {
              // Replace existing subtitles and mirror into FTS
              await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run();
              await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run();
              for (const [lang, text] of Object.entries(body.subtitle)) {
                if (text && String(text).trim()) {
                  await env.DB.prepare('INSERT INTO card_subtitles (card_id, language, text) VALUES (?, ?, ?)').bind(row.id, lang, text).run();
                  const idxText = (String(lang).toLowerCase() === 'ja') ? expandJaIndexText(String(text)) : String(text);
                  await env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, lang, row.id).run();
                }
              }
            }
            // Update audio_key if provided
            if (body.audio_url) {
              const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
              const audioKey = normalizeKey(body.audio_url);
              await env.DB.prepare('UPDATE cards SET audio_key=? WHERE id=?').bind(audioKey, row.id).run();
            }
            // Update image_key if provided
            if (body.image_url) {
              const normalizeKey = (url) => String(url).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '');
              const imageKey = normalizeKey(body.image_url);
              await env.DB.prepare('UPDATE cards SET image_key=? WHERE id=?').bind(imageKey, row.id).run();
            }
            // Update is_available if provided
            if (typeof body.is_available === 'number' || typeof body.is_available === 'boolean') {
              const isAvail = body.is_available ? 1 : 0;
              await env.DB.prepare('UPDATE cards SET is_available=? WHERE id=?').bind(isAvail, row.id).run();
            }
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          return json({ ok: true, updated: String(cardNum).padStart(4, '0') });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      if (cardMatch && request.method === 'DELETE') {
        const filmSlug = cardMatch[1];
        const episodeSlug = cardMatch[2];
        const cardDisplay = cardMatch[3];
        try {
          const film = await env.DB.prepare('SELECT id, slug FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!film) return json({ error: 'Not found' }, { status: 404 });
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_number=?').bind(film.id, epNum).first();
          } catch (e) {
            try { ep = await env.DB.prepare('SELECT id FROM episodes WHERE content_item_id=? AND episode_num=?').bind(film.id, epNum).first(); } catch {}
          }
          if (!ep) return json({ error: 'Not found' }, { status: 404 });
          const cardNum = Number(cardDisplay);
          const row = await env.DB.prepare('SELECT id, card_number, image_key, audio_key FROM cards WHERE episode_id=? AND card_number=?').bind(ep.id, cardNum).first();
          if (!row) return json({ error: 'Not found' }, { status: 404 });
          // Enforce: cannot delete the first card in the episode
          let minRow = await env.DB.prepare('SELECT MIN(card_number) AS mn FROM cards WHERE episode_id=?').bind(ep.id).first().catch(() => null);
          const minCard = minRow ? Number(minRow.mn) : cardNum;
          if (row.card_number === minCard) {
            return json({ error: 'Cannot delete the first card' }, { status: 400 });
          }
          const mediaKeys = new Set();
          const normalizeKey = (k) => (k ? String(k).replace(/^https?:\/\/[^/]+\//, '').replace(/^\//, '') : null);
          if (row.image_key) mediaKeys.add(normalizeKey(row.image_key));
          if (row.audio_key) mediaKeys.add(normalizeKey(row.audio_key));
          // Delete DB rows
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            try { await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM cards WHERE id=?').bind(row.id).run(); } catch {}
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          // Delete media
          let mediaDeletedCount = 0; const mediaErrors = [];
          if (env.MEDIA_BUCKET) {
            for (const k of mediaKeys) {
              if (!k) continue;
              try { await env.MEDIA_BUCKET.delete(k); mediaDeletedCount += 1; }
              catch { mediaErrors.push(`fail:${k}`); }
            }
          }
          return json({ ok: true, deleted: String(cardNum).padStart(4,'0'), media_deleted: mediaDeletedCount, media_errors: mediaErrors });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // 8) Media proxy with CORS (serves R2 objects for waveform preview and client access)
      if (path.startsWith('/media/')) {
        const key = path.replace(/^\/media\//, '');
        if (!key) return new Response('Not found', { status: 404, headers: withCors() });
        try {
          const obj = await env.MEDIA_BUCKET.get(key);
          if (!obj) return new Response('Not found', { status: 404, headers: withCors() });
          const headers = withCors({
            'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
            'Cache-Control': 'public, max-age=31536000, immutable',
          });
          return new Response(obj.body, { headers });
        } catch (e) {
          return new Response('Not found', { status: 404, headers: withCors() });
        }
      }

      // 9) Import bulk (server generates UUIDs; client provides slug and numbers)
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
            const coverLandscapeKey = (film.cover_landscape_key || film.cover_landscape_url) ? String((film.cover_landscape_key || film.cover_landscape_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
            const totalEpisodesIns = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : 1;
            await env.DB.prepare('INSERT INTO content_items (id,slug,title,main_language,type,description,cover_key,cover_landscape_key,release_year,total_episodes,is_original) VALUES (?,?,?,?,?,?,?,?,?,?,?)').bind(
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
              (film.is_original === false ? 0 : 1)
            ).run();
            filmRow = { id: uuid };
          } else {
            // Update metadata if provided
            const coverKey = (film.cover_key || film.cover_url) ? String((film.cover_key || film.cover_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
            const coverLandscapeKey = (film.cover_landscape_key || film.cover_landscape_url) ? String((film.cover_landscape_key || film.cover_landscape_url)).replace(/^https?:\/\/[^/]+\//, '') : null;
            const totalEpisodes = (film.total_episodes && Number(film.total_episodes) > 0) ? Math.floor(Number(film.total_episodes)) : null;
            await env.DB.prepare('UPDATE content_items SET title=COALESCE(?,title), main_language=COALESCE(?,main_language), type=COALESCE(?,type), description=COALESCE(?,description), cover_key=COALESCE(?,cover_key), cover_landscape_key=COALESCE(?,cover_landscape_key), release_year=COALESCE(?,release_year), total_episodes=COALESCE(?,total_episodes), is_original=COALESCE(?,is_original) WHERE id=?').bind(
              film.title || null,
              film.language || film.main_language || null,
              film.type || null,
              film.description || null,
              coverKey,
              coverLandscapeKey,
              film.release_year || null,
              totalEpisodes,
              (typeof film.is_original === 'boolean' ? (film.is_original ? 1 : 0) : null),
              filmRow.id
            ).run();
          }
          if (Array.isArray(film.available_subs) && film.available_subs.length) {
            const subLangStmts = film.available_subs.map((lang) => env.DB.prepare('INSERT OR IGNORE INTO content_item_languages (content_item_id,language) VALUES (?,?)').bind(filmRow.id, lang));
            try { await env.DB.batch(subLangStmts); } catch {}
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
            const epPadded = String(episodeNumber).padStart(3, '0');
            const episodeTitle = (film.episode_title && String(film.episode_title).trim()) ? String(film.episode_title).trim() : `e${epPadded}`;
            const episodeDescription = (film.episode_description && String(film.episode_description).trim()) ? String(film.episode_description).trim() : null;
            const episodeSlug = `${filmSlug}_${epPadded}`;
            // Insert with slug column if available; fallback without slug on older schema
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
              // Fallback older schema with episode_num
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
              await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
            } catch {}
            try {
              await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run();
            } catch {}
            try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id IN (SELECT id FROM cards WHERE episode_id=?)').bind(episode.id).run(); } catch {}
            try { await env.DB.prepare('DELETE FROM cards WHERE episode_id=?').bind(episode.id).run(); } catch {}
          }

          // Helper: run an array of prepared statements in batches to minimize API calls
          async function runStmtBatches(stmts, size = 200) {
            for (let i = 0; i < stmts.length; i += size) {
              const slice = stmts.slice(i, i + size);
              if (slice.length) await env.DB.batch(slice);
            }
          }

          // Prebuild statements
          const cardsNewSchema = [];
          const cardsLegacySchema = [];
          const subStmts = [];
          const ftsStmts = [];
          const diffStmts = [];

          const normalizeKey = (u) => (u ? String(u).replace(/^https?:\/\/[^/]+\//, '') : null);

          // Get content type and episode cover_landscape_key for video content
          let contentType = null;
          let episodeCoverKey = null;
          try {
            const contentInfo = await env.DB.prepare('SELECT ci.type, e.cover_key FROM content_items ci JOIN episodes e ON ci.id = e.content_item_id WHERE e.id = ?').bind(episode.id).first();
            if (contentInfo) {
              contentType = contentInfo.type;
              episodeCoverKey = contentInfo.cover_key || null;
            }
          } catch (e) {
            // Fallback: try to get content type only
            try {
              const contentInfo = await env.DB.prepare('SELECT type FROM content_items WHERE id = (SELECT content_item_id FROM episodes WHERE id = ?)').bind(episode.id).first();
              if (contentInfo) contentType = contentInfo.type;
            } catch {}
          }

          const cardIds = []; // keep generated uuids in order for debugging if needed
          let seqCounter = 1; // safe fallback when card_number is missing/invalid
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
            // is_available: default 1 (true), set to 0 (false) if card explicitly has is_available=false
            const isAvail = (c.is_available === false || c.is_available === 0) ? 0 : 1;

            // For video content: use episode cover_key only if image_url is not provided
            // If video has individual card images (image_url is set), use image_url instead
            let imageKey = normalizeKey(c.image_url);
            if (contentType === 'video' && episodeCoverKey) {
              // Only use episode cover_key if image_url is not provided (video without images)
              // If image_url is provided (video with images), use image_url instead
              if (!imageKey || imageKey === '') {
                imageKey = episodeCoverKey;
              }
              // If imageKey is set (from image_url), keep it and don't override with episodeCoverKey
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

          // Execute in a transaction; try new schema first, fallback to legacy once
          const runImport = async (useLegacy) => {
            try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
            try {
              await runStmtBatches(useLegacy ? cardsLegacySchema : cardsNewSchema, 200);
              await runStmtBatches(subStmts, 400);
              await runStmtBatches(ftsStmts, 400);
              await runStmtBatches(diffStmts, 400);
              try { await env.DB.prepare('COMMIT').run(); } catch {}
              return true;
            } catch (e) {
              try { await env.DB.prepare('ROLLBACK').run(); } catch {}
              throw e;
            }
          };

          try {
            await runImport(false);
          } catch (e1) {
            const msg = (e1 && e1.message) ? String(e1.message) : String(e1);
            const isNewSchemaMissing = /no\s+such\s+column\s*:.*start_time\b/i.test(msg) || /no\s+such\s+column\s*:.*end_time\b/i.test(msg) || /no\s+column\s+named\s+start_time\b/i.test(msg);
            // Only attempt legacy fallback if the error indicates old ms-columns schema
            if (isNewSchemaMissing) {
              try {
                await runImport(true);
              } catch (e2) {
                const m2 = (e2 && e2.message) ? String(e2.message) : String(e2);
                return json({ error: `Import failed (legacy fallback also failed): new-schema error='${msg}', legacy error='${m2}'` }, { status: 500 });
              }
            } else {
              // Surface the original error to the client for accurate diagnosis
              return json({ error: msg }, { status: 500 });
            }
          }

          return json({ ok: true, inserted: cards.length, mode });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Admin: Update image path in database (for JPG -> WebP migration)
      if (path === '/admin/update-image-path' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { table, slug, field, newPath, episodeFolder, episodeNum, cardNumber, cardId } = body;
          
          if (!table || !newPath) {
            return json({ error: 'Missing required fields (table, newPath)' }, { status: 400 });
          }
          
          if (table === 'content_items') {
            // Update content-level cover
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
            // Update episode-level cover
            if (!slug || !episodeFolder) {
              return json({ error: 'slug and episodeFolder required for episodes' }, { status: 400 });
            }
            
            const validFields = ['cover_key', 'cover_landscape_key'];
            if (!validFields.includes(field)) {
              return json({ error: 'Invalid field for episodes table' }, { status: 400 });
            }
            
            // Find episode by content slug and episode number pattern
            // episodeFolder is like "e1", "e2", etc.
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
            // Update card-level image or audio
            // Support both old format (episodeFolder + cardNumber) and new format (episodeNum + cardId)
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
      }

      // Admin: Update audio path in database (for MP3 -> Opus migration)
      if (path === '/admin/update-audio-path' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { slug, episodeFolder, field, newPath } = body;
          
          if (!slug || !episodeFolder || !field || !newPath) {
            return json({ error: 'Missing required fields (slug, episodeFolder, field, newPath)' }, { status: 400 });
          }
          
          // Validate field
          if (field !== 'preview_audio_key') {
            return json({ error: 'Invalid field for audio update. Must be "preview_audio_key"' }, { status: 400 });
          }
          
          // Find episode by content slug and episode folder
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
      }

      // Admin: Bulk migrate all database paths from .jpg/.mp3 to .webp/.opus
      if (path === '/admin/migrate-paths' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { dryRun = true, imageExtension = 'webp', audioExtension = 'opus' } = body;
          
          const stats = {
            contentCovers: 0,
            contentLandscapes: 0,
            episodeCovers: 0,
            episodeLandscapes: 0,
            cardImages: 0,
            cardAudios: 0,
            total: 0
          };

          // Helper function to replace extension in path
          const replaceExt = (path, oldExt, newExt) => {
            if (!path) return path;
            const regex = new RegExp(`\\.${oldExt}$`, 'i');
            return path.replace(regex, `.${newExt}`);
          };

          if (dryRun) {
            // DRY RUN: Count what would be updated
            
            // Count content_items covers
            const contentCovers = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM content_items WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg'`
            ).first();
            stats.contentCovers = contentCovers?.count || 0;
            
            const contentLandscapes = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM content_items WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg'`
            ).first();
            stats.contentLandscapes = contentLandscapes?.count || 0;
            
            // Count episodes covers
            const episodeCovers = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM episodes WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg'`
            ).first();
            stats.episodeCovers = episodeCovers?.count || 0;
            
            // Note: episodes.cover_landscape_key column has been removed
            stats.episodeLandscapes = 0;
            
            // Count cards images
            const cardImages = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM cards WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg'`
            ).first();
            stats.cardImages = cardImages?.count || 0;
            
            // Count cards audios
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

          // LIVE MODE: Actually update the database
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          
          try {
            // Update content_items.cover_key (.jpg -> .webp)
            const r1 = await env.DB.prepare(`
              UPDATE content_items 
              SET cover_key = REPLACE(REPLACE(cover_key, '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg'
            `).run();
            stats.contentCovers = r1.meta?.changes || 0;
            
            // Update content_items.cover_landscape_key (.jpg -> .webp)
            const r2 = await env.DB.prepare(`
              UPDATE content_items 
              SET cover_landscape_key = REPLACE(REPLACE(cover_landscape_key, '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg'
            `).run();
            stats.contentLandscapes = r2.meta?.changes || 0;
            
            // Update episodes.cover_key (.jpg -> .webp)
            const r3 = await env.DB.prepare(`
              UPDATE episodes 
              SET cover_key = REPLACE(REPLACE(cover_key, '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg'
            `).run();
            stats.episodeCovers = r3.meta?.changes || 0;
            
            // Note: episodes.cover_landscape_key column has been removed
            stats.episodeLandscapes = 0;
            
            // Update cards.image_key (.jpg -> .webp)
            const r5 = await env.DB.prepare(`
              UPDATE cards 
              SET image_key = REPLACE(REPLACE(image_key, '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg'
            `).run();
            stats.cardImages = r5.meta?.changes || 0;
            
            // Update cards.audio_key (.mp3 -> .opus)
            const r6 = await env.DB.prepare(`
              UPDATE cards 
              SET audio_key = REPLACE(audio_key, '.mp3', '.${audioExtension}')
              WHERE audio_key LIKE '%.mp3'
            `).run();
            stats.cardAudios = r6.meta?.changes || 0;
            
            stats.total = stats.contentCovers + stats.contentLandscapes + stats.episodeCovers + 
                         stats.episodeLandscapes + stats.cardImages + stats.cardAudios;
            
            try { await env.DB.prepare('COMMIT').run(); } catch {}
            
            return json({
              success: true,
              dryRun: false,
              message: `Updated ${stats.total} paths successfully`,
              stats
            });
            
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Admin: Reindex FTS (ja) with mixed kanji/kana expansions from stored subtitles
      if (path === '/admin/reindex-fts-ja' && request.method === 'POST') {
        // Lightweight guard: require explicit confirm=1 query param
        if (url.searchParams.get('confirm') !== '1') {
          return json({ error: 'confirm=1 required' }, { status: 400 });
        }
        try {
          // Fetch all JA subtitles and rebuild corresponding FTS rows
          const rows = await env.DB.prepare('SELECT card_id, language, text FROM card_subtitles WHERE LOWER(language)=?').bind('ja').all();
          const items = rows.results || [];
          try { await env.DB.prepare('BEGIN TRANSACTION').run(); } catch {}
          try {
            // Clear existing JA entries in FTS
            try { await env.DB.prepare('DELETE FROM card_subtitles_fts WHERE LOWER(language)=?').bind('ja').run(); } catch {}
            // Insert rebuilt entries in batches
            const stmts = [];
            for (const r of items) {
              const idxText = expandJaIndexText(r.text);
              stmts.push(env.DB.prepare('INSERT INTO card_subtitles_fts (text, language, card_id) VALUES (?,?,?)').bind(idxText, r.language, r.card_id));
            }
            // Batch inserts to avoid exceeding limits
            for (let i = 0; i < stmts.length; i += 300) {
              const slice = stmts.slice(i, i + 300);
              if (slice.length) await env.DB.batch(slice);
            }
            try { await env.DB.prepare('COMMIT').run(); } catch {}
          } catch (e) {
            try { await env.DB.prepare('ROLLBACK').run(); } catch {}
            throw e;
          }
          return json({ ok: true, rebuilt: items.length });
        } catch (e) {
          return json({ error: String(e) }, { status: 500 });
        }
      }

      // ==================== USER PROGRESS TRACKING ====================
      
      // Mark a card as completed
      if (path === '/api/progress/complete' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, film_id, episode_slug, card_id, card_index, total_cards } = body;
          
          if (!user_id || !film_id || !episode_slug || !card_id || card_index === undefined) {
            return json({ error: 'Missing required fields' }, { status: 400 });
          }

          const now = Date.now();
          
          // Insert or update card progress (upsert using ON CONFLICT)
          await env.DB.prepare(`
            INSERT INTO user_progress (user_id, film_id, episode_slug, card_id, card_index, completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, film_id, episode_slug, card_id) 
            DO UPDATE SET completed_at = ?, updated_at = ?
          `).bind(user_id, film_id, episode_slug, card_id, card_index, now, now, now, now).run();
          
          // Update episode stats
          const completedCount = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
          `).bind(user_id, film_id, episode_slug).first();
          
          const completed = completedCount?.count || 0;
          const total = total_cards || completed; // Use provided total or fall back to completed count
          const percentage = total > 0 ? (completed / total) * 100 : 0;
          
          await env.DB.prepare(`
            INSERT INTO user_episode_stats 
              (user_id, film_id, episode_slug, total_cards, completed_cards, last_card_index, completion_percentage, last_completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, film_id, episode_slug)
            DO UPDATE SET 
              total_cards = ?,
              completed_cards = ?,
              last_card_index = ?,
              completion_percentage = ?,
              last_completed_at = ?,
              updated_at = ?
          `).bind(
            user_id, film_id, episode_slug, total, completed, card_index, percentage, now, now,
            total, completed, card_index, percentage, now, now
          ).run();
          
          return json({ 
            success: true,
            completed_cards: completed,
            total_cards: total,
            completion_percentage: percentage
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Delete progress for a specific card (mark as incomplete)
      if (path === '/api/progress/complete' && request.method === 'DELETE') {
        try {
          const body = await request.json();
          const { user_id, film_id, episode_slug, card_id, total_cards } = body;
          
          if (!user_id || !film_id || !episode_slug || !card_id) {
            return json({ error: 'Missing required fields' }, { status: 400 });
          }

          const now = Date.now();
          
          // Delete card progress
          await env.DB.prepare(`
            DELETE FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ? AND card_id = ?
          `).bind(user_id, film_id, episode_slug, card_id).run();
          
          // Update episode stats
          const completedCount = await env.DB.prepare(`
            SELECT COUNT(*) as count FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
          `).bind(user_id, film_id, episode_slug).first();
          
          const completed = completedCount?.count || 0;
          const total = total_cards || completed; // Use provided total or fall back to completed count
          const percentage = total > 0 ? (completed / total) * 100 : 0;
          
          // Get last card index if any cards remain
          const lastCard = await env.DB.prepare(`
            SELECT card_index FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
            ORDER BY card_index DESC LIMIT 1
          `).bind(user_id, film_id, episode_slug).first();
          
          const lastCardIndex = lastCard?.card_index ?? 0;
          
          await env.DB.prepare(`
            INSERT INTO user_episode_stats 
              (user_id, film_id, episode_slug, total_cards, completed_cards, last_card_index, completion_percentage, last_completed_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id, film_id, episode_slug)
            DO UPDATE SET 
              total_cards = ?,
              completed_cards = ?,
              last_card_index = ?,
              completion_percentage = ?,
              updated_at = ?
          `).bind(
            user_id, film_id, episode_slug, total, completed, lastCardIndex, percentage, now, now,
            total, completed, lastCardIndex, percentage, now
          ).run();
          
          return json({ 
            success: true,
            completed_cards: completed,
            total_cards: total,
            completion_percentage: percentage
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Get progress for a specific episode
      if (path === '/api/progress/episode' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const filmId = url.searchParams.get('film_id');
          const episodeSlug = url.searchParams.get('episode_slug');
          
          if (!userId || !filmId || !episodeSlug) {
            return json({ error: 'Missing required parameters' }, { status: 400 });
          }
          
          // Get episode stats
          const stats = await env.DB.prepare(`
            SELECT * FROM user_episode_stats 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
          `).bind(userId, filmId, episodeSlug).first();
          
          // Get all completed cards for this episode
          const cards = await env.DB.prepare(`
            SELECT * FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
            ORDER BY card_index ASC
          `).bind(userId, filmId, episodeSlug).all();
          
          const completed = cards.results || [];
          const completedCardIds = completed.map(c => c.card_id);
          const completedIndices = completed.map(c => c.card_index);
          
          return json({
            episode_stats: stats || null,
            completed_cards: completed,
            completed_card_ids: completedCardIds,
            completed_indices: completedIndices
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Get all progress for a film (all episodes)
      if (path === '/api/progress/film' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const filmId = url.searchParams.get('film_id');
          
          if (!userId || !filmId) {
            return json({ error: 'Missing required parameters' }, { status: 400 });
          }
          
          const stats = await env.DB.prepare(`
            SELECT * FROM user_episode_stats 
            WHERE user_id = ? AND film_id = ?
            ORDER BY episode_slug ASC
          `).bind(userId, filmId).all();
          
          return json(stats.results || []);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Reset progress for an episode
      if (path === '/api/progress/reset' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, film_id, episode_slug } = body;
          
          if (!user_id || !film_id || !episode_slug) {
            return json({ error: 'Missing required fields' }, { status: 400 });
          }
          
          // Delete all card progress for this episode
          await env.DB.prepare(`
            DELETE FROM user_progress 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
          `).bind(user_id, film_id, episode_slug).run();
          
          // Delete episode stats
          await env.DB.prepare(`
            DELETE FROM user_episode_stats 
            WHERE user_id = ? AND film_id = ? AND episode_slug = ?
          `).bind(user_id, film_id, episode_slug).run();
          
          return json({ success: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get SRS state distribution for a film
      if (path === '/api/srs/distribution' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const filmId = url.searchParams.get('film_id');
          
          if (!userId || !filmId) {
            return json({ error: 'Missing required parameters (user_id, film_id)' }, { status: 400 });
          }
          
          // Get total number of cards in this film
          const filmRow = await env.DB.prepare(`
            SELECT num_cards FROM content_items WHERE slug = ?
          `).bind(filmId).first();
          
          const totalCards = filmRow?.num_cards || 0;
          
          // Get SRS state distribution from user_card_states
          const srsStats = await env.DB.prepare(`
            SELECT srs_state, COUNT(*) as count
            FROM user_card_states
            WHERE user_id = ? AND film_id = ?
            GROUP BY srs_state
          `).bind(userId, filmId).all();
          
          const stats = srsStats.results || [];
          const savedCards = stats.reduce((sum, row) => sum + (row.count || 0), 0);
          
          // Calculate distribution
          const distribution = {
            none: 0,
            new: 0,
            again: 0,
            hard: 0,
            good: 0,
            easy: 0
          };
          
          if (totalCards === 0) {
            // No cards in film, all none
            distribution.none = 100;
          } else if (savedCards === 0) {
            // No cards saved, all none
            distribution.none = 100;
          } else {
            // Calculate percentages based on saved cards
            stats.forEach((row) => {
              const state = row.srs_state || 'none';
              const count = row.count || 0;
              if (state in distribution) {
                distribution[state] = Math.round((count / totalCards) * 100);
              }
            });
            
            // Calculate none percentage (cards not saved)
            const noneCount = totalCards - savedCards;
            distribution.none = Math.round((noneCount / totalCards) * 100);
            
            // Normalize to ensure total is 100%
            const total = Object.values(distribution).reduce((a, b) => a + b, 0);
            if (total !== 100) {
              const diff = 100 - total;
              // Adjust the largest non-none value
              const nonNoneStates = ['new', 'again', 'hard', 'good', 'easy'];
              let maxState = 'new';
              let maxValue = distribution.new;
              nonNoneStates.forEach(state => {
                if (distribution[state] > maxValue) {
                  maxValue = distribution[state];
                  maxState = state;
                }
              });
              distribution[maxState] += diff;
            }
          }
          
          return json(distribution);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // ==================== USER MANAGEMENT ====================
      
      // Register/Create user (upsert)
      if (path === '/api/users/register' && request.method === 'POST') {
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
      }
      
      // Update last login
      if (path === '/api/users/login' && request.method === 'POST') {
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
      }
      
      // Get user profile
      if (path.match(/^\/api\/users\/[^\/]+$/) && request.method === 'GET') {
        try {
          const userId = path.split('/').pop();
          
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
      }
      
      // Update user profile
      if (path.match(/^\/api\/users\/[^\/]+$/) && request.method === 'PUT') {
        try {
          const userId = path.split('/').pop();
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
      }
      
      // Delete user (deactivate only - set is_active to false)
      if (path.match(/^\/api\/users\/[^\/]+$/) && request.method === 'DELETE') {
        try {
          const userId = path.split('/').pop();
          
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
      }
      
      // Get user preferences
      if (path.match(/^\/api\/users\/[^\/]+\/preferences$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[3];
          
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
      }
      
      // Update user preferences
      if (path.match(/^\/api\/users\/[^\/]+\/preferences$/) && request.method === 'PUT') {
        try {
          const userId = path.split('/')[3];
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
      }
      
      
      // Get user statistics
      if (path.match(/^\/api\/users\/[^\/]+\/stats$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[3];
          
          const stats = await env.DB.prepare(`
            SELECT * FROM v_user_stats WHERE user_id = ?
          `).bind(userId).first();
          
          return json(stats || {});
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get all users (admin endpoint)
      if (path === '/api/users' && request.method === 'GET') {
        try {
          const users = await env.DB.prepare(`
            SELECT * FROM v_user_profiles ORDER BY created_at DESC
          `).all();
          
          return json(users.results || []);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Get user roles
      if (path.match(/^\/api\/users\/[^\/]+\/roles$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[3];
          
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
      }

      // Get user progress details (admin endpoint)
      if (path.match(/^\/api\/users\/[^\/]+\/progress$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[3];
          
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
      }

      // ==================== ADMIN ROLE MANAGEMENT ====================

      // Get database table statistics (superadmin only)
      if (path === '/api/admin/database-stats' && request.method === 'GET') {
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
      }

      // Get table data (superadmin only)
      if (path.match(/^\/api\/admin\/table-data\/[a-z_]+$/i) && request.method === 'GET') {
        try {
          const tableName = path.split('/')[4];
          const url = new URL(request.url);
          const limit = parseInt(url.searchParams.get('limit') || '100', 10);
          
          // Whitelist of allowed tables
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
      }

      // Update table record (superadmin only)
      if (path.match(/^\/api\/admin\/table-data\/[a-z_]+\/[^\/]+$/i) && request.method === 'PUT') {
        try {
          const parts = path.split('/');
          const tableName = parts[4];
          const recordId = parts[5];
          const body = await request.json();
          
          // Whitelist of allowed tables
          const allowedTables = [
            'users', 'auth_providers', 'user_logins', 'roles', 'user_roles',
            'user_preferences', 'user_study_sessions',
            'user_progress', 'user_episode_stats'
          ];
          
          if (!allowedTables.includes(tableName)) {
            return json({ error: 'Invalid table name' }, { status: 400 });
          }
          
          // Build UPDATE query dynamically
          const fieldsToUpdate = Object.keys(body).filter(key => 
            key !== 'id' && key !== 'uid' && key !== 'created_at' // Don't update primary keys or created_at
          );
          
          if (fieldsToUpdate.length === 0) {
            return json({ error: 'No fields to update' }, { status: 400 });
          }
          
          const setClause = fieldsToUpdate.map(key => `${key} = ?`).join(', ');
          const values = fieldsToUpdate.map(key => body[key]);
          
          // Determine primary key column (id or uid)
          let primaryKeyColumn = 'id';
          if (tableName === 'users' || tableName === 'user_logins' || tableName === 'user_roles' || 
              tableName === 'user_preferences' || tableName === 'user_study_sessions' || 
              tableName === 'user_progress' || tableName === 'user_episode_stats') {
            // Check if uid exists for this table
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
      }

      // Delete table record (superadmin only)
      if (path.match(/^\/api\/admin\/table-data\/[a-z_]+\/[^\/]+$/i) && request.method === 'DELETE') {
        try {
          const parts = path.split('/');
          const tableName = parts[4];
          const recordId = parts[5];
          
          // Whitelist of allowed tables
          const allowedTables = [
            'users', 'auth_providers', 'user_logins', 'roles', 'user_roles',
            'user_preferences', 'user_study_sessions',
            'user_progress', 'user_episode_stats'
          ];
          
          if (!allowedTables.includes(tableName)) {
            return json({ error: 'Invalid table name' }, { status: 400 });
          }
          
          // Determine primary key column (id or uid)
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
      }

      // Sync admin roles from environment variable (admin only)
      if (path === '/api/admin/sync-roles' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { adminEmails, requesterId } = body;
          
          if (!adminEmails || !Array.isArray(adminEmails)) {
            return json({ error: 'adminEmails array is required' }, { status: 400 });
          }
          
          // Check if requester is already an admin
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
            // Find user by email
            const user = await env.DB.prepare(`
              SELECT id, is_admin, role FROM users WHERE email = ?
            `).bind(email).first();
            
            if (user) {
              // Update user to admin
              await env.DB.prepare(`
                UPDATE users SET is_admin = 1, role = 'admin', updated_at = ? WHERE id = ?
              `).bind(now, user.id).run();
              
              // Add admin role to user_roles if not exists
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
      }

      // Get user roles (admin endpoint)
      if (path.match(/^\/api\/users\/[^\/]+\/roles$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[3];
          
          const roles = await env.DB.prepare(`
            SELECT ur.*, r.description, r.permissions
            FROM user_roles ur
            JOIN roles r ON ur.role_name = r.name
            WHERE ur.user_id = ?
            AND (ur.expires_at IS NULL OR ur.expires_at > ?)
            ORDER BY ur.granted_at DESC
          `).bind(userId, Date.now()).all();
          
          return json(roles.results || []);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get user roles - Admin endpoint (returns array of role names)
      if (path.match(/^\/api\/admin\/user-roles\/[^\/]+$/) && request.method === 'GET') {
        try {
          const userId = path.split('/')[4];
          
          const roles = await env.DB.prepare(`
            SELECT role_name FROM user_roles WHERE user_id = ?
          `).bind(userId).all();
          
          const roleNames = roles.results?.map(r => r.role_name) || [];
          
          return json({ roles: roleNames });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Update user roles - Admin endpoint (superadmin only)
      if (path.match(/^\/api\/admin\/user-roles\/[^\/]+$/) && request.method === 'PUT') {
        try {
          const userId = path.split('/')[4];
          const body = await request.json();
          const { roles, requesterId } = body;
          
          if (!roles || !Array.isArray(roles)) {
            return json({ error: 'roles array is required' }, { status: 400 });
          }
          
          if (!requesterId) {
            return json({ error: 'requesterId is required' }, { status: 400 });
          }
          
          // Check if requester is superadmin
          const requesterRoles = await env.DB.prepare(`
            SELECT role_name FROM user_roles WHERE user_id = ?
          `).bind(requesterId).all();
          
          const isSuperAdmin = requesterRoles.results?.some(r => r.role_name === 'superadmin');
          
          if (!isSuperAdmin) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }
          
          // Validate roles
          const validRoles = ['user', 'admin', 'superadmin'];
          for (const role of roles) {
            if (!validRoles.includes(role)) {
              return json({ error: `Invalid role: ${role}` }, { status: 400 });
            }
          }
          
          const now = Date.now();
          
          // Remove all existing roles for this user
          await env.DB.prepare(`
            DELETE FROM user_roles WHERE user_id = ?
          `).bind(userId).run();
          
          // Insert new roles
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
      }

      return new Response('Not found', { status: 404, headers: withCors() });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  }
};
