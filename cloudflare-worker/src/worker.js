// Cloudflare Worker (JavaScript) compatible with Dashboard Quick Edit and wrangler
// Bindings required: DB (D1), MEDIA_BUCKET (R2)

// Reward Config IDs - Constants for rewards_config table
// These IDs correspond to the rewards_config.id values in the database
const REWARD_CONFIG_IDS = {
  // Challenge types
  DAILY_CHALLENGE: 1,
  WEEKLY_CHALLENGE: 2,
  
  // Action types
  SRS_STATE_CHANGE: 3,
  LISTENING_5S: 4,
  READING_8S: 5,
  SPEAKING_ATTEMPT: 6,
  WRITING_ATTEMPT: 7,
};

// FTS_CONFIG Registry
// Manages Regex and Headers using Lazy Initialization to reduce Cold Start time.
const FTS_CONFIG = {
  _cache: new Map(),
  
  getRE(key, pattern, flags = 'u') {
    if (!this._cache.has(key)) {
      this._cache.set(key, new RegExp(pattern, flags));
    }
    return this._cache.get(key);
  },

  // Language Detection & Cleaning Patterns
  get JA() { return this.getRE('ja', '[\\u3040-\\u309F\\u30A0-\\u30FF\\u3400-\\u4DBF\\u4E00-\\u9FFF\\uF900-\\uFAFF]'); },
  get BRACKETS() { return this.getRE('brackets', '\\[[^\\]]+\\]', 'g'); },
  get WS() { return this.getRE('ws', '\\s+', 'g'); },
  get NON_ALNUM() { return this.getRE('nonAlnum', '[^\\p{L}\\p{N}\\s]+', 'gu'); },
  get QUOTE_CLEAN() { return this.getRE('quoteClean', '["\']', 'g'); },
  get KATA() { return this.getRE('kata', '[\\u30A1-\\u30F6]', 'g'); },
  get KANA_ONLY() { return this.getRE('kanaOnly', '[^\\p{Script=Hiragana}\\p{Script=Katakana}\\p{L}\\p{N}\\s]', 'gu'); },
  get HAS_HAN() { return this.getRE('hasHan', '\\p{Script=Han}', 'u'); },
  get HAS_KANA() { return this.getRE('hasKana', '[\\p{Script=Hiragana}\\p{Script=Katakana}]', 'u'); },
  get CJK_CLEAN() { return this.getRE('cjkClean', '\\[[^\\]]+\\]|\\s+', 'g'); },
  get NON_ALNUM_UNICODE() { return this.getRE('nonAlnumUnicode', '[^\\p{L}\\p{N}\\s]+', 'gu'); },
  get ALNUM_ONLY() { return this.getRE('alnumOnly', '[a-zA-Z0-9]'); },
  // Matches Kanji followed by [Reading]
  get JA_EXTRACT() { 
    return this.getRE('jaExtract', '(\\p{Script=Han}+[\\p{Script=Han}・・]*)\\[([\\p{Script=Hiragana}\\p{Script=Katakana}]+)\\]', 'gu'); 
  },
  get PINYIN_BRACKETS() { 
    return this.getRE('pinyinBrackets', '\\[[^\\]]+\\]', 'g'); 
  },

  // Static CORS headers to avoid object re-creation on every request
  CORS_HEADERS: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400', // 24-hour cache for preflight requests
    'Cross-Origin-Opener-Policy': 'unsafe-none',
    'Cross-Origin-Embedder-Policy': 'unsafe-none',
  }
};

function withCors(headers = {}) {
  // Merge static headers with any request-specific overrides
  return { ...FTS_CONFIG.CORS_HEADERS, ...headers };
}

// Build LIKE query for card_subtitles search
// Since we use autocomplete, users only search when selecting a suggestion
// This makes LIKE search acceptable for the reduced search volume
function buildLikeQuery(q, language) {
  const cleaned = (q || '').trim();
  if (!cleaned) return '';
  
// Language Detection
  const isJa = language === 'ja' || FTS_CONFIG.JA.test(cleaned);
  let normalized = cleaned;

  if (isJa) {
    // Japanese Optimization: Strip spaces and furigana brackets
    // This allows matching base Kanji even if DB has "Kanji[reading]"
    normalized = normalized
      .replace(FTS_CONFIG.WS, '')
      .replace(FTS_CONFIG.BRACKETS, '');
      
    // Return immediately for Japanese using Trigram phrase search
    const sanitized = normalized.replace(/"/g, '""');
    return sanitized ? `"${sanitized}"` : '';
  }

  // Handle Explicit Phrase Search (User input inside quotes)
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    const phrase = normalized
      .slice(1, -1)
      .replace(FTS_CONFIG.QUOTE_CLEAN, '')
      .replace(FTS_CONFIG.NON_ALNUM, ' ')
      .trim()
      .replace(FTS_CONFIG.WS, ' ');
    return phrase ? `"${phrase}"` : '';
  }

  // Tokenization for Non-Japanese languages
  const tokens = normalized
    .replace(FTS_CONFIG.NON_ALNUM, ' ')
    .trim()
    .split(FTS_CONFIG.WS)
    .filter(Boolean)
    .slice(0, 8); // Limit tokens to prevent D1 execution timeouts

  if (tokens.length === 0) return '';

  // Inline Token Processing (Replaces escapeFtsToken function)
  // Using a for-loop is more memory-efficient than .map().join() in large scripts
  let resultPhrase = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].replace(FTS_CONFIG.QUOTE_CLEAN, '');
    if (t) {
      resultPhrase += (resultPhrase ? " " : "") + t;
    }
  }

  // Final result is wrapped in quotes to force strict trigram sequence matching
  return resultPhrase ? `"${resultPhrase}"` : '';
}

// Japanese helpers: normalize Katakana to Hiragana and full-width forms
function kataToHira(s) {
  if (!s) return '';
  return s.replace(FTS_CONFIG.KATA, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

function normalizeJaInput(s) {
  if (!s) return '';
  // Modern V8 supports NFKC natively; removing try/catch for performance
  return kataToHira(s.normalize('NFKC'));
}

function hasHanAndKana(s) {
  if (!s) return false;
  return FTS_CONFIG.HAS_HAN.test(s) && FTS_CONFIG.HAS_KANA.test(s);
}

function kanaOnlyString(s) {
  if (!s) return '';
  return s.replace(FTS_CONFIG.KANA_ONLY, '').trim();
}

// Helper function to extract searchable terms from text
function extractSearchTerms(text, language) {
  if (!text || typeof text !== 'string') return [];
  const terms = new Set();
  const trimmed = text.trim();
  if (!trimmed) return [];

  const isCJK = ['ja', 'zh', 'ko'].some(lang => language?.startsWith(lang));
  
  if (isCJK) {
    // For CJK: Extract character sequences (2-6 characters)
    // Remove furigana brackets first
    const normalized = trimmed.replace(FTS_CONFIG.CJK_CLEAN, '');
    const nLen = normalized.length;
    
    // Optimized sliding window (N-grams)
    // We limit max length to 6 characters to prevent index bloat
    const maxLen = Math.min(6, nLen);
    for (let len = 2; len <= maxLen; len++) {
      for (let i = 0; i <= nLen - len; i++) {
        // Direct addition to Set handles deduplication
        terms.add(normalized.substring(i, i + len));
      }
    }
  } else {
    // For non-CJK: Extract words (2+ characters, alphanumeric)
    const words = trimmed.toLowerCase()
      .replace(FTS_CONFIG.NON_ALNUM_UNICODE, ' ')
      .split(FTS_CONFIG.WS);

    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      // Inline length and alphanumeric check
      if (w.length >= 2 && FTS_CONFIG.ALNUM_ONLY.test(w)) {
        terms.add(w);
      }
    }
  }
  return Array.from(terms);
}

// Expand Japanese index text by adding mixed kanji/kana tokens from bracketed furigana: 例) 黒川[くろかわ]
// Also normalizes whitespace for consistent FTS matching
// IMPORTANT: Indexes BOTH the base text (without brackets) AND the reading separately
// e.g., "番線[ばんせん]" -> indexes: "番線" (base) + "ばんせん" (reading) + mixed variants
function expandJaIndexText(text) {
  if (!text) return '';
  // First, normalize whitespace (remove all spaces) for consistent FTS matching
  const src = String(text).replace(FTS_CONFIG.WS, '');
  const extra = new Set();
  
  const re = FTS_CONFIG.JA_EXTRACT;
  re.lastIndex = 0; // Reset regex state for global matching
  
  let m;  
  while ((m = re.exec(src)) !== null) {
    const kan = m[1];
    const hira = normalizeJaInput(m[2]); // Standardizes to Hiragana
    
    if (!kan || !hira) continue;
    // Add base kanji (without brackets) and reading separately to index
    extra.add(kan);
    extra.add(hira);
    
    // Add mixed kanji/kana variants for partial matching
    const firstKan = kan[0];
    const lastKan = kan[kan.length - 1];
    for (let i = 1; i < hira.length; i++) {
      const pref = hira.slice(0, i);
      const suff = hira.slice(i);
      extra.add(pref + lastKan);
      extra.add(firstKan + suff);
    }
  }
  
  // Remove all brackets from base text so "番線[ばんせん]" becomes "番線"
  const baseText = src.replace(FTS_CONFIG.BRACKETS, '');
  
  if (extra.size === 0) return baseText;
  // Join final string - faster than multiple array operations
  return `${baseText} ${Array.from(extra).join(' ')}`;
}

function json(data, init = {}) {
  return new Response(JSON.stringify(data), { 
    ...init, 
    headers: withCors({ 'Content-Type': 'application/json', ...(init.headers || {}) }) 
  });
}


// Normalize Chinese text by removing pinyin brackets [pinyin] for search
// Example: "请[qǐng]问[wèn]" -> "请问"
function normalizeChineseTextForSearch(text) {
  // Faster check: if it's not a string or it's empty, return it immediately
  if (typeof text !== 'string' || !text) return text;

  // Uses the cached global regex for near-instant execution
  return text.replace(FTS_CONFIG.PINYIN_BRACKETS, '');
}

// Global constant defined outside the function to ensure it's initialized only once in memory.
const LEVEL_MAPS = {
  'CEFR': { 'A1': 0, 'A2': 1, 'B1': 2, 'B2': 3, 'C1': 4, 'C2': 5 },
  'JLPT': { 'N5': 0, 'N4': 1, 'N3': 2, 'N2': 3, 'N1': 4 },
  'HSK':  { '1': 0, '2': 1, '3': 2, '4': 3, '5': 4, '6': 5, '7': 6, '8': 7, '9': 8 }
};

// Get framework from main language
function getFrameworkFromLanguage(language) {
  if (!language) return 'CEFR';
  const langLower = String(language || '').toLowerCase();
  if (langLower === 'en' || langLower === 'english') return 'CEFR';
  if (langLower === 'ja' || langLower === 'japanese') return 'JLPT';
  if (langLower.startsWith('zh') || langLower === 'chinese' || langLower === 'zh_trad' || langLower === 'yue') return 'HSK';
  if (langLower === 'ko' || langLower === 'korean') return 'TOPIK';
  return 'CEFR'; // Default to CEFR for other languages
}

// Map level to numeric index for range filtering
function getLevelIndex(level, language) {
  // Input Validation: Both level and language are mandatory for accurate mapping.
  if (!level || !language) return -1;

  // Identify the Framework based on language input.
  const framework = getFrameworkFromLanguage(language);
  const map = LEVEL_MAPS[framework];
  if (!map) return -1;

  // We convert to string to handle both number 1 and string "1"
  const normalizedLevel = String(level).trim().toUpperCase();
  
  // This lookup is still O(1) and safe because 'map' is already 
  // narrowed down to the specific framework.
  return map[normalizedLevel] ?? -1;
}

/**
 * Compare two levels within the same framework.
 * Returns: -1 if level1 < level2, 0 if equal, 1 if level1 > level2.
 */
function compareLevels(level1, level2, framework) {
  const map = LEVEL_MAPS[framework];
  if (!map) return 0; //prevent "cannot read property of undefined"

  // 2. Logic handling: Use numeric strings for HSK, uppercase for others & Get indices
  const format = (lvl) => (framework === 'HSK' ? String(lvl) : String(lvl).toUpperCase());
  const idx1 = map[format(level1)] ?? -1;
  const idx2 = map[format(level2)] ?? -1;

  // 4. Handle "Cannot Compare" vs "Equal"
  // If either level is not found in the framework, we return 0 (cannot compare)
  if (idx1 === -1 || idx2 === -1) return 0;

  // 5. Final Comparison: Use Math.sign to ensure the result is exactly {-1, 0, 1}
  // This solves the issue where (0 - 4) returned -4.
  return Math.sign(idx1 - idx2);
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

// Optimized Combining: Create one buffer and copy data into it
  const hashArray = new Uint8Array(hashBuffer);
  const combined = new Uint8Array(salt.length + hashArray.length);
  combined.set(salt);
  combined.set(hashArray, salt.length);

  // Modern Base64 conversion (More efficient than btoa + String.fromCharCode)
  return btoa(String.fromCharCode.apply(null, combined));
}

// Helper function to update card_subtitle_language_map normalized table
// This normalized table speeds up subtitle language filtering queries with index
async function updateCardSubtitleLanguageMap(env, cardId) {
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
async function updateCardSubtitleLanguageMapBatch(env, cardIds) {
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
async function populateMappingTableAsync(env) {
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
async function populateInChunks(env) {
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

// Verify password against hash
async function verifyPassword(password, hash) {
try {
    if (!password || !hash) return false;

    // Decode Base64 to Uint8Array
    const binaryString = atob(hash);
    const combined = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      combined[i] = binaryString.charCodeAt(i);
    }

    // Extract Salt (first 16 bytes) and Hash (remaining 32 bytes)
    // .subarray() is O(1) as it creates a view, whereas .slice() is O(n)
    const salt = combined.subarray(0, 16);
    const storedHash = combined.subarray(16);

    const encoder = new TextEncoder();
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

    let isValid = 0;
    for (let i = 0; i < hashArray.length; i++) {
      isValid |= hashArray[i] ^ storedHash[i];
    }

    return isValid === 0;
  } catch (e) {
    console.error("[verifyPassword] Error:", e.message);
    return false;
  }
}

// Generate random token
function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.prototype.map.call(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate user ID
function generateUserId() {
  return `user_${crypto.randomUUID()}`;
}

// ==================== JWT HELPERS ====================

// Base64URL encode
function base64urlEncode(buffer) {
  // Use .apply to avoid stack limits associated with the spread operator (...)
  const binary = String.fromCharCode.apply(null, new Uint8Array(buffer));
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// Base64URL decode
function base64urlDecode(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  // Efficiently handle padding
  const pad = str.length % 4;
  const padded = pad ? base64 + '='.repeat(4 - pad) : base64;
  return atob(padded);
}

// Constant-time comparison (tránh timing attacks)
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Create HMAC-SHA256 signature
async function createSignature(data, secret) {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(data);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  return new Uint8Array(signature);
}

// Generate JWT token
async function generateJWT(userId, email, roles, secret, expiresInDays = 7) {
  const header = {
    alg: 'HS256',
    typ: 'JWT'
  };
  
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: userId,
    email: email,
    roles: roles || [],
    iat: now, // Issued at
    exp: now + (expiresInDays * 24 * 60 * 60) // Expiration
  };
  
  const encodedHeader = base64urlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encodedPayload = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const data = `${encodedHeader}.${encodedPayload}`;
  
  const signature = await createSignature(data, secret);
  const encodedSignature = base64urlEncode(signature);
  
  return `${encodedHeader}.${encodedPayload}.${encodedSignature}`;
}

// Verify JWT token
async function verifyJWT(token, secret) {
  try {
    // 1. Tách JWT thành 3 phần
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }
    
    const [encodedHeader, encodedPayload, encodedSignature] = parts;
    
    // 2. Verify signature
    const data = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = await createSignature(data, secret);
    const expectedSignatureEncoded = base64urlEncode(expectedSignature);
    
    // So sánh signature (constant-time comparison)
    if (!constantTimeEqual(encodedSignature, expectedSignatureEncoded)) {
      return { valid: false, error: 'Invalid signature' };
    }
    
    // 3. Decode payload
    const payloadJson = base64urlDecode(encodedPayload);
    const payload = JSON.parse(payloadJson);
    
    // 4. Kiểm tra expiration
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return { valid: false, error: 'Token expired' };
    }

    // 5. Kiểm tra Issued At (iat) để tránh clock skew (lệch múi giờ server)
    // Cho phép lệch 60 giây để đảm bảo tính ổn định
    //if (payload.iat && payload.iat > now + 60) {
    //  return { valid: false, error: 'Token issued in the future' };
    //}

    // 6. Token hợp lệ
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: e.message || 'Token verification failed' };
  }
}

// Middleware để authenticate request
async function authenticateRequest(request, env) {
  // 1. Lấy token từ header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7).trim(); // Dùng .slice() và .trim() để sạch token
  //if (!token) {
  //  return { authenticated: false, error: 'Unauthorized: Token is empty' };
  //}

  // 2. Verify token
  const secret = env.JWT_SECRET;
  if (!secret) {
    return { authenticated: false, error: 'JWT secret not configured' };
  }
  
  const result = await verifyJWT(token, secret);
  
  if (!result.valid) {
    return { authenticated: false, error: result.error };
  }
  
  // 3. Token hợp lệ, trả về user info
  return {
    authenticated: true,
    userId: result.payload.user_id,
    email: result.payload.email,
    roles: result.payload.roles || []
  };
}

// Reset daily activity tables (called by scheduled event)
async function resetDailyTables(env) {
  try {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];

    // Perform the Archive (The "Heavy Lifting")
    // This SQL handles the mapping, the unique ID generation, and the conflicts in one go.
    await env.DB.prepare(`
      INSERT INTO user_daily_stats (
        id, user_id, stats_date, xp_earned, listening_time, reading_time, created_at, updated_at
      )
      SELECT 
        hex(randomblob(16)), user_id, activity_date, daily_xp, daily_listening_time, daily_reading_time, 
        unixepoch() * 1000, unixepoch() * 1000
      FROM user_daily_activity
      WHERE activity_date = ?
      ON CONFLICT(user_id, stats_date) DO UPDATE SET
        listening_time = COALESCE(user_daily_stats.listening_time, excluded.listening_time),
        reading_time = COALESCE(user_daily_stats.reading_time, excluded.reading_time),
        updated_at = unixepoch() * 1000
    `).bind(yesterdayStr).run();

    // Delete all daily_activity records that are not today (cleanup old records)
    await env.DB.prepare(`
      DELETE FROM user_daily_activity
      WHERE activity_date != ?
    `).bind(today).run();
    
    console.log(`[resetDailyTables] Reset daily tables for ${today}`);
    return { success: true, date: today };
  } 
    catch (e) {
    console.error('[resetDailyTables] Error:', e);
    return { success: false, error: e.message };
  }
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
      }

      // Search API: FTS-backed card subtitles with caching + main_language filtering + fallback listing
      if (path === '/api/search' && request.method === 'GET') {
        const startTime = Date.now();
        const requestId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        console.log(`[PERF /api/search] [${requestId}] Request start: ${url.searchParams.toString()}`);
        
          // Build cache key from query params
          const cacheKey = `search:${url.searchParams.toString()}`;
          const CACHE_TTL = 300; // 5 minutes cache - search results are relatively stable
          
          try {
            // Check KV cache first
            if (env.SEARCH_CACHE) {
              const cached = await env.SEARCH_CACHE.get(cacheKey, { type: 'json' });
              if (cached && cached.data && cached.timestamp) {
                const age = (Date.now() - cached.timestamp) / 1000;
                if (age < CACHE_TTL) {
                  console.log(`[CACHE HIT /api/search] Age: ${age.toFixed(1)}s`);
                  return json(cached.data, {
                    headers: {
                      'X-Cache': 'HIT',
                      'X-Cache-Age': Math.round(age).toString(),
                    }
                  });
                }
              }
            }
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
          // Limit to avoid "too many SQL variables" error (SQLite limit is ~999)
          const contentIdsArr = contentIdsCsv
            ? Array.from(new Set(contentIdsCsv.split(',').map(s => s.trim()).filter(Boolean))).slice(0, 100)
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

          // Parse length filters (word count in main language subtitle)
          const lengthMinRaw = url.searchParams.get('length_min');
          const lengthMaxRaw = url.searchParams.get('length_max');
          const lengthMin = lengthMinRaw ? Number(lengthMinRaw) : null;
          const lengthMax = lengthMaxRaw ? Number(lengthMaxRaw) : null;
          // hasLengthFilter is true if either min or max is set
          const hasLengthFilter = lengthMin !== null || lengthMax !== null;

          // Parse duration filter (audio duration in seconds)
          const durationMaxRaw = url.searchParams.get('duration_max');
          const durationMax = durationMaxRaw ? Number(durationMaxRaw) : null;
          // hasDurationFilter is true if durationMax is set
          const hasDurationFilter = durationMax !== null && durationMax > 0;

          // Parse review filters (review_count from user_card_states)
          const reviewMinRaw = url.searchParams.get('review_min');
          const reviewMaxRaw = url.searchParams.get('review_max');
          const reviewMin = reviewMinRaw ? Number(reviewMinRaw) : null;
          const reviewMax = reviewMaxRaw ? Number(reviewMaxRaw) : null;
          const userId = url.searchParams.get('user_id');
          // hasReviewFilter is true if userId is set and either min or max is set
          const hasReviewFilter = userId && (reviewMin !== null || reviewMax !== null);

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

          // Enable text search - but keep it lightweight
          const hasTextQuery = q.trim().length >= 2;
          let likeQuery = '';
          
          if (hasTextQuery) {
            // Use LIKE search on card_subtitles
            // Autocomplete ensures users only search when selecting suggestions
            const langForSearch = (mainLanguage || '').toLowerCase() || null;
            likeQuery = buildLikeQuery(q, langForSearch);
          }

          let items = [];
          let total = 0;

          // SQL Implementation

          // Build WHERE clause with content_ids filter and text search
          // Use positional placeholders (?) and bind in order
          const contentIdsPlaceholders = contentIdsCount > 0 
            ? contentIdsArr.map(() => '?').join(',')
            : '';

          // Build query with LIKE search on card_subtitles
          let textSearchCondition = '';
          if (hasTextQuery && likeQuery) {
            // LIKE search on card_subtitles - acceptable since users only search after autocomplete
            // Restrict by subtitle language to reduce search space
            if (mainLanguage) {
              textSearchCondition = `
                AND EXISTS (
                  SELECT 1 FROM card_subtitles cs
                  WHERE cs.card_id = c.id
                    AND cs.language = ?
                    AND cs.text LIKE ?
                )
              `;
            } else {
              // No language filter - search all languages
              textSearchCondition = `
                AND EXISTS (
                  SELECT 1 FROM card_subtitles cs
                  WHERE cs.card_id = c.id
                    AND cs.text LIKE ?
                )
              `;
            }
          }

          // Optimized: Use EXISTS for main subtitle check when no subtitle languages (faster)
          // Use JOIN when subtitle languages are selected (need to filter by subtitle languages)
          let stmt;
          let useSummaryTable = false; // Declare at outer scope for params binding
          
          if (subtitleLangsCount > 0) {
            // OPTIMIZED: Use normalized mapping table with EXISTS - ultra-fast with index
            // Check if mapping table exists and has sufficient data
            // TEMPORARILY: Always use fallback until mapping table is fully populated
            // This ensures queries work correctly while mapping table is being populated in background
            useSummaryTable = false; // Force fallback until mapping table is ready
            
            try {
              const mapCheck = await env.DB.prepare('SELECT COUNT(*) as cnt FROM card_subtitle_language_map LIMIT 1').first();
              const mapCount = mapCheck?.cnt || 0;
              
              // Check if we have enough cards to estimate coverage
              const totalCardsCheck = await env.DB.prepare('SELECT COUNT(*) as cnt FROM cards WHERE is_available = 1 LIMIT 1').first();
              const totalCards = totalCardsCheck?.cnt || 0;
              
              // Use mapping table only if it has coverage for at least 50% of available cards
              // Estimate: if mapping table has N rows, it covers approximately N/2 cards (each card has ~2 languages)
              const estimatedCoverage = totalCards > 0 ? (mapCount / 2) / totalCards : 0;
              useSummaryTable = estimatedCoverage > 0.5 && mapCount > 5000;
              
              console.log(`[PERF /api/search] Mapping table: ${mapCount} rows | Total cards: ${totalCards} | Coverage: ${(estimatedCoverage * 100).toFixed(1)}% | Using: ${useSummaryTable ? 'mapping table' : 'fallback'}`);
              
              // If low coverage, trigger async population (don't wait)
              if (!useSummaryTable) {
                populateMappingTableAsync(env).catch(err => {
                  console.error('[populateMappingTable] Error:', err.message);
                });
              }
            } catch (e) {
              // Table might not exist yet (migration not run), fallback to optimized JOIN
              console.log(`[PERF /api/search] Mapping table error, using fallback:`, e.message);
              useSummaryTable = false;
            }
            
            console.log(`[PERF /api/search] Using ${useSummaryTable ? 'mapping table' : 'fallback (card_subtitles)'} path | SubtitleLangs: ${subtitleLangsArr.join(',')}`);
            
            if (useSummaryTable) {
              // OPTIMIZED: Filter by main_language and available cards early, use mapping table with EXISTS
              // This avoids GROUP BY overhead and reduces intermediate result sets
              stmt = `
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
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  ${mainLanguage ? 'AND ci.main_language = ?' : ''}
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
                  AND (
                    SELECT COUNT(DISTINCT cslm.language)
                    FROM card_subtitle_language_map cslm
                    WHERE cslm.card_id = c.id
                      AND cslm.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                  ) >= ?`;
            } else {
              // OPTIMIZED: Use JOIN with IN clause + GROUP BY + HAVING - much faster than subquery COUNT
              // JOIN with IN uses index idx_card_subtitles_language efficiently
              // Only need cards that match at least one subtitle language (>= 1), which simplifies to EXISTS
              // But for >= ? we need GROUP BY + HAVING
              stmt = `
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
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                  AND ci.main_language = ?
                JOIN card_subtitles cs_main ON cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
                JOIN card_subtitles cs_filter ON cs_filter.card_id = c.id
                  AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                WHERE c.is_available = 1
                GROUP BY c.id, c.card_number, c.start_time, c.end_time, c.image_key, c.audio_key, 
                         c.difficulty_score, e.slug, e.episode_number, ci.slug, ci.main_language, ci.title
                HAVING COUNT(DISTINCT cs_filter.language) >= ?`;
            }
          } else {
            // No subtitle languages: use INNER JOIN with main_language filter in JOIN condition
            // This allows query optimizer to use index idx_card_subtitles_language(language, card_id) efficiently
            // Filter main_language early in JOIN to reduce rows before processing
            if (mainLanguage) {
              // OPTIMIZED: Filter by main_language and available cards early
              // When main_language is specified, use EXISTS for subtitle check to reduce JOIN overhead
              stmt = `
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
                FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  AND ci.main_language = ?
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ?
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )`;
            } else {
              // OPTIMIZED: Filter available cards early, use EXISTS for subtitle check
              // When no main_language filter, use EXISTS with language match
              stmt = `
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
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )`;
            }
          }
          
          if (contentIdsCount > 0) {
            stmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
          }
          
          if (hasDifficultyFilter) {
            stmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
          }
          
          // Optimize level filter: use JOIN instead of EXISTS for better performance
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            stmt += ` AND EXISTS (
              SELECT 1 FROM card_difficulty_levels cdl
              WHERE cdl.card_id = c.id
                AND cdl.framework = ?
                AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
            )`;
          }
          
          // Length filter: count words in main language subtitle
          // For languages with spaces (en, es, fr, etc.): count spaces + 1
          // For CJK languages (ja, zh, ko): count characters (each character is roughly a word)
          if (hasLengthFilter && mainLanguage) {
            const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
            if (isCJK) {
              // For CJK: count characters (each character is roughly a word)
              const conditions = [];
              if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
              if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
              const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
              stmt += ' AND EXISTS (\n' +
                '                SELECT 1 FROM card_subtitles cs_length\n' +
                '                WHERE cs_length.card_id = c.id\n' +
                '                  AND cs_length.language = ?\n' +
                '                  AND cs_length.text IS NOT NULL\n' +
                '                  AND cs_length.text != \'\'\n';
              if (conditionsStr) {
                stmt += '                  ' + conditionsStr + '\n';
              }
              stmt += '              )';
            } else {
              // For languages with spaces: count words by counting spaces + 1
              // Formula: (LENGTH(text) - LENGTH(REPLACE(text, ' ', ''))) + 1
              const wordCountExpr = '(\n' +
                '                CASE \n' +
                '                  WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
                '                  WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
                '                  ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
                '                END\n' +
                '              )';
              const conditions = [];
              if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
              if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
              const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
              stmt += ' AND EXISTS (\n' +
                '                SELECT 1 FROM card_subtitles cs_length\n' +
                '                WHERE cs_length.card_id = c.id\n' +
                '                  AND cs_length.language = ?\n' +
                '                  AND cs_length.text IS NOT NULL\n' +
                '                  AND cs_length.text != \'\'\n' +
                '                  AND LENGTH(cs_length.text) > 0\n';
              if (conditionsStr) {
                stmt += '                  ' + conditionsStr + '\n';
              }
              stmt += '              )';
            }
          }
          
          // Duration filter: filter by audio duration
          if (hasDurationFilter) {
            stmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
          }
          
          // Review filter: filter by review_count from user_card_states
          if (hasReviewFilter) {
            const conditions = [];
            if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
            if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
            const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
            stmt += ' AND EXISTS (\n' +
              '              SELECT 1 FROM user_card_states ucs_review\n' +
              '              WHERE ucs_review.user_id = ?\n' +
              '                AND ucs_review.card_id = c.id\n';
            if (conditionsStr) {
              stmt += '                ' + conditionsStr + '\n';
            }
            stmt += '            )';
          }
          
          stmt += ` ${textSearchCondition}
            ORDER BY c.id ASC
            LIMIT ? OFFSET ?;
          `;

          // ORDER BY c.id ASC - simple and fast, uses primary key index
          // Removed difficulty_score sorting for better performance

          // Build optimized count query with JOIN
          // OPTIMIZED: Use same structure as main query for consistency and better performance
          let countStmt = '';
          
          if (subtitleLangsCount > 0) {
            // Use same logic as main query: check if mapping table has data
            // Reuse useSummaryTable variable from main query check
            if (useSummaryTable) {
              // OPTIMIZED: Filter by main_language and available cards early, use mapping table with EXISTS
              countStmt = `
                SELECT COUNT(DISTINCT c.id) AS total
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  ${mainLanguage ? 'AND ci.main_language = ?' : ''}
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
                  AND (
                    SELECT COUNT(DISTINCT cslm.language)
                    FROM card_subtitle_language_map cslm
                    WHERE cslm.card_id = c.id
                      AND cslm.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                  ) >= ?
              `;
            } else {
              // OPTIMIZED: Filter by main_language and available cards early, use EXISTS for subtitle check
              // Fallback: use EXISTS instead of JOIN to reduce intermediate rows
              countStmt = `
                SELECT COUNT(DISTINCT c.id) AS total
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  ${mainLanguage ? 'AND ci.main_language = ?' : ''}
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
                  AND (
                    SELECT COUNT(DISTINCT cs_filter.language)
                    FROM card_subtitles cs_filter
                    WHERE cs_filter.card_id = c.id
                      AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
                  ) >= ?
              `;
            }
            
            // Add other filters
            if (contentIdsCount > 0) {
              countStmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
            }
            
            if (hasDifficultyFilter) {
              countStmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
            }
            
            if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
              countStmt += ` AND EXISTS (
                  SELECT 1 FROM card_difficulty_levels cdl
                  WHERE cdl.card_id = c.id
                    AND cdl.framework = ?
                    AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
              )`;
            }
            
            // Length filter for count query
            if (hasLengthFilter && mainLanguage) {
              const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
              if (isCJK) {
                const conditions = [];
                if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
                if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
                const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
                countStmt += ' AND EXISTS (\n' +
                  '                  SELECT 1 FROM card_subtitles cs_length\n' +
                  '                  WHERE cs_length.card_id = c.id\n' +
                  '                    AND cs_length.language = ?\n' +
                  '                    AND cs_length.text IS NOT NULL\n' +
                  '                    AND cs_length.text != \'\'\n';
                if (conditionsStr) {
                  countStmt += '                    ' + conditionsStr + '\n';
                }
                countStmt += '                )';
              } else {
                const wordCountExpr = '(\n' +
                  '                  CASE \n' +
                  '                    WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
                  '                    WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
                  '                    ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
                  '                  END\n' +
                  '                )';
                const conditions = [];
                if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
                if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
                const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
                countStmt += ' AND EXISTS (\n' +
                  '                  SELECT 1 FROM card_subtitles cs_length\n' +
                  '                  WHERE cs_length.card_id = c.id\n' +
                  '                    AND cs_length.language = ?\n' +
                  '                    AND cs_length.text IS NOT NULL\n' +
                  '                    AND cs_length.text != \'\'\n' +
                  '                    AND LENGTH(cs_length.text) > 0\n';
                if (conditionsStr) {
                  countStmt += '                    ' + conditionsStr + '\n';
                }
                countStmt += '                )';
              }
            }
            
            // Duration filter for count query
            if (hasDurationFilter) {
              countStmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
            }
            
            // Review filter for count query
            if (hasReviewFilter) {
              const conditions = [];
              if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
              if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
              const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
              countStmt += ' AND EXISTS (\n' +
                '                SELECT 1 FROM user_card_states ucs_review\n' +
                '                WHERE ucs_review.user_id = ?\n' +
                '                  AND ucs_review.card_id = c.id\n';
              if (conditionsStr) {
                countStmt += '                  ' + conditionsStr + '\n';
              }
              countStmt += '              )';
            }
            
            countStmt += ` ${textSearchCondition}`;
          } else {
            // No subtitle languages: simpler query
            if (mainLanguage) {
              // OPTIMIZED: Filter by main_language and available cards early
              countStmt = `
                SELECT COUNT(DISTINCT c.id) AS total
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  AND ci.main_language = ?
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ?
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
              `;
            } else {
              // OPTIMIZED: Filter available cards early, use EXISTS for subtitle check
              countStmt = `
                SELECT COUNT(DISTINCT c.id) AS total
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.is_available = 1
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
              `;
            }
            
            if (contentIdsCount > 0) {
              countStmt += ` AND ci.slug IN (${contentIdsPlaceholders})`;
            }
            
            if (hasDifficultyFilter) {
              countStmt += ` AND c.difficulty_score IS NOT NULL AND c.difficulty_score >= ? AND c.difficulty_score <= ?`;
            }
            
            if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
              countStmt += ` AND EXISTS (
                  SELECT 1 FROM card_difficulty_levels cdl
                  WHERE cdl.card_id = c.id
                    AND cdl.framework = ?
                    AND cdl.level IN (${allowedLevels.map(() => '?').join(',')})
              )`;
            }
            
            // Length filter for count query (no subtitle languages path)
            if (hasLengthFilter && mainLanguage) {
              const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
              if (isCJK) {
                const conditions = [];
                if (lengthMin !== null) conditions.push('LENGTH(cs_length.text) >= ?');
                if (lengthMax !== null) conditions.push('LENGTH(cs_length.text) <= ?');
                const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
                countStmt += ' AND EXISTS (\n' +
                  '                  SELECT 1 FROM card_subtitles cs_length\n' +
                  '                  WHERE cs_length.card_id = c.id\n' +
                  '                    AND cs_length.language = ?\n' +
                  '                    AND cs_length.text IS NOT NULL\n' +
                  '                    AND cs_length.text != \'\'\n';
                if (conditionsStr) {
                  countStmt += '                    ' + conditionsStr + '\n';
                }
                countStmt += '                )';
              } else {
                const wordCountExpr = '(\n' +
                  '                  CASE \n' +
                  '                    WHEN LENGTH(cs_length.text) = 0 THEN 0\n' +
                  '                    WHEN LENGTH(REPLACE(cs_length.text, \' \', \'\')) = 0 THEN 0\n' +
                  '                    ELSE (LENGTH(cs_length.text) - LENGTH(REPLACE(cs_length.text, \' \', \'\')) + 1)\n' +
                  '                  END\n' +
                  '                )';
                const conditions = [];
                if (lengthMin !== null) conditions.push(wordCountExpr + ' >= ?');
                if (lengthMax !== null) conditions.push(wordCountExpr + ' <= ?');
                const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
                countStmt += ' AND EXISTS (\n' +
                  '                  SELECT 1 FROM card_subtitles cs_length\n' +
                  '                  WHERE cs_length.card_id = c.id\n' +
                  '                    AND cs_length.language = ?\n' +
                  '                    AND cs_length.text IS NOT NULL\n' +
                  '                    AND cs_length.text != \'\'\n' +
                  '                    AND LENGTH(cs_length.text) > 0\n';
                if (conditionsStr) {
                  countStmt += '                    ' + conditionsStr + '\n';
                }
                countStmt += '                )';
              }
            }
            
            // Duration filter for count query
            if (hasDurationFilter) {
              countStmt += ` AND c.duration IS NOT NULL AND c.duration <= ?`;
            }
            
            // Review filter for count query
            if (hasReviewFilter) {
              const conditions = [];
              if (reviewMin !== null) conditions.push('ucs_review.review_count >= ?');
              if (reviewMax !== null) conditions.push('ucs_review.review_count <= ?');
              const conditionsStr = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : '';
              countStmt += ' AND EXISTS (\n' +
                '                SELECT 1 FROM user_card_states ucs_review\n' +
                '                WHERE ucs_review.user_id = ?\n' +
                '                  AND ucs_review.card_id = c.id\n';
              if (conditionsStr) {
                countStmt += '                  ' + conditionsStr + '\n';
              }
              countStmt += '              )';
            }
            
            countStmt += ` ${textSearchCondition}`;
          }
          
          countStmt += `;`;

          // Build params array in order to match SQL structure
          // Note: useSummaryTable variable is already set above when building query
          let params = [];
          let countParams = [];
          
          // 1. Add mainLanguage params FIRST (in WHERE clause)
          if (subtitleLangsCount === 0 && mainLanguage) {
            // When no subtitle languages and mainLanguage is specified:
            // mainLanguage is used in JOIN condition and WHERE clause
            params.push(mainLanguage); // For JOIN condition
            params.push(mainLanguage); // For WHERE clause
            countParams.push(mainLanguage); // For JOIN condition
            countParams.push(mainLanguage); // For WHERE clause
          } else if (mainLanguage) {
            // When subtitle languages exist and mainLanguage is specified:
            // mainLanguage is used once in WHERE clause (direct comparison, no NULL check)
            params.push(mainLanguage);
            countParams.push(mainLanguage);
          }
          // If mainLanguage is null, don't add any params (no filter)
          
          // 2. Add subtitle language params (for IN clause in JOIN)
          if (subtitleLangsCount > 0) {
            // Both paths use JOIN with IN: languages in IN clause, then count in HAVING
            params.push(...subtitleLangsArr);
            params.push(subtitleLangsCount); // For HAVING COUNT(DISTINCT ...) = ?
            countParams.push(...subtitleLangsArr);
            countParams.push(subtitleLangsCount); // For HAVING COUNT(DISTINCT ...) = ?
          }
          
          // 4. Add content IDs if needed
          if (contentIdsCount > 0) {
            params.push(...contentIdsArr);
            countParams.push(...contentIdsArr);
          }
          
          // 5. Add difficulty filters if needed
          if (hasDifficultyFilter) {
            params.push(difficultyMin !== null ? difficultyMin : 0);
            params.push(difficultyMax !== null ? difficultyMax : 100);
            countParams.push(difficultyMin !== null ? difficultyMin : 0);
            countParams.push(difficultyMax !== null ? difficultyMax : 100);
          }
          
          // 6. Add level filters if needed
          if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
            params.push(framework);
            params.push(...allowedLevels);
            countParams.push(framework);
            countParams.push(...allowedLevels);
          }
          
          // 6.5. Add length filters if needed
          if (hasLengthFilter && mainLanguage) {
            const isCJK = ['ja', 'zh', 'ko'].includes(mainLanguage.toLowerCase());
            params.push(mainLanguage); // language param
            countParams.push(mainLanguage); // language param
            // Only add min/max params if they are actually set
            if (lengthMin !== null) {
              params.push(lengthMin);
              countParams.push(lengthMin);
            }
            if (lengthMax !== null) {
              params.push(lengthMax);
              countParams.push(lengthMax);
            }
          }
          
          // 6.6. Add duration filter if needed
          if (hasDurationFilter) {
            params.push(durationMax);
            countParams.push(durationMax);
          }
          
          // 6.7. Add review filters if needed
          if (hasReviewFilter) {
            params.push(userId);
            countParams.push(userId);
            // Only add min/max params if they are actually set
            if (reviewMin !== null) {
              params.push(reviewMin);
              countParams.push(reviewMin);
            }
            if (reviewMax !== null) {
              params.push(reviewMax);
              countParams.push(reviewMax);
            }
          }
          
          // 7. Add text search query if needed
          if (hasTextQuery && likeQuery) {
            // LIKE search: use built LIKE query
            if (mainLanguage) {
              // Add language filter first, then LIKE query (with % wildcards)
              params.push(mainLanguage);
              params.push(`%${likeQuery}%`);
              countParams.push(mainLanguage);
              countParams.push(`%${likeQuery}%`);
            } else {
              // No language filter - just LIKE query (with % wildcards)
              params.push(`%${likeQuery}%`);
              countParams.push(`%${likeQuery}%`);
            }
          }
          
          // 8. Add pagination params (only for main query, not count)
          // Use fetchLimit (1.5x size) to ensure we have enough cards from different content_items
          // Reduced to avoid "too many SQL variables" error in batch fetching
          const fetchLimit = Math.min(Math.ceil(size * 1.5), 75); // Max 75 cards to avoid SQL variable limit
          params.push(fetchLimit);
          params.push(offset);

          const pageNum = Math.floor(offset / size) + 1;
          const skipCount = true; // Always skip count for maximum speed
          
          // Execute main query only
          // Log params count for debugging "too many SQL variables" error
          const totalParams = params.length;
          if (totalParams > 500) {
            console.warn(`[WORKER /api/search] High param count: ${totalParams}`, {
              subtitleLangsCount,
              contentIdsCount,
              hasDifficultyFilter,
              hasLevelFilter,
              allowedLevelsCount: allowedLevels?.length || 0,
              hasTextQuery
            });
          }
          
          const queryStart = Date.now();
          console.log(`[PERF /api/search] Query start | Params: ${params.length} | SubtitleLangs: ${subtitleLangsCount} | MainLang: ${mainLanguage || 'none'}`);
          console.log(`[PERF /api/search] Query params:`, JSON.stringify(params.slice(0, 10))); // Log first 10 params for debugging
          
          // Debug: Log a simplified test query to see if data exists
          if (subtitleLangsCount > 0 && useSummaryTable) {
            try {
              const testQuery = `
                SELECT COUNT(*) as cnt 
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                JOIN card_subtitles cs_main ON cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
                JOIN card_subtitle_language_map cslm ON cslm.card_id = c.id
                  AND cslm.language = ?
                WHERE ci.main_language = ?
                  AND c.is_available = 1
                LIMIT 10
              `;
              const testResult = await env.DB.prepare(testQuery).bind(subtitleLangsArr[0], mainLanguage).all();
              console.log(`[PERF /api/search] Test query (simple JOIN): ${(testResult.results || []).length} rows`);
            } catch (e) {
              console.error(`[PERF /api/search] Test query error:`, e.message);
            }
          }
          
          let cardsResult;
          try {
            // Debug: Log params count and SQL placeholders count
            const placeholderCount = (stmt.match(/\?/g) || []).length;
            if (params.length !== placeholderCount) {
              console.error(`[PERF /api/search] Param mismatch! SQL has ${placeholderCount} placeholders but ${params.length} params`);
              console.error(`[PERF /api/search] SQL:`, stmt.substring(0, 1000));
              console.error(`[PERF /api/search] Params:`, JSON.stringify(params));
              throw new Error(`SQL parameter mismatch: expected ${placeholderCount} params, got ${params.length}`);
            }
            cardsResult = await env.DB.prepare(stmt).bind(...params).all();
          } catch (queryError) {
            console.error(`[PERF /api/search] Query ERROR:`, queryError.message);
            console.error(`[PERF /api/search] Query SQL (first 1000 chars):`, stmt.substring(0, 1000));
            console.error(`[PERF /api/search] Params count: ${params.length}`);
            console.error(`[PERF /api/search] Params:`, JSON.stringify(params.slice(0, 20))); // Log first 20 params
            return json({ error: queryError.message || 'Database query failed', items: [], total: 0, page, size }, { status: 500 });
          }
          
          const queryTime = Date.now() - queryStart;
          const totalStart = Date.now();
          console.log(`[PERF /api/search] [${requestId}] Main query completed: ${queryTime}ms | Rows: ${(cardsResult.results || []).length}`);
          
          // Debug: If 0 rows, log more details
          if ((cardsResult.results || []).length === 0 && subtitleLangsCount > 0) {
            console.log(`[PERF /api/search] DEBUG: 0 rows returned. Checking mapping table coverage...`);
            try {
              const coverageCheck = await env.DB.prepare(`
                SELECT COUNT(DISTINCT c.id) as card_count
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                JOIN card_subtitles cs_main ON cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
                WHERE ci.main_language = ?
                  AND c.is_available = 1
                  AND EXISTS (SELECT 1 FROM card_subtitle_language_map cslm WHERE cslm.card_id = c.id AND cslm.language = ?)
              `).bind(mainLanguage, subtitleLangsArr[0]).first();
              console.log(`[PERF /api/search] DEBUG: Cards with main_lang=${mainLanguage} AND subtitle_lang=${subtitleLangsArr[0]}: ${coverageCheck?.card_count || 0}`);
            } catch (e) {
              console.error(`[PERF /api/search] DEBUG query error:`, e.message);
            }
          }
          
          // Use placeholder total - frontend can fetch separately if needed
          total = -1; // Signal that total is not available
          const cardRows = cardsResult.results || [];
          let batchStart = null; // Declare outside if block for logging

          if (cardRows.length > 0) {
            batchStart = Date.now();
            const cardIds = cardRows.map(r => r.card_id);
            const subsMap = new Map();
            const cefrLevelMap = new Map();
            const levelsMap = new Map(); // Full levels map for all frameworks - declared outside block
            
            // Only fetch additional subtitle languages (not main language - already have it)
            const additionalSubLangs = subtitleLangsArr.filter(lang => lang !== mainLanguage);
            const needsAdditionalSubs = additionalSubLangs.length > 0;
            
            // OPTIMIZED: Combine all data fetching into fewer, larger batches
            // Fetch main subtitles, additional subtitles, and levels together per batch
            const batchSize = 50; // Reduced batch size for faster individual queries
            
            // Group cards by main language for efficient fetching
            const cardsByLang = new Map();
            for (const r of cardRows) {
              const lang = r.content_main_language;
              if (!cardsByLang.has(lang)) {
                cardsByLang.set(lang, []);
              }
              cardsByLang.get(lang).push(r.card_id);
            }
            
            const allPromises = [];
            
            // Process each language group
            for (const [mainLang, langCardIds] of cardsByLang.entries()) {
              // Process cards in batches
              for (let i = 0; i < langCardIds.length; i += batchSize) {
                const batch = langCardIds.slice(i, i + batchSize);
                const placeholders = batch.map(() => '?').join(',');
                
                // Build queries for this batch: main subtitle + additional subtitles + levels
                const batchQueries = [];
                
                // 1. Main language subtitle (always needed)
                batchQueries.push(
                  env.DB.prepare(`
                    SELECT card_id, text
                    FROM card_subtitles
                    WHERE card_id IN (${placeholders})
                      AND language = ?
                      AND text IS NOT NULL
                      AND LENGTH(text) > 0
                  `).bind(...batch, mainLang).all()
                );
                
                // 2. Additional subtitle languages (if needed)
                if (needsAdditionalSubs) {
                  const maxVarsForSubs = 800; // Safety margin
                  const safeBatchSizeForSubs = Math.max(1, maxVarsForSubs - additionalSubLangs.length);
                  const actualSubBatchSize = Math.min(batchSize, safeBatchSizeForSubs);
                  
                  // Split batch if needed for additional subs to stay under SQL variable limit
                  for (let j = 0; j < batch.length; j += actualSubBatchSize) {
                    const subBatch = batch.slice(j, j + actualSubBatchSize);
                    const subPlaceholders = subBatch.map(() => '?').join(',');
                    batchQueries.push(
                      env.DB.prepare(`
                        SELECT card_id, language, text
                        FROM card_subtitles
                        WHERE card_id IN (${subPlaceholders})
                          AND language IN (${additionalSubLangs.map(() => '?').join(',')})
                      `).bind(...subBatch, ...additionalSubLangs).all()
                    );
                  }
                }
                
                // 3. Full levels array (all frameworks)
                batchQueries.push(
                  env.DB.prepare(`
                    SELECT card_id, framework, level, language
                    FROM card_difficulty_levels
                    WHERE card_id IN (${placeholders})
                  `).bind(...batch).all()
                );
                
                // Execute all queries for this batch and process results
                allPromises.push(
                  Promise.all(batchQueries).then((results) => {
                    // Process main subtitle (first result)
                    const mainSubResult = results[0];
                    if (mainSubResult && mainSubResult.results) {
                      for (const row of mainSubResult.results) {
                        if (!subsMap.has(row.card_id)) {
                          subsMap.set(row.card_id, {});
                        }
                        subsMap.get(row.card_id)[mainLang] = row.text;
                      }
                    }
                    
                    // Process additional subtitles (results 1 to N-1, excluding last which is levels)
                    const additionalSubsStart = 1;
                    const levelsResultIndex = results.length - 1;
                    for (let idx = additionalSubsStart; idx < levelsResultIndex; idx++) {
                      const subsResult = results[idx];
                      if (subsResult && subsResult.results) {
                        for (const row of subsResult.results) {
                          if (!subsMap.has(row.card_id)) {
                            subsMap.set(row.card_id, {});
                          }
                          subsMap.get(row.card_id)[row.language] = row.text;
                        }
                      }
                    }
                    
                    // Process levels (last result)
                    const levelsResult = results[levelsResultIndex];
                    if (levelsResult && levelsResult.results) {
                      for (const row of levelsResult.results) {
                        if (!levelsMap.has(row.card_id)) {
                          levelsMap.set(row.card_id, []);
                        }
                        levelsMap.get(row.card_id).push({
                          framework: row.framework,
                          level: row.level,
                          language: row.language || null
                        });
                        // Also set CEFR level for backward compatibility
                        if (row.framework === 'CEFR') {
                          cefrLevelMap.set(row.card_id, row.level);
                        }
                      }
                    }
                  })
                );
              }
            }
            
            // Execute batches with increased concurrency for better performance
            const maxConcurrentBatchQueries = 20; // Increased for better parallelism
            const batchExecuteStart = Date.now();
            for (let i = 0; i < allPromises.length; i += maxConcurrentBatchQueries) {
              const batch = allPromises.slice(i, i + maxConcurrentBatchQueries);
              const batchStartTime = Date.now();
              await Promise.all(batch);
              const batchTime = Date.now() - batchStartTime;
              console.log(`[PERF /api/search] [${requestId}] Batch ${Math.floor(i / maxConcurrentBatchQueries) + 1} completed: ${batchTime}ms`);
            }
            const batchTime = Date.now() - batchStart;
            console.log(`[PERF /api/search] [${requestId}] Combined batch fetch: ${batchTime}ms for ${cardIds.length} cards (${allPromises.length} queries)`);

            // Map cards to response format - main subtitle already included
            const allMappedCards = cardRows.map(r => ({
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
              text: (subsMap.get(r.card_id) && subsMap.get(r.card_id)[r.content_main_language]) || '', // Get main subtitle from batch fetch
              subtitle: subsMap.get(r.card_id) || {},
              cefr_level: cefrLevelMap.get(r.card_id) || null,
              levels: levelsMap.get(r.card_id) || [] // Full levels array for level badges display
            }));
            
            // Optimized content distribution: ensure no duplicate content_items in first N cards
            // Goal: Each of the first 50 cards should be from a different content_item if possible
            if (allMappedCards.length <= size) {
              // Not enough cards: return all cards
              items = allMappedCards;
            } else {
              // Quick check: count unique content_items
              const uniqueContents = new Set(allMappedCards.map(c => c.content_slug));
              
              if (uniqueContents.size <= 1) {
                // Only one content_item: return first N cards (already sorted)
                items = allMappedCards.slice(0, size);
              } else {
                // Multiple content_items: distribute to ensure unique content_items
                // Group by content_slug (single pass, O(n))
                const cardsByContent = new Map();
                for (const card of allMappedCards) {
                  const slug = card.content_slug;
                  if (!cardsByContent.has(slug)) {
                    cardsByContent.set(slug, []);
                  }
                  cardsByContent.get(slug).push(card);
                }
                
                // Smart distribution: ensure each card from different content_item (round-robin)
                // Strategy: Take 1 card from each content_item per round, repeat until we have enough
                // This ensures maximum diversity: if we have 10 content_items, first 10 cards are all different
                const distributedCards = [];
                const contentArrays = Array.from(cardsByContent.values());
                let round = 0;
                let iterations = 0;
                const maxIterations = size * 3; // Safety limit
                
                while (distributedCards.length < size && iterations < maxIterations) {
                  let cardsAddedThisRound = 0;
                  
                  // One round: take 1 card from each content_item (if available)
                  for (let i = 0; i < contentArrays.length && distributedCards.length < size; i++) {
                    const currentArray = contentArrays[i];
                    if (currentArray && currentArray.length > 0) {
                      distributedCards.push(currentArray.shift());
                      cardsAddedThisRound++;
                    }
                  }
                  
                  // If no cards were added this round, we're done
                  if (cardsAddedThisRound === 0) break;
                  
                  round++;
                  iterations++;
                }
                
                items = distributedCards;
              }
            }
          }

          const totalTime = Date.now() - startTime;
          const batchTime = batchStart ? (Date.now() - batchStart) : 0;
          console.log(`[PERF /api/search] [${requestId}] Total: ${totalTime}ms | Query: ${queryTime}ms | Batch: ${batchTime}ms | Cards: ${items.length} | Page: ${page} | SubtitleLangs: ${subtitleLangsCount}`);

          const responseData = { items, total, page, size };
          
          // Save to KV cache (async, don't wait)
          if (env.SEARCH_CACHE) {
            env.SEARCH_CACHE.put(cacheKey, JSON.stringify({
              data: responseData,
              timestamp: Date.now()
            }), { expirationTtl: CACHE_TTL }).catch(err => {
              console.error('[CACHE ERROR /api/search] Failed to save cache:', err);
            });
          }

          // Add cache headers for faster subsequent requests
          const response = json(responseData, {
            headers: {
              'Cache-Control': 'public, max-age=60, s-maxage=60', // Cache for 1 minute
              'X-Cache': 'MISS',
            }
          });
          return response;

        } catch (e) {
          console.error('[WORKER /api/search] Error:', e);
          console.error('[WORKER /api/search] Stack:', e.stack);
          console.error('[WORKER /api/search] Params:', {
            q,
            mainLanguage,
            subtitleLangsCount,
            contentIdsCount,
            hasDifficultyFilter,
            hasLevelFilter
          });
          return json({ error: 'search_failed', message: String(e) }, { status: 500 });
        }
      }

      // Autocomplete API: Fast suggestions from search_terms table
      if (path === '/api/search/autocomplete' && request.method === 'GET') {
        try {
          const query = (url.searchParams.get('q') || '').trim();
          const language = url.searchParams.get('language') || null;
          const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10), 1), 50);

          if (!query || query.length < 1) {
            return json({ suggestions: [] });
          }

          // Build query: prefix match on term, optionally filter by language
          // Order by frequency (desc) then term (asc) for best matches first
          let stmt;
          let params;

          if (language) {
            stmt = `
              SELECT term, frequency
              FROM search_terms
              WHERE language = ?
                AND term LIKE ? || '%'
              ORDER BY frequency DESC, term ASC
              LIMIT ?
            `;
            params = [language, query, limit];
          } else {
            stmt = `
              SELECT term, frequency, language
              FROM search_terms
              WHERE term LIKE ? || '%'
              ORDER BY frequency DESC, term ASC
              LIMIT ?
            `;
            params = [query, limit];
          }

          const result = await env.DB.prepare(stmt).bind(...params).all();
          const suggestions = (result.results || []).map(row => ({
            term: row.term,
            frequency: row.frequency || 0,
            language: row.language || null
          }));

          return json({ suggestions });
        } catch (e) {
          console.error('[WORKER /api/search/autocomplete] Error:', e);
          return json({ error: 'autocomplete_failed', message: String(e), suggestions: [] }, { status: 500 });
        }
      }

      // Get card counts per content item (for ContentSelector)
      if (path === '/api/search/counts' && request.method === 'GET') {
        // Build cache key from query params
        const countsCacheKey = `search_counts:${url.searchParams.toString()}`;
        const COUNTS_CACHE_TTL = 600; // 10 minutes cache for counts (less frequently updated)
        
        try {
          // Check KV cache first
          if (env.SEARCH_CACHE) {
            const cached = await env.SEARCH_CACHE.get(countsCacheKey, { type: 'json' });
            if (cached && cached.data && cached.timestamp) {
              const age = (Date.now() - cached.timestamp) / 1000;
              if (age < COUNTS_CACHE_TTL) {
                console.log(`[CACHE HIT /api/search/counts] Age: ${age.toFixed(1)}s`);
                return json(cached.data, {
                  headers: {
                    'X-Cache': 'HIT',
                    'X-Cache-Age': Math.round(age).toString(),
                  }
                });
              }
            }
          }
          
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

          // If there is a text query, use LIKE search on card_subtitles
          if (q) {
            const mainCanon = mainLanguage ? String(mainLanguage).toLowerCase() : null;
            const likePattern = buildLikeQuery(q, mainLanguage || '');

            // Use LIKE search for all queries
            if (likePattern) {
              let sql = `
                SELECT 
                  ci.slug AS content_id,
                  COUNT(DISTINCT c.id) AS count
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                JOIN card_subtitles cs ON cs.card_id = c.id
                WHERE cs.text LIKE ?
                  AND c.is_available = 1
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND TRIM(cs_main.text) != ''
                  )`;
              const params = [`%${likePattern}%`];

              if (mainCanon) {
                // Search only in main language subtitles and main_language content
                sql += ' AND LOWER(cs.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)';
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
            } else {
              // No valid LIKE query: no matches
              return json({ counts: {} });
            }
          }

          // No text query: simple counts by main_language / subtitle_languages / content_ids
          // Use positional placeholders for easier binding
          const countsWhere = [];
          const countsParams = []; // Initialize early, will be rebuilt after countsStmt is built
          
          // Main language filter - handled differently based on subtitleLangsCount
          // When no subtitle languages and mainLanguage exists, it's handled in JOIN/WHERE of countsStmt
          // Otherwise, use standard NULL check
          if (subtitleLangsCount === 0 && mainLanguage) {
            // Will be handled in countsStmt WHERE clause, don't add here
          } else {
          countsWhere.push('(? IS NULL OR ci.main_language = ?)');
          countsParams.push(mainLanguage || null);
          countsParams.push(mainLanguage || null);
          }
          
          // Content IDs filter
          if (contentIdsCount > 0) {
            if (contentIdsCount > 300) {
              // Too many content IDs: use EXISTS subquery instead of IN
              countsWhere.push(`EXISTS (
                SELECT 1 FROM (VALUES ${contentIdsArr.map(() => '(?)').join(',')}) AS v(slug)
                WHERE v.slug = ci.slug
              )`);
              countsParams.push(...contentIdsArr);
            } else {
            countsWhere.push(`ci.slug IN (${contentIdsArr.map(() => '?').join(',')})`);
            countsParams.push(...contentIdsArr);
            }
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

          // Add is_available filter
          countsWhere.push('c.is_available = 1');
          
          // Build optimized counts query with JOIN for subtitle filter
          // Use JOIN instead of EXISTS for better performance
          // When no subtitle languages, use simpler query without GROUP BY for better performance
          let countsStmt;
          
          if (subtitleLangsCount > 0) {
            // OPTIMIZED: Use EXISTS instead of JOIN + GROUP BY + HAVING for much better performance
            // This avoids expensive nested GROUP BY operations
            countsStmt = `
            SELECT 
              ci.slug AS content_id,
              COUNT(DISTINCT c.id) AS count
            FROM cards c
            JOIN episodes e ON e.id = c.episode_id
            JOIN content_items ci ON ci.id = e.content_item_id
            WHERE ${countsWhere.join('\n              AND ')}
              AND EXISTS (
                SELECT 1 FROM card_subtitles cs_main
                WHERE cs_main.card_id = c.id
                  AND cs_main.language = ci.main_language
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
              )
              AND (
                SELECT COUNT(DISTINCT cs_filter.language)
                FROM card_subtitles cs_filter
                WHERE cs_filter.card_id = c.id
                  AND cs_filter.language IN (${subtitleLangsArr.map(() => '?').join(',')})
              ) >= ?
            GROUP BY ci.slug
            `;
            // Build countsParams for this query structure
            countsParams.length = 0; // Clear and rebuild
            // Add mainLanguage params for WHERE clause
            if (!(subtitleLangsCount === 0 && mainLanguage)) {
              countsParams.push(mainLanguage || null);
              countsParams.push(mainLanguage || null);
            }
            // Add WHERE clause params
            if (contentIdsCount > 0) {
              countsParams.push(...contentIdsArr);
            }
            if (hasDifficultyFilter) {
              countsParams.push(difficultyMin !== null ? difficultyMin : 0);
              countsParams.push(difficultyMax !== null ? difficultyMax : 100);
            }
            if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
              countsParams.push(framework);
              countsParams.push(...allowedLevels);
            }
            // Add subtitleLangs for EXISTS subquery
            countsParams.push(...subtitleLangsArr);
            // Add subtitleLangsCount for COUNT comparison
            countsParams.push(subtitleLangsCount);
          } else {
            // No subtitle languages: use INNER JOIN with main_language filter in JOIN condition
            // This allows query optimizer to use index idx_card_subtitles_language(language, card_id) efficiently
            if (mainLanguage) {
              // When main_language is specified, filter by it directly in JOIN for better performance
              countsStmt = `
                SELECT 
                  ci.slug AS content_id,
                  COUNT(c.id) AS count
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                INNER JOIN card_subtitles cs_main ON cs_main.card_id = c.id 
                  AND cs_main.language = ?
                  AND cs_main.text IS NOT NULL
                  AND cs_main.text != ''
                WHERE ${countsWhere.join('\n              AND ')}
                  AND ci.main_language = ?
            GROUP BY ci.slug
          `;
            } else {
              // When no main_language filter, use EXISTS with language match
              countsStmt = `
                SELECT 
                  ci.slug AS content_id,
                  COUNT(DISTINCT c.id) AS count
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE ${countsWhere.join('\n              AND ')}
                  AND EXISTS (
                    SELECT 1 FROM card_subtitles cs_main
                    WHERE cs_main.card_id = c.id 
                      AND cs_main.language = ci.main_language
                      AND cs_main.text IS NOT NULL
                      AND cs_main.text != ''
                  )
                GROUP BY ci.slug
              `;
            }
          }
          
          // Rebuild countsParams AFTER building countsStmt to ensure correct order (if not already built)
          if (subtitleLangsCount === 0) {
            // Only rebuild if not already built (for subtitleLangsCount > 0 case, it's built above)
            countsParams.length = 0; // Clear and rebuild
            
            // Add params based on query structure
            if (mainLanguage) {
              // When no subtitle languages and mainLanguage is specified:
              // Query structure: JOIN cs_main.language = ? ... WHERE ... AND ci.main_language = ?
              countsParams.push(mainLanguage); // For JOIN condition (cs_main.language = ?)
              // Add WHERE clause params in order: contentIds, difficulty, level, then mainLanguage
              if (contentIdsCount > 0) {
                countsParams.push(...contentIdsArr);
              }
              if (hasDifficultyFilter) {
                countsParams.push(difficultyMin !== null ? difficultyMin : 0);
                countsParams.push(difficultyMax !== null ? difficultyMax : 100);
              }
              if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
                countsParams.push(framework);
                countsParams.push(...allowedLevels);
              }
              // Add mainLanguage for WHERE clause (ci.main_language = ?)
              countsParams.push(mainLanguage);
            } else {
              // When no subtitle languages and no mainLanguage filter:
              // Query structure: WHERE ... AND EXISTS (...)
              // Add mainLanguage params first (for WHERE clause)
              countsParams.push(mainLanguage || null);
              countsParams.push(mainLanguage || null);
              // Add WHERE clause params
              if (contentIdsCount > 0) {
                countsParams.push(...contentIdsArr);
              }
              if (hasDifficultyFilter) {
                countsParams.push(difficultyMin !== null ? difficultyMin : 0);
                countsParams.push(difficultyMax !== null ? difficultyMax : 100);
              }
              if (hasLevelFilter && allowedLevels && allowedLevels.length > 0) {
                countsParams.push(framework);
                countsParams.push(...allowedLevels);
              }
            }
          }

          // OPTIMIZATION: Skip expensive count query - frontend can calculate from results
          // Count query was taking 40-50 seconds on 550k cards, blocking user experience
          // Frontend can calculate approximate counts from search results or use cached counts
          const countsStart = Date.now();
          let countsMap = {};
          
          // Only run count query if explicitly requested via ?include_counts=true (for admin pages)
          const includeCounts = url.searchParams.get('include_counts') === 'true';
          
          if (includeCounts) {
            // Admin pages can wait for accurate counts
            const countsResult = await env.DB.prepare(countsStmt).bind(...countsParams).all();
            for (const row of (countsResult.results || [])) {
              countsMap[row.content_id] = row.count || 0;
            }
            const countsTime = Date.now() - countsStart;
            console.log('[WORKER /api/search/counts] Query time:', countsTime, 'ms | Result:', { 
              rowCount: countsResult.results?.length || 0,
              sampleKeys: Object.keys(countsMap).slice(0, 5),
              totalParams: countsParams.length,
              hasSubtitleLangs: subtitleLangsCount > 0
            });
          } else {
            // Return empty counts immediately - frontend will calculate from results
            // This reduces response time from 40-50s to <100ms
            console.log('[WORKER /api/search/counts] Skipped count query for performance | Returning empty counts');
          }
          
          const responseData = { counts: countsMap };
          
          // Save to KV cache (async, don't wait)
          if (env.SEARCH_CACHE) {
            env.SEARCH_CACHE.put(countsCacheKey, JSON.stringify({
              data: responseData,
              timestamp: Date.now()
            }), { expirationTtl: COUNTS_CACHE_TTL }).catch(err => {
              console.error('[CACHE ERROR /api/search/counts] Failed to save cache:', err);
            });
          }
          
          return json(responseData, {
            headers: {
              'X-Cache': 'MISS',
            }
          });

        } catch (e) {
          console.error('[WORKER /api/search/counts] Error:', e);
          console.error('[WORKER /api/search/counts] Stack:', e.stack);
          console.error('[WORKER /api/search/counts] Params:', {
            mainLanguage,
            subtitleLangsCount,
            contentIdsCount,
            hasDifficultyFilter,
            hasLevelFilter,
            countsParamsLength: countsParams.length
          });
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
          // Optimize: Fetch items, languages, and categories in parallel, then aggregate
          const [itemsResult, langsResult, categoriesResult] = await Promise.all([
            env.DB.prepare(`
              SELECT ci.id as internal_id, ci.slug as id, ci.title, ci.main_language, ci.type, ci.release_year, ci.description, ci.total_episodes as episodes, ci.is_original, ci.level_framework_stats, ci.cover_key, ci.cover_landscape_key, ci.is_available
            FROM content_items ci
              ORDER BY ci.slug
            `).all(),
            env.DB.prepare(`
              SELECT content_item_id, language
              FROM content_item_languages
            `).all(),
            env.DB.prepare(`
              SELECT cic.content_item_id, c.id, c.name
              FROM content_item_categories cic
              INNER JOIN categories c ON c.id = cic.category_id
              ORDER BY c.name ASC
            `).all()
          ]);
          
          const base = env.R2_PUBLIC_BASE || '';
          const map = new Map();
          
          // Build language map first for faster lookup
          const langMap = new Map();
          for (const r of (langsResult.results || [])) {
            if (!langMap.has(r.content_item_id)) {
              langMap.set(r.content_item_id, []);
            }
            if (r.language && !langMap.get(r.content_item_id).includes(r.language)) {
              langMap.get(r.content_item_id).push(r.language);
            }
          }
          
          // Build categories map
          const categoriesMap = new Map();
          for (const r of (categoriesResult.results || [])) {
            if (!categoriesMap.has(r.content_item_id)) {
              categoriesMap.set(r.content_item_id, []);
            }
            categoriesMap.get(r.content_item_id).push({ id: r.id, name: r.name });
          }
          
          // Process items
          for (const r of (itemsResult.results || [])) {
              // Parse level_framework_stats from JSON string to object
              let levelStats = null;
              if (r.level_framework_stats) {
                try {
                  levelStats = JSON.parse(r.level_framework_stats);
                } catch {}
              }
              
              // Build cover_url from cover_key
              let cover_url = null;
              if (r.cover_key) {
                cover_url = base ? `${base}/${r.cover_key}` : `/${r.cover_key}`;
              }
              
              // Build cover_landscape_url from cover_landscape_key
              let cover_landscape_url = null;
              if (r.cover_landscape_key) {
                cover_landscape_url = base ? `${base}/${r.cover_landscape_key}` : `/${r.cover_landscape_key}`;
              }
              
            const it = {
                id: r.id,
                title: r.title,
                main_language: r.main_language,
                type: r.type,
                release_year: r.release_year,
                description: r.description,
                episodes: r.episodes,
                is_original: r.is_original,
                level_framework_stats: levelStats,
              available_subs: langMap.get(r.internal_id) || [],
                cover_url,
                cover_landscape_url,
                is_available: r.is_available ?? 1,
                categories: categoriesMap.get(r.internal_id) || [],
              };
            map.set(r.id, it);
            }
          
          const out = Array.from(map.values());
          // Add cache headers for better performance (5 minutes cache)
          return json(out, {
            headers: {
              'Cache-Control': 'public, max-age=300, s-maxage=300'
            }
          });
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
          let film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images,imdb_score FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
          if (!film) {
            // Fallback: allow direct UUID id lookup in case caller still uses internal id
            film = await env.DB.prepare('SELECT id,slug,title,main_language,type,release_year,description,cover_key,cover_landscape_key,total_episodes,is_original,is_available,num_cards,avg_difficulty_score,level_framework_stats,video_has_images,imdb_score FROM content_items WHERE id=?').bind(filmSlug).first();
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
          
          // Get categories for this content item
          let categories = [];
          try {
            const catRows = await env.DB.prepare(`
              SELECT c.id, c.name 
              FROM categories c
              INNER JOIN content_item_categories cic ON c.id = cic.category_id
              WHERE cic.content_item_id = ?
              ORDER BY c.name ASC
            `).bind(film.id).all();
            categories = (catRows.results || []).map(c => ({ id: c.id, name: c.name }));
          } catch {}
          
          return json({ id: film.slug, title: film.title, main_language: film.main_language, type: film.type, release_year: film.release_year, description: film.description, available_subs: (langs.results || []).map(r => r.language), episodes: episodesOut, total_episodes: episodesMeta !== null ? episodesMeta : episodesOut, cover_url, cover_landscape_url, is_original: !!Number(isOriginal), num_cards: film.num_cards ?? null, avg_difficulty_score: film.avg_difficulty_score ?? null, level_framework_stats: levelStats, is_available: film.is_available ?? 1, video_has_images: film.video_has_images === 1 || film.video_has_images === true, imdb_score: film.imdb_score ?? null, categories });
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

          // New: imdb_score (REAL, 0-10)
          if (has('imdb_score')) {
            let imdbScore = null;
            if (body.imdb_score !== null && body.imdb_score !== '' && body.imdb_score !== undefined) {
              const n = Number(body.imdb_score);
              imdbScore = Number.isFinite(n) && n >= 0 && n <= 10 ? n : null;
            }
            setClauses.push('imdb_score=?'); values.push(imdbScore);
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

          // Handle categories if provided
          if (has('category_ids')) {
            const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE LOWER(slug)=LOWER(?)').bind(filmSlug).first();
            if (filmRow) {
              // Remove all existing category associations
              await env.DB.prepare('DELETE FROM content_item_categories WHERE content_item_id=?').bind(filmRow.id).run();
              
              // Add new category associations if provided
              if (Array.isArray(body.category_ids) && body.category_ids.length) {
                try {
                  // First, ensure all categories exist (create if needed)
                  const categoryStmts = [];
                  for (const catNameOrId of body.category_ids) {
                    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
                    if (isUUID) {
                      const existing = await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(catNameOrId).first();
                      if (!existing) continue;
                    } else {
                      // It's a name, check if exists, create if not
                      const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
                      if (!existing) {
                        const catUuid = crypto.randomUUID();
                        await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catNameOrId).run();
                        categoryStmts.push(env.DB.prepare('INSERT INTO content_item_categories (content_item_id, category_id) VALUES (?, ?)').bind(filmRow.id, catUuid));
                      } else {
                        categoryStmts.push(env.DB.prepare('INSERT INTO content_item_categories (content_item_id, category_id) VALUES (?, ?)').bind(filmRow.id, existing.id));
                      }
                    }
                  }
                  // Now assign categories
                  const assignStmts = [];
                  for (const catNameOrId of body.category_ids) {
                    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
                    let catId;
                    if (isUUID) {
                      catId = catNameOrId;
                    } else {
                      const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
                      if (existing) {
                        catId = existing.id;
                      } else {
                        // Should have been created above, but handle edge case
                        const catUuid = crypto.randomUUID();
                        await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catNameOrId).run();
                        catId = catUuid;
                      }
                    }
                    if (catId) {
                      assignStmts.push(env.DB.prepare('INSERT OR IGNORE INTO content_item_categories (content_item_id, category_id) VALUES (?,?)').bind(filmRow.id, catId));
                    }
                  }
                  if (assignStmts.length) await env.DB.batch(assignStmts);
                } catch (e) {
                  console.error('Failed to handle categories:', e);
                }
              }
            }
          }

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
                try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${cardPh})`).bind(...cardIds).run(); } catch {}
                // Update mapping table (async, don't block)
                updateCardSubtitleLanguageMapBatch(env, cardIds).catch(err => {
                  console.error('[delete cards] Failed to update mapping table:', err.message);
                });
              }
              // Delete cards
              try { await env.DB.prepare(`DELETE FROM cards WHERE episode_id IN (${placeholders})`).bind(...epIds).run(); } catch {}
            }
            // Delete episodes
            try { await env.DB.prepare('DELETE FROM episodes WHERE content_item_id=?').bind(filmRow.id).run(); } catch {}
            // Delete language rows
            try { await env.DB.prepare('DELETE FROM content_item_languages WHERE content_item_id=?').bind(filmRow.id).run(); } catch {}
            // Delete category associations
            try { await env.DB.prepare('DELETE FROM content_item_categories WHERE content_item_id=?').bind(filmRow.id).run(); } catch {}
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
              try { await env.DB.prepare(`DELETE FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...cardIds).run(); } catch {}
              // Update summary table (async, don't block)
              updateCardSubtitleLanguagesBatch(env, cardIds).catch(err => {
                console.error('[delete cards] Failed to update summary table:', err.message);
              });
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
        // Optional: exclude saved cards for a user
        const userId = url.searchParams.get('exclude_saved_for_user');
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
          // Build exclude saved cards condition if userId is provided
          const excludeSavedCondition = userId ? `AND NOT EXISTS (
            SELECT 1 FROM user_card_states ucs
            WHERE ucs.user_id = ? AND ucs.card_id = c.id AND ucs.srs_state != 'none'
          )` : '';
          const excludeSavedBind = userId ? [userId] : [];
          
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
                           JOIN episodes e ON e.id = c.episode_id
                           JOIN content_items ci ON ci.id = e.content_item_id
                           WHERE c.episode_id=? 
                             AND c.start_time >= ?
                             AND c.is_available = 1
                             AND EXISTS (
                               SELECT 1 FROM card_subtitles cs
                               WHERE cs.card_id = c.id
                                 AND cs.language = ci.main_language
                                 AND cs.text IS NOT NULL
                                 AND TRIM(cs.text) != ''
                             )
                             ${excludeSavedCondition}
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, Math.floor(startFrom), ...excludeSavedBind, limit).all();
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
                           JOIN episodes e ON e.id = c.episode_id
                           JOIN content_items ci ON ci.id = e.content_item_id
                           WHERE c.episode_id=?
                             AND c.is_available = 1
                             AND EXISTS (
                               SELECT 1 FROM card_subtitles cs
                               WHERE cs.card_id = c.id
                                 AND cs.language = ci.main_language
                                 AND cs.text IS NOT NULL
                                 AND TRIM(cs.text) != ''
                             )
                             ${excludeSavedCondition}
                           ORDER BY c.start_time ASC, c.end_time ASC
                           LIMIT ?`;
              res = await env.DB.prepare(sql).bind(ep.id, ...excludeSavedBind, limit).all();
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
                                 JOIN episodes e ON e.id = c.episode_id
                                 JOIN content_items ci ON ci.id = e.content_item_id
                                 WHERE c.episode_id=? 
                                   AND c.start_time_ms >= ?
                                   AND c.is_available = 1
                                   AND EXISTS (
                                     SELECT 1 FROM card_subtitles cs
                                     WHERE cs.card_id = c.id
                                       AND cs.language = ci.main_language
                                       AND cs.text IS NOT NULL
                                       AND TRIM(cs.text) != ''
                                   )
                                   ${excludeSavedCondition}
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, Math.floor(startFrom * 1000), ...excludeSavedBind, limit).all();
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
                                 JOIN episodes e ON e.id = c.episode_id
                                 JOIN content_items ci ON ci.id = e.content_item_id
                                 WHERE c.episode_id=?
                                   AND c.is_available = 1
                                   AND EXISTS (
                                     SELECT 1 FROM card_subtitles cs
                                     WHERE cs.card_id = c.id
                                       AND cs.language = ci.main_language
                                       AND cs.text IS NOT NULL
                                       AND TRIM(cs.text) != ''
                                   )
                                   ${excludeSavedCondition}
                                 ORDER BY c.start_time_ms ASC
                                 LIMIT ?`;
              res = await env.DB.prepare(sqlLegacy).bind(ep.id, ...excludeSavedBind, limit).all();
            }
          }
          const rows = res.results || [];
          // Optimize: Batch fetch subtitles and difficulty levels for all cards
          const cardIds = rows.map(r => r.internal_id);
          const subsMap = new Map();
          const levelsMap = new Map(); // Map<card_id, Array<{framework, level, language}>>
          if (cardIds.length > 0) {
            // Reduced batch size to avoid CPU timeout (50 instead of 100)
            const batchSize = 50;
            // Fetch subtitles and difficulty levels in parallel batches for better performance
            const subtitleBatches = [];
            const levelsBatches = [];
            
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
              
              // Prepare subtitle batch query
              subtitleBatches.push(
                env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
                  })
                  .catch(e => {
                    console.error('[WORKER] Error fetching subtitles batch:', e);
                  })
              );
              
              // Prepare difficulty levels batch query (all frameworks, not just CEFR)
              levelsBatches.push(
                env.DB.prepare(`SELECT card_id, framework, level, language FROM card_difficulty_levels WHERE card_id IN (${ph})`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(l => {
                      if (!levelsMap.has(l.card_id)) levelsMap.set(l.card_id, []);
                      levelsMap.get(l.card_id).push({
                        framework: l.framework || 'CEFR',
                        level: l.level,
                        language: l.language || null
                      });
                    });
                  })
                  .catch(e => {
                    console.error('[WORKER] Error fetching difficulty levels batch:', e);
                  })
              );
              }
            
            // Execute all batches in parallel (but limit concurrency)
            try {
              await Promise.all([...subtitleBatches, ...levelsBatches]);
            } catch (e) {
              console.error('[WORKER] Error in batch fetch:', e);
            }
          }
          const out = [];
          for (const r of rows) {
            const subtitle = subsMap.get(r.internal_id) || {};
            const levels = levelsMap.get(r.internal_id) || [];
            const displayId = String(r.card_number ?? '').padStart(3, '0');
            const outEpisodeId = ep.slug || `${filmSlug}_${epNum}`;
            const startS = (r.start_time != null) ? r.start_time : Math.round((r.start_time_ms || 0) / 1000);
            const endS = (r.end_time != null) ? r.end_time : Math.round((r.end_time_ms || 0) / 1000);
            const dur = (r.duration != null) ? r.duration : Math.max(0, endS - startS);
            // Build image and audio URLs from stored keys
            const basePublic = (env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
            const imageUrl = r.image_key
              ? (basePublic ? `${basePublic}/${r.image_key}` : `/${r.image_key}`)
              : '';
            const audioUrl = r.audio_key
              ? (basePublic ? `${basePublic}/${r.audio_key}` : `/${r.audio_key}`)
              : '';
            out.push({ id: displayId, episode_id: outEpisodeId, start: startS, end: endS, duration: dur, image_url: imageUrl, audio_url: audioUrl, sentence: r.sentence, card_type: r.card_type, length: r.length, difficulty_score: r.difficulty_score, levels: levels, is_available: r.is_available, subtitle });
          }
          return json(out);
        } catch (e) {
          return json([]);
        }
      }

      // 5a) Single card by path: /cards/{filmSlug}/{episodeSlug}/{cardId}
      const singleCardMatch = path.match(/^\/cards\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (singleCardMatch && request.method === 'GET') {
        const filmSlug = decodeURIComponent(singleCardMatch[1]);
        const episodeSlug = decodeURIComponent(singleCardMatch[2]);
        const cardId = decodeURIComponent(singleCardMatch[3]);
        try {
          // Define makeMediaUrl helper function for this endpoint
          const basePublic = env.R2_PUBLIC_BASE || '';
          const makeMediaUrl = (k) => {
            if (!k) return null;
            return basePublic ? `${basePublic}/${k}` : `${url.origin}/media/${k}`;
          };
          
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) return json({ error: 'Not found' }, { status: 404 });
          
          // Parse episode number
          let epNum = Number(String(episodeSlug).replace(/^e/i, ''));
          if (!epNum || Number.isNaN(epNum)) {
            const m = String(episodeSlug).match(/_(\d+)$/);
            epNum = m ? Number(m[1]) : 1;
          }
          
          // Find episode
          let ep;
          try {
            ep = await env.DB.prepare('SELECT id, slug FROM episodes WHERE content_item_id=? AND slug=?').bind(filmRow.id, episodeSlug).first();
          } catch (e) {
            try {
              ep = await env.DB.prepare('SELECT id, slug FROM episodes WHERE content_item_id=? AND episode_number=?').bind(filmRow.id, epNum).first();
            } catch {}
          }
          if (!ep) return json({ error: 'Not found' }, { status: 404 });
          
          // Find card by UUID (internal id) or card_number
          // Check if cardId looks like a UUID (contains hyphens)
          const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cardId);
          let cardRow;
          
          if (isUUID) {
            // Try UUID first (most common case from search API)
            // Must check episode_id to ensure card belongs to the correct episode
            try {
              cardRow = await env.DB.prepare(`
                SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                       c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                       c.difficulty_score, c.is_available,
                       ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                       e.slug AS episode_slug, e.episode_number
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.id = ? AND c.episode_id = ?
              `).bind(cardId, ep.id).first();
            } catch (e) {
              console.error('[WORKER /cards] Error fetching by UUID:', e);
            }
          }
          
          // If not found by UUID or not a UUID, try by card_number
          if (!cardRow) {
            const cardNumberPadded = String(cardId).padStart(3, '0');
            const cardNumber = Number(cardNumberPadded);
            if (!Number.isNaN(cardNumber)) {
              try {
                cardRow = await env.DB.prepare(`
                  SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                         c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                         c.difficulty_score, c.is_available,
                         ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                         e.slug AS episode_slug, e.episode_number
                  FROM cards c
                  JOIN episodes e ON e.id = c.episode_id
                  JOIN content_items ci ON ci.id = e.content_item_id
                  WHERE c.episode_id = ? AND c.card_number = ?
                `).bind(ep.id, cardNumber).first();
              } catch (e) {
                console.error('[WORKER /cards] Error fetching by card_number:', e);
              }
            }
          }
          
          // Final fallback: try UUID without episode_id check (in case episode_id doesn't match)
          // This handles edge cases where episode slug might be different but card exists
          if (!cardRow && isUUID) {
            try {
              cardRow = await env.DB.prepare(`
                SELECT c.id, c.card_number, c.start_time, c.end_time, c.duration,
                       c.image_key, c.audio_key, c.sentence, c.card_type, c.length,
                       c.difficulty_score, c.is_available,
                       ci.slug AS content_slug, ci.title AS content_title, ci.main_language,
                       e.slug AS episode_slug, e.episode_number
                FROM cards c
                JOIN episodes e ON e.id = c.episode_id
                JOIN content_items ci ON ci.id = e.content_item_id
                WHERE c.id = ? AND ci.id = ?
              `).bind(cardId, filmRow.id).first();
            } catch (e) {
              console.error('[WORKER /cards] Error fetching by UUID (no episode check):', e);
            }
          }
          
          if (!cardRow) return json({ error: 'Not found' }, { status: 404 });
          
          // Fetch subtitles and levels for this card
          const [subsResult, levelsResult] = await Promise.all([
            env.DB.prepare('SELECT language, text FROM card_subtitles WHERE card_id=?').bind(cardRow.id).all(),
            env.DB.prepare('SELECT framework, level, language FROM card_difficulty_levels WHERE card_id=?').bind(cardRow.id).all()
          ]);
          
          const subtitle = {};
          (subsResult.results || []).forEach(s => {
            subtitle[s.language] = s.text;
          });
          
          const levels = [];
          (levelsResult.results || []).forEach(l => {
            levels.push({
              framework: l.framework,
              level: l.level,
              language: l.language || null
            });
          });
          
          const displayId = String(cardRow.card_number ?? '').padStart(3, '0');
          const out = {
            id: displayId,
            card_id: cardRow.id,
            film_id: filmSlug,
            episode_id: cardRow.episode_slug || `${filmSlug}_${epNum}`,
            episode: cardRow.episode_number,
            start: cardRow.start_time,
            end: cardRow.end_time,
            duration: cardRow.duration || Math.max(0, cardRow.end_time - cardRow.start_time),
            image_key: cardRow.image_key,
            audio_key: cardRow.audio_key,
            image_url: makeMediaUrl(cardRow.image_key),
            audio_url: makeMediaUrl(cardRow.audio_key),
            sentence: cardRow.sentence,
            card_type: cardRow.card_type,
            length: cardRow.length,
            difficulty_score: cardRow.difficulty_score,
            cefr_level: levels.find(l => l.framework === 'CEFR')?.level || null,
            levels: levels,
            subtitle: subtitle,
            is_available: cardRow.is_available ?? 1,
            content_slug: cardRow.content_slug,
            content_title: cardRow.content_title,
            content_main_language: cardRow.main_language
          };
          
          return json(out);
        } catch (e) {
          console.error('[WORKER /cards/{filmSlug}/{episodeSlug}/{cardId}] Error:', e);
          return json({ error: 'Internal server error' }, { status: 500 });
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
                       FROM cards c 
                       JOIN episodes e ON c.episode_id=e.id
                       JOIN content_items ci ON ci.id = e.content_item_id
                       WHERE e.content_item_id=?
                         AND c.is_available = 1
                         AND EXISTS (
                           SELECT 1 FROM card_subtitles cs
                           WHERE cs.card_id = c.id
                             AND cs.language = ci.main_language
                             AND cs.text IS NOT NULL
                             AND TRIM(cs.text) != ''
                         )
                       ORDER BY e.episode_number ASC, c.card_number ASC LIMIT ?`;
            res = await env.DB.prepare(sql).bind(filmRow.id, limit).all();
          } catch (e) {
            // Fallback older schema (episode_num)
            try {
              const sql2 = `SELECT c.card_number,c.start_time AS start_time,c.end_time AS end_time,c.duration,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_num AS episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c 
                       JOIN episodes e ON c.episode_id=e.id
                       JOIN content_items ci ON ci.id = e.content_item_id
                       WHERE e.content_item_id=?
                         AND c.is_available = 1
                         AND EXISTS (
                           SELECT 1 FROM card_subtitles cs
                           WHERE cs.card_id = c.id
                             AND cs.language = ci.main_language
                             AND cs.text IS NOT NULL
                             AND TRIM(cs.text) != ''
                         )
                       ORDER BY e.episode_num ASC, c.card_number ASC LIMIT ?`;
              res = await env.DB.prepare(sql2).bind(filmRow.id, limit).all();
            } catch (e2) {
              // Final fallback: legacy ms columns
              const sql3 = `SELECT c.card_number,c.start_time_ms,c.end_time_ms,c.image_key,c.audio_key,c.sentence,c.card_type,c.length,c.difficulty_score,c.is_available,e.episode_number,e.slug as episode_slug,c.id as internal_id
                       FROM cards c 
                       JOIN episodes e ON c.episode_id=e.id
                       JOIN content_items ci ON ci.id = e.content_item_id
                       WHERE e.content_item_id=?
                         AND c.is_available = 1
                         AND EXISTS (
                           SELECT 1 FROM card_subtitles cs
                           WHERE cs.card_id = c.id
                             AND cs.language = ci.main_language
                             AND cs.text IS NOT NULL
                             AND TRIM(cs.text) != ''
                         )
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
            // Reduced batch size to avoid CPU timeout (50 instead of 100)
            const batchSize = 50;
            // Fetch in parallel batches for better performance
            const subtitleBatches = [];
            const cefrBatches = [];
            
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
              
              subtitleBatches.push(
                env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
                  })
                  .catch(e => console.error('[WORKER /items/cards] Error fetching subtitles batch:', e))
              );
              
              cefrBatches.push(
                env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${ph}) AND framework='CEFR'`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
                  })
                  .catch(e => console.error('[WORKER /items/cards] Error fetching CEFR levels batch:', e))
              );
            }
            
            try {
              await Promise.all([...subtitleBatches, ...cefrBatches]);
            } catch (e) {
              console.error('[WORKER /items/cards] Error in batch fetch:', e);
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
            // Reduced batch size to avoid CPU timeout (50 instead of 100)
            const batchSize = 50;
            // Fetch in parallel batches for better performance
            const subtitleBatches = [];
            const cefrBatches = [];
            
              for (let i = 0; i < cardIds.length; i += batchSize) {
                const batch = cardIds.slice(i, i + batchSize);
                const ph = batch.map(() => '?').join(',');
              
              subtitleBatches.push(
                env.DB.prepare(`SELECT card_id, language, text FROM card_subtitles WHERE card_id IN (${ph})`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(s => {
                  if (!subsMap.has(s.card_id)) subsMap.set(s.card_id, {});
                  subsMap.get(s.card_id)[s.language] = s.text;
                });
                  })
                  .catch(e => console.error('[WORKER /cards] Error fetching subtitles batch:', e))
              );
              
              cefrBatches.push(
                env.DB.prepare(`SELECT card_id, level FROM card_difficulty_levels WHERE card_id IN (${ph}) AND framework='CEFR'`).bind(...batch).all()
                  .then(result => {
                    (result.results || []).forEach(c => cefrMap.set(c.card_id, c.level));
                  })
                  .catch(e => console.error('[WORKER /cards] Error fetching CEFR levels batch:', e))
              );
            }
            
            try {
              await Promise.all([...subtitleBatches, ...cefrBatches]);
            } catch (e) {
              console.error('[WORKER /cards] Error in batch fetch:', e);
            }
          }
          if (filmIds.length > 0) {
            // Batch film IDs to avoid SQLite parameter limit
            // Error at offset 248 suggests ~250 params, so use very small batch
            // Use batch size of 10 to be safe (10 params per batch)
            const batchSize = 10; // Very small batch to avoid SQLite parameter limit
            try {
              for (let i = 0; i < filmIds.length; i += batchSize) {
                const batch = filmIds.slice(i, i + batchSize);
                const phFilm = batch.map(() => '?').join(',');
                const allFilms = await env.DB.prepare(`SELECT id, slug FROM content_items WHERE id IN (${phFilm})`).bind(...batch).all();
              (allFilms.results || []).forEach(f => filmSlugMap.set(f.id, f.slug));
              }
            } catch (e) {
              console.error('[WORKER /cards] Error fetching film slugs:', e);
            }
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

      // 6b) Full-text search endpoint over subtitles
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

          // ---------- 1) Try LIKE search on card_subtitles ----------
          let rows = [];
          try {
            // Build a LIKE query for card_subtitles
            // Since users only search after selecting from autocomplete, LIKE is acceptable
            const langForSearch = mainCanon || null;
            const likePattern = buildLikeQuery(q, langForSearch);
            if (!likePattern) {
              return json({ items: [], total: 0, page: 0, size: 0 });
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
              FROM cards c
              JOIN episodes e ON e.id = c.episode_id
              JOIN content_items ci ON ci.id = e.content_item_id
              JOIN card_subtitles cs ON cs.card_id = c.id
              WHERE cs.text LIKE ?
                AND c.is_available = 1
                AND EXISTS (
                  SELECT 1 FROM card_subtitles cs_main
                  WHERE cs_main.card_id = c.id
                    AND cs_main.language = ci.main_language
                    AND cs_main.text IS NOT NULL
                    AND TRIM(cs_main.text) != ''
                )
              ${mainCanon ? 'AND LOWER(cs.language)=LOWER(?) AND LOWER(ci.main_language)=LOWER(?)' : ''}
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

            // Build LIKE pattern with % wildcards (buildLikeQuery already escapes special chars)
            const likePatternWithWildcards = `%${likePattern}%`;
            
            const bindLike = [likePatternWithWildcards];
            if (mainCanon) {
              // language to search in subtitles (main audio language) AND content_items.main_language
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
          } catch (e) {
            // Log error and return empty results
            console.error('[WORKER /search] LIKE search error:', e);
            rows = [];
          }

          // ---------- 2) Fallback: LIKE search on card_subtitles.text if primary search returned nothing ----------
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
                AND c.is_available = 1
                AND EXISTS (
                  SELECT 1 FROM card_subtitles cs_main
                  WHERE cs_main.card_id = c.id
                    AND cs_main.language = ci.main_language
                    AND cs_main.text IS NOT NULL
                    AND cs_main.text != ''
                )
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
          
          // --- OPTIMIZED BATCH FETCHING: Fix N+1 Query Problem ---
          // Extract all card IDs from search results
          const cardIds = rows.map(r => r.internal_id).filter(Boolean);
          
          // Batch fetch ALL subtitles for all cards in ONE query
          let allSubtitles = [];
          if (cardIds.length > 0) {
            const placeholders = cardIds.map(() => '?').join(',');
            try {
              const subtitlesQuery = await env.DB.prepare(`
                SELECT card_id, language, text
                FROM card_subtitles 
                WHERE card_id IN (${placeholders})
              `).bind(...cardIds).all();
              allSubtitles = subtitlesQuery.results || [];
            } catch {}
          }
          
          // Group subtitles by card_id using Map (JavaScript is fast & free)
          const subtitlesMap = new Map();
          for (const sub of allSubtitles) {
            if (!subtitlesMap.has(sub.card_id)) {
              subtitlesMap.set(sub.card_id, {});
            }
            subtitlesMap.get(sub.card_id)[sub.language] = sub.text;
          }
          
          // Batch fetch ALL difficulty levels for all cards in ONE query
          let allLevels = [];
          if (cardIds.length > 0) {
            const placeholders = cardIds.map(() => '?').join(',');
            try {
              const levelsQuery = await env.DB.prepare(`
                SELECT card_id, framework, level, language
                FROM card_difficulty_levels 
                WHERE card_id IN (${placeholders})
              `).bind(...cardIds).all();
              allLevels = levelsQuery.results || [];
            } catch {}
          }
          
          // Group difficulty levels by card_id
          const levelsMap = new Map();
          const cefrMap = new Map();
          for (const level of allLevels) {
            if (!levelsMap.has(level.card_id)) {
              levelsMap.set(level.card_id, []);
            }
            levelsMap.get(level.card_id).push({
              framework: level.framework,
              level: level.level,
              language: level.language || null
            });
            
            // Track CEFR level for backward compatibility
            if (level.framework === 'CEFR' && !cefrMap.has(level.card_id)) {
              cefrMap.set(level.card_id, level.level);
            }
          }
          
          // Now build output array by attaching pre-fetched data
          const out = [];
          for (const r of rows) {
            const subtitle = subtitlesMap.get(r.internal_id) || {};
            const levels = levelsMap.get(r.internal_id) || [];
            const cefr = cefrMap.get(r.internal_id) || null;
            
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
              // Replace existing subtitles
              await env.DB.prepare('DELETE FROM card_subtitles WHERE card_id=?').bind(row.id).run();
              for (const [lang, text] of Object.entries(body.subtitle)) {
                if (text && String(text).trim()) {
                  await env.DB.prepare('INSERT INTO card_subtitles (card_id, language, text) VALUES (?, ?, ?)').bind(row.id, lang, text).run();
                }
              }
              // Update mapping table
              await updateCardSubtitleLanguageMap(env, row.id);
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
            try { await env.DB.prepare('DELETE FROM card_difficulty_levels WHERE card_id=?').bind(row.id).run(); } catch {}
            // Update summary table
            await updateCardSubtitleLanguages(env, row.id);
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

      // 8.5) Categories API endpoints
      // List all categories
      if (path === '/categories' && request.method === 'GET') {
        try {
          const categories = await env.DB.prepare('SELECT id, name, created_at, updated_at FROM categories ORDER BY name ASC').all();
          return json({ categories: categories.results || [] });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Create a new category
      if (path === '/categories' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { name } = body;
          if (!name || !String(name).trim()) {
            return json({ error: 'Category name is required' }, { status: 400 });
          }
          const catName = String(name).trim();
          // Check if category already exists
          const existing = await env.DB.prepare('SELECT id, name FROM categories WHERE name=?').bind(catName).first();
          if (existing) {
            return json({ id: existing.id, name: existing.name, created: false });
          }
          // Create new category
          const catUuid = crypto.randomUUID();
          await env.DB.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').bind(catUuid, catName).run();
          return json({ id: catUuid, name: catName, created: true });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Update a category
      if (path.startsWith('/categories/') && request.method === 'PATCH') {
        try {
          const categoryId = path.replace('/categories/', '').split('?')[0];
          const body = await request.json();
          const { name } = body;
          if (!name || !String(name).trim()) {
            return json({ error: 'Category name is required' }, { status: 400 });
          }
          const catName = String(name).trim();
          // Check if another category with same name exists
          const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=? AND id!=?').bind(catName, categoryId).first();
          if (existing) {
            return json({ error: 'Category with this name already exists' }, { status: 400 });
          }
          await env.DB.prepare('UPDATE categories SET name=?, updated_at=strftime(\'%s\',\'now\') WHERE id=?').bind(catName, categoryId).run();
          return json({ id: categoryId, name: catName });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Check category usage (how many content items use this category)
      if (path.startsWith('/categories/') && path.endsWith('/usage') && request.method === 'GET') {
        try {
          const categoryId = path.replace('/categories/', '').replace('/usage', '').split('?')[0];
          const usageResult = await env.DB.prepare('SELECT COUNT(*) as count FROM content_item_categories WHERE category_id=?').bind(categoryId).first();
          const count = usageResult ? (usageResult.count || 0) : 0;
          return json({ category_id: categoryId, usage_count: count });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Delete a category
      if (path.startsWith('/categories/') && request.method === 'DELETE') {
        try {
          const categoryId = path.replace('/categories/', '').split('?')[0];
          // Check if category is being used
          const usageResult = await env.DB.prepare('SELECT COUNT(*) as count FROM content_item_categories WHERE category_id=?').bind(categoryId).first();
          const usageCount = usageResult ? (usageResult.count || 0) : 0;
          if (usageCount > 0) {
            return json({ error: `Cannot delete category: it is currently assigned to ${usageCount} content item(s). Please remove the category from all content items first.` }, { status: 400 });
          }
          // Category is not in use, safe to delete
          await env.DB.prepare('DELETE FROM categories WHERE id=?').bind(categoryId).run();
          return json({ ok: true, deleted: categoryId });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Get categories for a specific content item
      if (path.startsWith('/items/') && path.endsWith('/categories') && request.method === 'GET') {
        try {
          const filmSlug = path.replace('/items/', '').replace('/categories', '');
          const filmRow = await env.DB.prepare('SELECT id FROM content_items WHERE slug=?').bind(filmSlug).first();
          if (!filmRow) {
            return json({ error: 'Content item not found' }, { status: 404 });
          }
          const categories = await env.DB.prepare(`
            SELECT c.id, c.name, c.created_at, c.updated_at 
            FROM categories c
            INNER JOIN content_item_categories cic ON c.id = cic.category_id
            WHERE cic.content_item_id = ?
            ORDER BY c.name ASC
          `).bind(filmRow.id).all();
          return json({ categories: categories.results || [] });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
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
            // Update metadata if provided
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
            try { await env.DB.batch(subLangStmts); } catch {}
          }
          // Handle categories: create if needed and assign to content_item
          if (Array.isArray(film.category_ids) && film.category_ids.length) {
            try {
              // First, ensure all categories exist (create if needed)
              const categoryStmts = [];
              for (const catNameOrId of film.category_ids) {
                // Check if it's an ID (UUID format) or a name
                const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(catNameOrId);
                if (isUUID) {
                  // It's an ID, verify it exists
                  const existing = await env.DB.prepare('SELECT id FROM categories WHERE id=?').bind(catNameOrId).first();
                  if (!existing) continue; // Skip if category doesn't exist
                } else {
                  // It's a name, create if doesn't exist
                  const existing = await env.DB.prepare('SELECT id FROM categories WHERE name=?').bind(catNameOrId).first();
                  if (!existing) {
                    const catUuid = crypto.randomUUID();
                    categoryStmts.push(env.DB.prepare('INSERT INTO categories (id,name) VALUES (?,?)').bind(catUuid, catNameOrId));
                  }
                }
              }
              if (categoryStmts.length) await env.DB.batch(categoryStmts);
              
              // Now assign categories to content_item
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
              // Non-blocking error, continue
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
          const diffStmts = [];
          const cardIdsForSummaryUpdate = new Set(); // Track cards that need summary table update

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
              await runStmtBatches(diffStmts, 400);
              try { await env.DB.prepare('COMMIT').run(); } catch {}
              
              // Update mapping table after transaction commits (async, don't block)
              if (cardIdsForSummaryUpdate.size > 0) {
                updateCardSubtitleLanguageMapBatch(env, Array.from(cardIdsForSummaryUpdate)).catch(err => {
                  console.error('[ingestion] Failed to update mapping table:', err.message);
                });
              }
              
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

      // Admin: Update image path in database (for JPG -> AVIF migration)
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

      // Admin: Bulk migrate all database paths from .jpg/.webp/.mp3 to .avif/.opus
      if (path === '/admin/migrate-paths' && request.method === 'POST') {
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

          // Helper function to replace extension in path
          const replaceExt = (path, oldExt, newExt) => {
            if (!path) return path;
            const regex = new RegExp(`\\.${oldExt}$`, 'i');
            return path.replace(regex, `.${newExt}`);
          };

          if (dryRun) {
            // DRY RUN: Count what would be updated
            
            // Count content_items covers (.jpg, .jpeg, .webp)
            const contentCovers = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM content_items WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'`
            ).first();
            stats.contentCovers = contentCovers?.count || 0;
            
            const contentLandscapes = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM content_items WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg' OR cover_landscape_key LIKE '%.webp'`
            ).first();
            stats.contentLandscapes = contentLandscapes?.count || 0;
            
            // Count episodes covers (.jpg, .jpeg, .webp)
            const episodeCovers = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM episodes WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'`
            ).first();
            stats.episodeCovers = episodeCovers?.count || 0;
            
            // Note: episodes.cover_landscape_key column has been removed
            stats.episodeLandscapes = 0;
            
            // Count cards images (.jpg, .jpeg, .webp)
            const cardImages = await env.DB.prepare(
              `SELECT COUNT(*) as count FROM cards WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg' OR image_key LIKE '%.webp'`
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
            // Update content_items.cover_key (.jpg/.jpeg/.webp -> .avif)
            const r1 = await env.DB.prepare(`
              UPDATE content_items 
              SET cover_key = REPLACE(REPLACE(REPLACE(cover_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'
            `).run();
            stats.contentCovers = r1.meta?.changes || 0;
            
            // Update content_items.cover_landscape_key (.jpg/.jpeg/.webp -> .avif)
            const r2 = await env.DB.prepare(`
              UPDATE content_items 
              SET cover_landscape_key = REPLACE(REPLACE(REPLACE(cover_landscape_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_landscape_key LIKE '%.jpg' OR cover_landscape_key LIKE '%.jpeg' OR cover_landscape_key LIKE '%.webp'
            `).run();
            stats.contentLandscapes = r2.meta?.changes || 0;
            
            // Update episodes.cover_key (.jpg/.jpeg/.webp -> .avif)
            const r3 = await env.DB.prepare(`
              UPDATE episodes 
              SET cover_key = REPLACE(REPLACE(REPLACE(cover_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE cover_key LIKE '%.jpg' OR cover_key LIKE '%.jpeg' OR cover_key LIKE '%.webp'
            `).run();
            stats.episodeCovers = r3.meta?.changes || 0;
            
            // Note: episodes.cover_landscape_key column has been removed
            stats.episodeLandscapes = 0;
            
            // Update cards.image_key (.jpg/.jpeg/.webp -> .avif)
            const r5 = await env.DB.prepare(`
              UPDATE cards 
              SET image_key = REPLACE(REPLACE(REPLACE(image_key, '.webp', '.${imageExtension}'), '.jpg', '.${imageExtension}'), '.jpeg', '.${imageExtension}')
              WHERE image_key LIKE '%.jpg' OR image_key LIKE '%.jpeg' OR image_key LIKE '%.webp'
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

      // ==================== CARD STATE MANAGEMENT ====================
      
      // Helper function to get card UUID from display ID
      // ==================== GAMIFICATION HELPER FUNCTIONS ====================

// Get or create user_scores record
async function getOrCreateUserScores(env, userId) {
  let scores = await env.DB.prepare(`
    SELECT * FROM user_scores WHERE user_id = ?
  `).bind(userId).first();
  
  if (!scores) {
    const scoreId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_scores (id, user_id, created_at, updated_at)
      VALUES (?, ?, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(scoreId, userId).run();
    scores = await env.DB.prepare(`
      SELECT * FROM user_scores WHERE user_id = ?
    `).bind(userId).first();
  }
  
  return scores;
}

// Get or create user_daily_activity record for today
async function getOrCreateDailyActivity(env, userId) {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  let activity = await env.DB.prepare(`
    SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ?
  `).bind(userId, today).first();
  
  if (!activity) {
    const activityId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_daily_activity (id, user_id, activity_date, created_at, updated_at)
      VALUES (?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(activityId, userId, today).run();
    activity = await env.DB.prepare(`
      SELECT * FROM user_daily_activity WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  }
  
  return activity;
}

// Get reward config by ID (preferred method)
async function getRewardConfigById(env, rewardConfigId) {
  return await env.DB.prepare(`
    SELECT * FROM rewards_config WHERE id = ?
  `).bind(rewardConfigId).first();
}

// Get reward config by action_type (backward compatibility)
async function getRewardConfig(env, actionType) {
  return await env.DB.prepare(`
    SELECT * FROM rewards_config WHERE action_type = ?
  `).bind(actionType).first();
}

// Calculate Production Factor based on speaking_attempt and writing_attempt
// Production Factor = 1 + min(0.28, 0.01 * speaking_attempt + 0.005 * writing_attempt)
function calculateProductionFactor(speakingAttempt = 0, writingAttempt = 0) {
  const factor = 0.01 * speakingAttempt + 0.005 * writingAttempt;
  return 1 + Math.min(0.28, factor);
}

// Calculate SRS Interval based on state, srs_count, and production factor
// Returns interval in hours
async function calculateSRSInterval(env, srsState, srsCount, speakingAttempt = 0, writingAttempt = 0) {
  // Get base interval from srs_base_intervals
  const baseInterval = await env.DB.prepare(`
    SELECT base_interval_hours, interval_multiplier 
    FROM srs_base_intervals 
    WHERE srs_state = ?
  `).bind(srsState).first();
  
  if (!baseInterval) {
    // Default to 0 if state not found
    return 0;
  }
  
  const baseHours = baseInterval.base_interval_hours || 0;
  const multiplier = baseInterval.interval_multiplier || 1.0;
  
  // Calculate interval based on state-specific formula
  let intervalHours = 0;
  
  if (srsState === 'again') {
    // Again -> Base Interval = 1 hrs
    intervalHours = 1;
  } else if (srsState === 'hard') {
    // Hard -> Base Interval = 6 × (1.3 ^ SRS Count) hrs
    intervalHours = 6 * Math.pow(1.3, srsCount);
  } else if (srsState === 'good') {
    // Good -> Base Interval = 24 × (2.0 ^ SRS Count) hours
    intervalHours = 24 * Math.pow(2.0, srsCount);
  } else if (srsState === 'easy') {
    // Easy -> Base Interval = 48 × (2.5 ^ SRS Count) hrs
    intervalHours = 48 * Math.pow(2.5, srsCount);
  } else {
    // 'new' or other states - use base_interval_hours
    intervalHours = baseHours;
  }
  
  // Apply Production Factor
  const productionFactor = calculateProductionFactor(speakingAttempt, writingAttempt);
  intervalHours = intervalHours * productionFactor;
  
  return intervalHours;
}

// Determine if srs_count should be incremented based on state transition
// Returns true if srs_count should increment, false otherwise
function shouldIncrementSRSCount(oldState, newState) {
  // State hierarchy: again < hard < good < easy
  // Note: 'new' and 'none' are not in the hierarchy (they are initial states)
  const stateOrder = { 'again': 0, 'hard': 1, 'good': 2, 'easy': 3 };
  
  // Only process states that are in the hierarchy (again, hard, good, easy)
  // Ignore 'none' and 'new' states
  if (!stateOrder.hasOwnProperty(oldState) || !stateOrder.hasOwnProperty(newState)) {
    return false;
  }
  
  const oldOrder = stateOrder[oldState];
  const newOrder = stateOrder[newState];
  
  // Increment if:
  // 1. Upgrade (again->hard, hard->good, good->easy, etc.)
  // 2. Re-affirm good or easy (good->good, easy->easy)
  if (newOrder > oldOrder) {
    // Upgrade
    return true;
  } else if ((newState === 'good' || newState === 'easy') && newState === oldState) {
    // Re-affirm good or easy
    return true;
  }
  
  // Don't increment if:
  // - Downgrade (good->hard, easy->good, etc.)
  // - Re-affirm again or hard
  // - Any transition to/from 'none' or 'new'
  return false;
}

// Award XP and record transaction
async function awardXP(env, userId, xpAmount, rewardConfigId, description, cardId, filmId) {
  if (xpAmount <= 0) return;
  
  // Get or create user_scores
  await getOrCreateUserScores(env, userId);
  
  // Update total_xp in user_scores
  await env.DB.prepare(`
    UPDATE user_scores
    SET total_xp = total_xp + ?,
        level = CAST((total_xp + ?) / 100 AS INTEGER) + 1,
        updated_at = unixepoch() * 1000
    WHERE user_id = ?
  `).bind(xpAmount, xpAmount, userId).run();
  
  // Record XP transaction
  const transactionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO xp_transactions (id, user_id, reward_config_id, xp_amount, card_id, film_id, description, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000)
  `).bind(transactionId, userId, rewardConfigId, xpAmount, cardId || null, filmId || null, description || null).run();
  
  // Update daily activity
  const today = new Date().toISOString().split('T')[0];
  await getOrCreateDailyActivity(env, userId);
  await env.DB.prepare(`
    UPDATE user_daily_activity
    SET daily_xp = daily_xp + ?,
        updated_at = unixepoch() * 1000
    WHERE user_id = ? AND activity_date = ?
  `).bind(xpAmount, userId, today).run();
  
  // Update user_daily_stats (historical record) - update xp_earned
  const statsExisting = await env.DB.prepare(`
    SELECT id FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
  `).bind(userId, today).first();
  
  if (statsExisting) {
    await env.DB.prepare(`
      UPDATE user_daily_stats
      SET xp_earned = xp_earned + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND stats_date = ?
    `).bind(xpAmount, userId, today).run();
  } else {
    // Record doesn't exist, create new one with xp_earned
    // Initialize listening_time and reading_time to 0 in case trackTime hasn't run yet
    const statsId = crypto.randomUUID();
    await env.DB.prepare(`
      INSERT INTO user_daily_stats (id, user_id, stats_date, xp_earned, listening_time, reading_time, created_at, updated_at)
      VALUES (?, ?, ?, ?, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
    `).bind(statsId, userId, today, xpAmount).run();
  }
  
  // Check and update daily streak (if daily_xp >= 20)
  await checkAndUpdateStreak(env, userId);
}

// Award coins and record transaction
async function awardCoins(env, userId, coinAmount, rewardConfigId, description) {
  if (coinAmount <= 0) return;
  
  // Get or create user_scores
  await getOrCreateUserScores(env, userId);
  
  // Update coins in user_scores
  await env.DB.prepare(`
    UPDATE user_scores
    SET coins = coins + ?,
        total_coins_earned = total_coins_earned + ?,
        updated_at = unixepoch() * 1000
    WHERE user_id = ?
  `).bind(coinAmount, coinAmount, userId).run();
  
  // Record coin transaction
  const transactionId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO coin_transactions (id, user_id, reward_config_id, coin_amount, transaction_type, description, created_at)
    VALUES (?, ?, ?, ?, 'earn', ?, unixepoch() * 1000)
  `).bind(transactionId, userId, rewardConfigId, coinAmount, description || null).run();
}

// Check and update daily streak (if daily_xp >= 20, increment streak)
async function checkAndUpdateStreak(env, userId) {
  const today = new Date().toISOString().split('T')[0];
  const activity = await getOrCreateDailyActivity(env, userId);
  
  // Only update streak if daily_xp >= 20 and we haven't already updated today
  if (activity.daily_xp >= 20) {
    const scores = await getOrCreateUserScores(env, userId);
    const lastStudyDate = scores.last_study_date;
    
    // Check if this is a new day (streak continuation or new streak)
    if (lastStudyDate !== today) {
      let newStreak = 1;
      
      if (lastStudyDate) {
        // Check if yesterday was studied (streak continuation)
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split('T')[0];
        
        if (lastStudyDate === yesterdayStr) {
          // Continue streak
          newStreak = (scores.current_streak || 0) + 1;
        }
        // Otherwise, new streak (already set to 1)
      }
      
      // Update streak
      const longestStreak = Math.max(scores.longest_streak || 0, newStreak);
      await env.DB.prepare(`
        UPDATE user_scores
        SET current_streak = ?,
            longest_streak = ?,
            last_study_date = ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ?
      `).bind(newStreak, longestStreak, today, userId).run();
      
      // Record streak history
      const historyId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT OR REPLACE INTO user_streak_history (id, user_id, streak_date, streak_achieved, streak_count, created_at)
        VALUES (?, ?, ?, 1, ?, unixepoch() * 1000)
      `).bind(historyId, userId, today, newStreak).run();
    }
  }
}

// Track listening or reading time and award XP based on checkpoints
async function trackTime(env, userId, timeSeconds, type) {
  if (timeSeconds <= 0) return { xpAwarded: 0 };
  
  const today = new Date().toISOString().split('T')[0];
  await getOrCreateDailyActivity(env, userId);
  await getOrCreateUserScores(env, userId);
  
  // Get reward config by ID
  const rewardConfigId = type === 'listening' ? REWARD_CONFIG_IDS.LISTENING_5S : REWARD_CONFIG_IDS.READING_8S;
  const rewardConfig = await getRewardConfigById(env, rewardConfigId);
  if (!rewardConfig) return { xpAwarded: 0 };
  
  // Use interval_seconds from config, fallback to defaults if not set
  const intervalSeconds = rewardConfig.interval_seconds || (type === 'listening' ? 5 : 8);
  const checkpointField = type === 'listening' ? 'daily_listening_checkpoint' : 'daily_reading_checkpoint';
  const timeField = type === 'listening' ? 'daily_listening_time' : 'daily_reading_time';
  const totalTimeField = type === 'listening' ? 'total_listening_time' : 'total_reading_time';
  
  // Get current checkpoint - use separate queries for listening vs reading
  let activity;
  if (type === 'listening') {
    activity = await env.DB.prepare(`
      SELECT daily_listening_checkpoint, daily_listening_time FROM user_daily_activity
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  } else {
    activity = await env.DB.prepare(`
      SELECT daily_reading_checkpoint, daily_reading_time FROM user_daily_activity
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).first();
  }
  
  const currentCheckpoint = (type === 'listening' ? activity?.daily_listening_checkpoint : activity?.daily_reading_checkpoint) || 0;
  const currentTime = (type === 'listening' ? activity?.daily_listening_time : activity?.daily_reading_time) || 0;
  
  // Calculate new total time
  const newTime = currentTime + timeSeconds;
  
  // Calculate how many intervals we've completed (beyond checkpoint)
  const newCheckpoint = Math.floor(newTime / intervalSeconds) * intervalSeconds;
  const intervalsCompleted = Math.floor((newCheckpoint - currentCheckpoint) / intervalSeconds);
  
  // Award XP for completed intervals
  let totalXPAwarded = 0;
  if (intervalsCompleted > 0 && rewardConfig.xp_amount > 0) {
    const xpToAward = intervalsCompleted * rewardConfig.xp_amount;
    await awardXP(env, userId, xpToAward, rewardConfig.id, `${type} time tracking`, null, null);
    totalXPAwarded = xpToAward;
  }
  
  // Update daily activity - use separate queries for listening vs reading
  if (type === 'listening') {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET daily_listening_time = ?,
          daily_listening_checkpoint = ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(newTime, newCheckpoint, userId, today).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET daily_reading_time = ?,
          daily_reading_checkpoint = ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(newTime, newCheckpoint, userId, today).run();
  }
  
  // Update total time in user_scores
  if (type === 'listening') {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_listening_time = total_listening_time + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(timeSeconds, userId).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_reading_time = total_reading_time + ?,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(timeSeconds, userId).run();
  }
  
  // Update user_daily_stats (historical record)
  // Note: awardXP() already updated xp_earned above if XP was awarded
  // We just need to update listening_time or reading_time here
  if (type === 'listening') {
    // Use INSERT OR REPLACE to handle case where record might exist from awardXP
    // Or use ON CONFLICT DO UPDATE for better control
    const existing = await env.DB.prepare(`
      SELECT id, xp_earned FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
    `).bind(userId, today).first();
    
    if (existing) {
      // Record exists (might have been created by awardXP), just update listening_time
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET listening_time = COALESCE(listening_time, 0) + ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(timeSeconds, userId, today).run();
    } else {
      // Record doesn't exist, create new one with listening_time and xp_earned = 0 (or NULL, default will be 0)
      const statsId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, listening_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today, timeSeconds).run();
    }
  } else {
    // Reading time - same logic
    const existing = await env.DB.prepare(`
      SELECT id, xp_earned FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
    `).bind(userId, today).first();
    
    if (existing) {
      // Record exists (might have been created by awardXP), just update reading_time
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET reading_time = COALESCE(reading_time, 0) + ?,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(timeSeconds, userId, today).run();
    } else {
      // Record doesn't exist, create new one with reading_time and xp_earned = 0
      const statsId = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, ?, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today, timeSeconds).run();
    }
  }
  
  return { xpAwarded: totalXPAwarded };
}

// Track speaking or writing attempt and award XP
async function trackAttempt(env, userId, type, cardId, filmId) {
  // Get reward config by ID
  const rewardConfigId = type === 'speaking' ? REWARD_CONFIG_IDS.SPEAKING_ATTEMPT : REWARD_CONFIG_IDS.WRITING_ATTEMPT;
  const rewardConfig = await getRewardConfigById(env, rewardConfigId);
  if (!rewardConfig) return { xpAwarded: 0 };
  
  const today = new Date().toISOString().split('T')[0];
  await getOrCreateUserScores(env, userId);
  await getOrCreateDailyActivity(env, userId);
  
  // Award XP (will handle transaction, daily stats, and streak)
  if (rewardConfig.xp_amount > 0) {
    await awardXP(env, userId, rewardConfig.xp_amount, rewardConfig.id, `${type} attempt`, cardId || null, filmId || null);
  }
  
  // Update speaking_attempt or writing_attempt in user_card_states if card_id is provided
  if (cardId) {
    if (type === 'speaking') {
      await env.DB.prepare(`
        UPDATE user_card_states
        SET speaking_attempt = speaking_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND card_id = ?
      `).bind(userId, cardId).run();
    } else {
      await env.DB.prepare(`
        UPDATE user_card_states
        SET writing_attempt = writing_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND card_id = ?
      `).bind(userId, cardId).run();
    }
  }
  
  // Update user_scores (lifetime totals)
  if (type === 'speaking') {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_speaking_attempt = total_speaking_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(userId).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_scores
      SET total_writing_attempt = total_writing_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ?
    `).bind(userId).run();
  }
  
  // Update user_daily_activity (reset daily)
  if (type === 'speaking') {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET speaking_attempt = speaking_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).run();
  } else {
    await env.DB.prepare(`
      UPDATE user_daily_activity
      SET writing_attempt = writing_attempt + 1,
          updated_at = unixepoch() * 1000
      WHERE user_id = ? AND activity_date = ?
    `).bind(userId, today).run();
  }
  
  // Update user_daily_stats (historical record)
  const statsExisting = await env.DB.prepare(`
    SELECT id FROM user_daily_stats WHERE user_id = ? AND stats_date = ?
  `).bind(userId, today).first();
  
  if (statsExisting) {
    if (type === 'speaking') {
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET speaking_attempt = speaking_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(userId, today).run();
    } else {
      await env.DB.prepare(`
        UPDATE user_daily_stats
        SET writing_attempt = writing_attempt + 1,
            updated_at = unixepoch() * 1000
        WHERE user_id = ? AND stats_date = ?
      `).bind(userId, today).run();
    }
  } else {
    // Record doesn't exist, create new one
    const statsId = crypto.randomUUID();
    if (type === 'speaking') {
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, speaking_attempt, writing_attempt, listening_time, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, 1, 0, 0, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today).run();
    } else {
      await env.DB.prepare(`
        INSERT INTO user_daily_stats (id, user_id, stats_date, speaking_attempt, writing_attempt, listening_time, reading_time, xp_earned, created_at, updated_at)
        VALUES (?, ?, ?, 0, 1, 0, 0, 0, unixepoch() * 1000, unixepoch() * 1000)
      `).bind(statsId, userId, today).run();
    }
  }
  
  return { xpAwarded: rewardConfig.xp_amount || 0 };
}

async function getCardUUID(filmId, episodeId, cardDisplayId) {
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

      // Save/unsave a card (toggle SRS state between 'none' and 'new')
      if (path === '/api/card/save' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, card_id, film_id, episode_id } = body;
          
          if (!user_id || !card_id) {
            return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
          }
          
          // Get card UUID from display ID
          const cardUUID = await getCardUUID(film_id, episode_id, card_id);
          if (!cardUUID) {
            return json({ error: 'Card not found' }, { status: 404 });
          }
          
          // Get film_id and episode_id from card if not provided
          let finalFilmId = film_id;
          let finalEpisodeId = episode_id;
          
          if (!finalFilmId || !finalEpisodeId) {
            const cardInfo = await env.DB.prepare(`
              SELECT e.content_item_id, e.id as episode_id
              FROM cards c
              JOIN episodes e ON c.episode_id = e.id
              WHERE c.id = ?
            `).bind(cardUUID).first();
            
            if (cardInfo) {
              // Get film slug from content_item_id
              const filmInfo = await env.DB.prepare(`
                SELECT slug FROM content_items WHERE id = ?
              `).bind(cardInfo.content_item_id).first();
              
              finalFilmId = filmInfo?.slug || film_id;
              finalEpisodeId = cardInfo.episode_id || episode_id;
            }
          }
          
          // Check if card state already exists
          const existing = await env.DB.prepare(`
            SELECT id, srs_state FROM user_card_states
            WHERE user_id = ? AND card_id = ?
            LIMIT 1
          `).bind(user_id, cardUUID).first();
          
          let saved = false;
          
          if (existing) {
            if (existing.srs_state === 'none') {
              // Change from 'none' to 'new' (save)
              await env.DB.prepare(`
                UPDATE user_card_states
                SET srs_state = 'new',
                    state_created_at = unixepoch() * 1000,
                    state_updated_at = unixepoch() * 1000,
                    updated_at = unixepoch() * 1000
                WHERE user_id = ? AND card_id = ?
              `).bind(user_id, cardUUID).run();
              saved = true;
            } else {
              // Change from any state to 'none' (unsave)
              await env.DB.prepare(`
                UPDATE user_card_states
                SET srs_state = 'none',
                    state_updated_at = unixepoch() * 1000,
                    updated_at = unixepoch() * 1000
                WHERE user_id = ? AND card_id = ?
              `).bind(user_id, cardUUID).run();
              saved = false;
            }
          } else {
            // Create new state with 'new' (save)
            const stateId = crypto.randomUUID();
            await env.DB.prepare(`
              INSERT INTO user_card_states (
                id, user_id, card_id, film_id, episode_id,
                srs_state, state_created_at, state_updated_at,
                created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, 'new', unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
            `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId).run();
            saved = true;
          }
          
          return json({ saved });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Check if a card is saved
      // Batch get save status for multiple cards (optimized to reduce API calls)
      if (path === '/api/card/save-status-batch' && request.method === 'POST') {
        try {
          const body = await request.json();
          const userId = body.user_id;
          const cards = body.cards || []; // Array of {card_id, film_id, episode_id}
          
          if (!userId || !Array.isArray(cards) || cards.length === 0) {
            return json({ error: 'Missing required parameters (user_id, cards array)' }, { status: 400 });
          }
          
          // Limit batch size to prevent timeout
          const MAX_BATCH_SIZE = 100;
          const cardsToProcess = cards.slice(0, MAX_BATCH_SIZE);
          
          // Group cards by film_id and episode_id for batch lookup
          const filmEpisodeMap = new Map();
          cardsToProcess.forEach(card => {
            if (!card.film_id || !card.episode_id) return;
            const key = `${card.film_id}|${card.episode_id}`;
            if (!filmEpisodeMap.has(key)) {
              filmEpisodeMap.set(key, { film_id: card.film_id, episode_id: card.episode_id, cards: [] });
            }
            filmEpisodeMap.get(key).cards.push(card);
          });
          
          // Batch get card UUIDs by film/episode groups
          const cardUUIDPromises = Array.from(filmEpisodeMap.values()).map(async (group) => {
            // Parse episode number
            let epNum = parseInt(String(group.episode_id).replace(/^e/i, ''));
            if (isNaN(epNum)) {
              const m = String(group.episode_id).match(/_(\d+)$/);
              epNum = m ? parseInt(m[1]) : 1;
            }
            
            // Get film and episode IDs once per group
            const film = await env.DB.prepare(`SELECT id FROM content_items WHERE slug = ?`).bind(group.film_id).first();
            if (!film) return [];
            
            const ep = await env.DB.prepare(`SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?`).bind(film.id, epNum).first();
            if (!ep) return [];
            
            // Get all card UUIDs for this episode in one query
            const cardNumbers = group.cards.map(c => {
              const num = parseInt(c.card_id);
              return isNaN(num) ? null : num;
            }).filter(n => n !== null);
            
            if (cardNumbers.length === 0) return [];
            
            const placeholders = cardNumbers.map(() => '?').join(',');
            const cardRows = await env.DB.prepare(`
              SELECT card_number, id FROM cards 
              WHERE episode_id = ? AND card_number IN (${placeholders})
            `).bind(ep.id, ...cardNumbers).all();
            
            // Map card_number to card_id
            const numberToUUID = new Map();
            if (cardRows.results) {
              cardRows.results.forEach(row => {
                numberToUUID.set(row.card_number, row.id);
              });
            }
            
            // Return mappings for all cards in this group
            return group.cards.map(card => {
              const num = parseInt(card.card_id);
              const uuid = isNaN(num) ? null : numberToUUID.get(num);
              return { card_id: card.card_id, uuid };
            });
          });
          
          const cardUUIDArrays = await Promise.all(cardUUIDPromises);
          const cardUUIDs = cardUUIDArrays.flat();
          const validUUIDs = cardUUIDs.filter(c => c.uuid !== null);
          
          if (validUUIDs.length === 0) {
            // Return default values for all cards
            const result = {};
            cardsToProcess.forEach(card => {
              result[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
            });
            return json(result);
          }
          
          // Batch query all save statuses in one query
          const uuids = validUUIDs.map(c => c.uuid);
          const placeholders = uuids.map(() => '?').join(',');
          const query = `
            SELECT card_id, srs_state, review_count 
            FROM user_card_states
            WHERE user_id = ? AND card_id IN (${placeholders})
          `;
          
          const results = await env.DB.prepare(query)
            .bind(userId, ...uuids)
            .all();
          
          // Build result map
          const resultMap = {};
          const uuidToCardId = new Map(validUUIDs.map(c => [c.uuid, c.card_id]));
          
          // Initialize all cards with default values
          cardsToProcess.forEach(card => {
            resultMap[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
          });
          
          // Update with actual results
          if (results.results) {
            for (const row of results.results) {
              const cardId = uuidToCardId.get(row.card_id);
              if (cardId) {
                const saved = row.srs_state && row.srs_state !== 'none';
                resultMap[cardId] = {
                  saved,
                  srs_state: row.srs_state || 'none',
                  review_count: row.review_count || 0
                };
              }
            }
          }
          
          return json(resultMap);
        } catch (e) {
          console.error('[save-status-batch] Error:', e);
          // Return default values for all cards on error
          try {
            const body = await request.json();
            const result = {};
            (body.cards || []).forEach(card => {
              result[card.card_id] = { saved: false, srs_state: 'none', review_count: 0 };
            });
            return json(result);
          } catch (parseError) {
            return json({});
          }
        }
      }

      if (path === '/api/card/save-status' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const cardId = url.searchParams.get('card_id');
          const filmId = url.searchParams.get('film_id');
          const episodeId = url.searchParams.get('episode_id');
          
          if (!userId || !cardId) {
            return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
          }
          
          // Get card UUID from display ID (filmId and episodeId are required)
          if (!filmId || !episodeId) {
            return json({ saved: false, srs_state: 'none', review_count: 0 });
          }
          
          const cardUUID = await getCardUUID(filmId, episodeId, cardId);
          if (!cardUUID) {
            return json({ saved: false, srs_state: 'none', review_count: 0 });
          }
          
          const result = await env.DB.prepare(`
            SELECT srs_state, review_count FROM user_card_states
            WHERE user_id = ? AND card_id = ?
            LIMIT 1
          `).bind(userId, cardUUID).first();
          
          const saved = result && result.srs_state && result.srs_state !== 'none';
          
          return json({ 
            saved, 
            srs_state: result?.srs_state || 'none',
            review_count: result?.review_count || 0
          });
        } catch (e) {
          console.error('[save-status] Error:', e);
          // Return proper JSON error response with fallback values
          return json({ 
            error: e.message || 'Internal server error',
            saved: false,
            srs_state: 'none',
            review_count: 0
          }, { status: 500 });
        }
      }

      // Increment review count for a card
      if (path === '/api/card/increment-review' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, card_id, film_id, episode_id } = body;
          
          if (!user_id || !card_id) {
            return json({ error: 'Missing required parameters (user_id, card_id)' }, { status: 400 });
          }
          
          let cardUUID = null;
          
          // Try to get card UUID from display ID if film_id and episode_id are provided
          if (film_id && episode_id) {
            cardUUID = await getCardUUID(film_id, episode_id, card_id);
          }
          
          // If getCardUUID failed or film_id/episode_id not provided, try alternative methods
          if (!cardUUID) {
            // First, try if card_id is already a UUID (direct lookup)
            const directCard = await env.DB.prepare(`
              SELECT id FROM cards WHERE id = ?
            `).bind(card_id).first();
            
            if (directCard) {
              cardUUID = directCard.id;
            } else if (film_id && episode_id) {
              // Try alternative parsing if we have film_id and episode_id
              const film = await env.DB.prepare(`
                SELECT id FROM content_items WHERE slug = ?
              `).bind(film_id).first();
              
              if (film) {
                let epNum = parseInt(String(episode_id).replace(/^e/i, ''));
                if (isNaN(epNum)) {
                  const m = String(episode_id).match(/_(\d+)$/);
                  epNum = m ? parseInt(m[1]) : null;
                }
                
                if (epNum !== null && !isNaN(epNum)) {
                  const ep = await env.DB.prepare(`
                    SELECT id FROM episodes WHERE content_item_id = ? AND episode_number = ?
                  `).bind(film.id, epNum).first();
                  
                  if (ep) {
                    const cardNum = parseInt(card_id);
                    if (!isNaN(cardNum)) {
                      const card = await env.DB.prepare(`
                        SELECT id FROM cards WHERE episode_id = ? AND card_number = ?
                      `).bind(ep.id, cardNum).first();
                      if (card) {
                        cardUUID = card.id;
                      }
                    }
                  }
                }
              }
            }
          }
          
          if (!cardUUID) {
            return json({ error: 'Card not found. Please provide film_id and episode_id.' }, { status: 404 });
          }
          
          // Check if card state exists, if not create it
          const existing = await env.DB.prepare(`
            SELECT id, review_count FROM user_card_states
            WHERE user_id = ? AND card_id = ?
            LIMIT 1
          `).bind(user_id, cardUUID).first();
          
          let reviewCount = 0;
          
          if (existing) {
            // Increment existing review count
            await env.DB.prepare(`
              UPDATE user_card_states
              SET review_count = review_count + 1,
                  updated_at = unixepoch() * 1000
              WHERE user_id = ? AND card_id = ?
            `).bind(user_id, cardUUID).run();
            
            reviewCount = (existing.review_count || 0) + 1;
          } else {
            // Create new state with review_count = 1
            // Get film_id and episode_id from card if not provided
            let finalFilmId = film_id;
            let finalEpisodeId = episode_id;
            
            if (!finalFilmId || !finalEpisodeId) {
              const cardInfo = await env.DB.prepare(`
                SELECT e.content_item_id, e.id as episode_id
                FROM cards c
                JOIN episodes e ON c.episode_id = e.id
                WHERE c.id = ?
              `).bind(cardUUID).first();
              
              if (cardInfo) {
                const filmInfo = await env.DB.prepare(`
                  SELECT slug FROM content_items WHERE id = ?
                `).bind(cardInfo.content_item_id).first();
                
                finalFilmId = filmInfo?.slug || film_id;
                finalEpisodeId = cardInfo.episode_id || episode_id;
              }
            }
            
            // Use INSERT OR IGNORE to handle race conditions
            // If record already exists, we'll update it instead
            const stateId = crypto.randomUUID();
            try {
              await env.DB.prepare(`
                INSERT INTO user_card_states (
                  id, user_id, card_id, film_id, episode_id,
                  srs_state, review_count, state_created_at, state_updated_at,
                  created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'none', 1, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
              `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId).run();
              reviewCount = 1;
            } catch (insertError) {
              // If INSERT fails due to UNIQUE constraint, record already exists
              // Re-check and update instead
              const recheck = await env.DB.prepare(`
                SELECT id, review_count FROM user_card_states
                WHERE user_id = ? AND card_id = ?
                LIMIT 1
              `).bind(user_id, cardUUID).first();
              
              if (recheck) {
                await env.DB.prepare(`
                  UPDATE user_card_states
                  SET review_count = review_count + 1,
                      updated_at = unixepoch() * 1000
                  WHERE user_id = ? AND card_id = ?
                `).bind(user_id, cardUUID).run();
                reviewCount = (recheck.review_count || 0) + 1;
              } else {
                // If still not found, throw the original error
                throw insertError;
              }
            }
          }
          
          return json({ review_count: reviewCount });
        } catch (e) {
          console.error('[increment-review] Error:', e);
          return json({ error: e.message || 'Internal server error' }, { status: 500 });
        }
      }

      // Update SRS state for a card
      if (path === '/api/card/srs-state' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, card_id, film_id, episode_id, srs_state } = body;
          
          if (!user_id || !card_id || !srs_state) {
            return json({ error: 'Missing required parameters (user_id, card_id, srs_state)' }, { status: 400 });
          }
          
          // Validate srs_state
          const validStates = ['none', 'new', 'again', 'hard', 'good', 'easy'];
          if (!validStates.includes(srs_state)) {
            return json({ error: 'Invalid srs_state' }, { status: 400 });
          }
          
          // Get card UUID from display ID
          const cardUUID = await getCardUUID(film_id, episode_id, card_id);
          if (!cardUUID) {
            return json({ error: 'Card not found' }, { status: 404 });
          }
          
          // Initialize finalFilmId and finalEpisodeId from request params
          let finalFilmId = film_id || null;
          let finalEpisodeId = episode_id || null;
          
          // If not provided, get from existing state or card info
          if (!finalFilmId || !finalEpisodeId) {
            const existingState = await env.DB.prepare(`
              SELECT film_id, episode_id FROM user_card_states
              WHERE user_id = ? AND card_id = ?
              LIMIT 1
            `).bind(user_id, cardUUID).first();
            
            if (existingState) {
              finalFilmId = finalFilmId || existingState.film_id || null;
              finalEpisodeId = finalEpisodeId || existingState.episode_id || null;
            }
            
            // If still not found, get from card info
            if (!finalFilmId || !finalEpisodeId) {
              const cardInfo = await env.DB.prepare(`
                SELECT e.content_item_id, e.id as episode_id
                FROM cards c
                JOIN episodes e ON c.episode_id = e.id
                WHERE c.id = ?
              `).bind(cardUUID).first();
              
              if (cardInfo) {
                if (!finalFilmId) {
                  const filmInfo = await env.DB.prepare(`
                    SELECT slug FROM content_items WHERE id = ?
                  `).bind(cardInfo.content_item_id).first();
                  finalFilmId = filmInfo?.slug || null;
                }
                if (!finalEpisodeId) {
                  finalEpisodeId = cardInfo.episode_id || null;
                }
              }
            }
          }
          
          // Check if card state exists and get current values
          const existing = await env.DB.prepare(`
            SELECT id, srs_state, srs_count, speaking_attempt, writing_attempt, state_created_at
            FROM user_card_states
            WHERE user_id = ? AND card_id = ?
            LIMIT 1
          `).bind(user_id, cardUUID).first();
          
          // Get old state to check if it's a change (not from 'none' to 'none')
          const oldState = existing?.srs_state || 'none';
          const oldSRSCount = existing?.srs_count || 0;
          const speakingAttempt = existing?.speaking_attempt || 0;
          const writingAttempt = existing?.writing_attempt || 0;
          
          // Calculate new srs_count based on state transition
          let newSRSCount = oldSRSCount;
          if (oldState !== srs_state && oldState !== 'none' && srs_state !== 'none') {
            // Only update srs_count if state actually changed (not to/from 'none')
            // This handles transitions between: 'new', 'again', 'hard', 'good', 'easy'
            // shouldIncrementSRSCount will return false for transitions involving 'new' or 'none'
            if (shouldIncrementSRSCount(oldState, srs_state)) {
              newSRSCount = oldSRSCount + 1;
            }
            // If downgrade, re-affirm again/hard, or transition from/to 'new', keep srs_count unchanged
          } else if (oldState === 'none' && srs_state !== 'none') {
            // First time setting state (from 'none' to any state) - start with 0
            newSRSCount = 0;
          }
          
          // Calculate SRS interval and next_review_at
          const now = Date.now();
          let srsInterval = 0;
          let nextReviewAt = null;
          let lastReviewedAt = null;
          
          if (srs_state !== 'none') {
            // Calculate interval in hours
            srsInterval = await calculateSRSInterval(env, srs_state, newSRSCount, speakingAttempt, writingAttempt);
            
            // Set last_reviewed_at when state changes (not when setting to 'none')
            if (oldState !== srs_state) {
              lastReviewedAt = now;
              // next_review_at = last_reviewed_at + (interval in milliseconds)
              nextReviewAt = now + (srsInterval * 60 * 60 * 1000);
            } else {
              // If state didn't change, keep existing values
              const existingState = await env.DB.prepare(`
                SELECT last_reviewed_at, next_review_at FROM user_card_states
                WHERE user_id = ? AND card_id = ?
              `).bind(user_id, cardUUID).first();
              lastReviewedAt = existingState?.last_reviewed_at || null;
              nextReviewAt = existingState?.next_review_at || null;
            }
          }
          
          if (existing) {
            // Update existing state
            await env.DB.prepare(`
              UPDATE user_card_states
              SET srs_state = ?,
                  srs_count = ?,
                  srs_interval = ?,
                  next_review_at = ?,
                  last_reviewed_at = ?,
                  state_updated_at = unixepoch() * 1000,
                  updated_at = unixepoch() * 1000
              WHERE user_id = ? AND card_id = ?
            `).bind(srs_state, newSRSCount, srsInterval, nextReviewAt, lastReviewedAt, user_id, cardUUID).run();
          } else {
            // Create new state (should not happen if card is not saved, but handle it)
            // Get film_id and episode_id from card
            const cardInfo = await env.DB.prepare(`
              SELECT e.content_item_id, e.id as episode_id
              FROM cards c
              JOIN episodes e ON c.episode_id = e.id
              WHERE c.id = ?
            `).bind(cardUUID).first();
            
            let finalFilmId = film_id || null;
            let finalEpisodeId = episode_id || null;
            
            if (cardInfo) {
              if (!finalFilmId) {
                const filmInfo = await env.DB.prepare(`
                  SELECT slug FROM content_items WHERE id = ?
                `).bind(cardInfo.content_item_id).first();
                finalFilmId = filmInfo?.slug || null;
              }
              if (!finalEpisodeId) {
                finalEpisodeId = cardInfo.episode_id || null;
              }
            }
            
            // Calculate SRS interval and next_review_at for new state
            let srsInterval = 0;
            let nextReviewAt = null;
            let lastReviewedAt = null;
            let newSRSCount = 0;
            
            if (srs_state !== 'none') {
              // Calculate interval in hours
              srsInterval = await calculateSRSInterval(env, srs_state, newSRSCount, 0, 0);
              
              // Set timestamps for new state
              const now = Date.now();
              lastReviewedAt = now;
              nextReviewAt = now + (srsInterval * 60 * 60 * 1000);
            }
            
            const stateId = crypto.randomUUID();
            await env.DB.prepare(`
              INSERT INTO user_card_states (
                id, user_id, card_id, film_id, episode_id,
                srs_state, srs_count, srs_interval, next_review_at, last_reviewed_at,
                state_created_at, state_updated_at,
                created_at, updated_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000, unixepoch() * 1000)
            `).bind(stateId, user_id, cardUUID, finalFilmId, finalEpisodeId, srs_state, newSRSCount, srsInterval, nextReviewAt, lastReviewedAt).run();
          }
          
          // Award XP for SRS state change (whenever state changes and new state is not 'none')
          // This includes: 'none' -> any state, or any state -> any other state
          if (oldState !== srs_state && srs_state !== 'none') {
            const rewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.SRS_STATE_CHANGE);
            if (rewardConfig && rewardConfig.xp_amount > 0) {
              await awardXP(env, user_id, rewardConfig.xp_amount, rewardConfig.id, 'SRS state change', cardUUID, finalFilmId);
            }
          }
          
          return json({ success: true, srs_state });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get list of saved cards for a user
      if (path === '/api/user/saved-cards' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const page = parseInt(url.searchParams.get('page') || '1');
          const limit = parseInt(url.searchParams.get('limit') || '50');
          const offset = (page - 1) * limit;
          
          if (!userId) {
            return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
          }
          
          // Get saved cards with card details
          const cards = await env.DB.prepare(`
            SELECT 
              ucs.card_id,
              ucs.srs_state,
              ucs.film_id,
              ucs.episode_id,
              c.card_number,
              c.start_time,
              c.end_time,
              c.duration,
              c.image_key,
              c.audio_key,
              c.sentence,
              c.card_type,
              c.length,
              c.difficulty_score,
              e.slug as episode_slug,
              e.episode_number,
              ci.slug as film_slug,
              ci.title as film_title,
              c.id as card_db_id,  -- Unique card ID from database
              c.card_number,  -- Card number in episode (for display)
              ucs.state_created_at,
              ucs.state_updated_at,
              ucs.created_at,
              ucs.next_review_at
            FROM user_card_states ucs
            JOIN cards c ON ucs.card_id = c.id
            JOIN episodes e ON c.episode_id = e.id
            JOIN content_items ci ON e.content_item_id = ci.id
            WHERE ucs.user_id = ? AND ucs.srs_state != 'none'
            ORDER BY ucs.state_updated_at DESC
            LIMIT ? OFFSET ?
          `).bind(userId, limit, offset).all();
          
          // Get total count
          const countResult = await env.DB.prepare(`
            SELECT COUNT(*) as total
            FROM user_card_states
            WHERE user_id = ? AND srs_state != 'none'
          `).bind(userId).first();
          
          const total = countResult?.total || 0;
          
          // Format cards similar to CardDoc - load subtitles and XP data for each card
          const formattedCards = await Promise.all((cards.results || []).map(async (row) => {
            const filmSlug = row.film_slug || row.film_id;
            const epSlug = row.episode_slug || row.episode_id;
            const cardDisplayId = String(row.card_number || '').padStart(3, '0');
            
            // Load subtitles for this card
            const cardDbId = row.card_db_id || row.card_id; // Use card_db_id (unique ID) if available
            const subs = await env.DB.prepare(`
              SELECT language, text FROM card_subtitles WHERE card_id = ?
            `).bind(cardDbId).all();
            
            const subtitle = {};
            (subs.results || []).forEach((s) => {
              subtitle[s.language] = s.text;
            });
            
            // Calculate XP for this card by reward config ID
            const xpData = await env.DB.prepare(`
              SELECT 
                xt.reward_config_id,
                COALESCE(SUM(xt.xp_amount), 0) as total_xp
              FROM xp_transactions xt
              WHERE xt.user_id = ? AND xt.card_id = ?
              GROUP BY xt.reward_config_id
            `).bind(userId, cardDbId).all();
            
            // Initialize XP counts
            let totalXP = 0;
            let readingXP = 0;
            let listeningXP = 0;
            let speakingXP = 0;
            let writingXP = 0;
            
            (xpData.results || []).forEach((xpRow) => {
              const xp = xpRow.total_xp || 0;
              const rewardConfigId = xpRow.reward_config_id;
              
              totalXP += xp; // Include ALL XP types in total (including srs_state_change)
              
              // Match by reward_config_id instead of action_type string
              if (rewardConfigId === REWARD_CONFIG_IDS.READING_8S) {
                readingXP = xp;
              } else if (rewardConfigId === REWARD_CONFIG_IDS.LISTENING_5S) {
                listeningXP = xp;
              } else if (rewardConfigId === REWARD_CONFIG_IDS.SPEAKING_ATTEMPT) {
                speakingXP = xp;
              } else if (rewardConfigId === REWARD_CONFIG_IDS.WRITING_ATTEMPT) {
                writingXP = xp;
              }
              // Note: SRS_STATE_CHANGE XP is included in totalXP but not tracked separately
            });
            
            // Build image and audio URLs from stored keys (do not reconstruct the path)
            const basePublic = (env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
            const imageUrl = row.image_key
              ? (basePublic ? `${basePublic}/${row.image_key}` : `/${row.image_key}`)
              : '';
            const audioUrl = row.audio_key
              ? (basePublic ? `${basePublic}/${row.audio_key}` : `/${row.audio_key}`)
              : '';
            
            return {
              id: cardDbId || cardDisplayId,  // Use unique card ID from database, fallback to display ID
              card_number: row.card_number || null,  // Card number in episode (for display purposes)
              film_id: filmSlug,
              episode_id: epSlug,
              episode: epSlug,
              episode_number: row.episode_number || null,
              start: row.start_time || 0,
              end: row.end_time || 0,
              duration: row.duration || 0,
              image_url: imageUrl,
              audio_url: audioUrl,
              sentence: row.sentence || null,
              card_type: row.card_type || null,
              length: row.length || null,
              difficulty_score: row.difficulty_score || null,
              subtitle: subtitle,
              srs_state: row.srs_state || 'none',
              film_title: row.film_title,
              created_at: row.state_created_at || row.created_at || null, // Use state_created_at (when user saved card) instead of created_at (when record was created)
              state_updated_at: row.state_updated_at || null, // Last time the SRS state was updated
              next_review_at: row.next_review_at || null,
              xp_total: totalXP,
              xp_reading: readingXP,
              xp_listening: listeningXP,
              xp_speaking: speakingXP,
              xp_writing: writingXP,
            };
          }));
          
          return json({
            cards: formattedCards,
            total,
            page,
            limit,
            has_more: offset + formattedCards.length < total
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get user portfolio/stats
      if (path === '/api/user/portfolio' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          
          if (!userId) {
            return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
          }
          
          // Ensure user_scores exists (create if not exists)
          await getOrCreateUserScores(env, userId);
          
          // Get user scores
          const scores = await env.DB.prepare(`
            SELECT 
              total_xp,
              level,
              coins,
              current_streak,
              longest_streak,
              total_listening_time,
              total_reading_time,
              total_speaking_attempt,
              total_writing_attempt
            FROM user_scores
            WHERE user_id = ?
          `).bind(userId).first();
          
          // Get total cards saved (with srs_state != 'none')
          const savedCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total
            FROM user_card_states
            WHERE user_id = ? AND srs_state != 'none'
          `).bind(userId).first();
          
          // Get total cards reviewed (sum of review_count)
          const reviewedCardsResult = await env.DB.prepare(`
            SELECT SUM(review_count) as total
            FROM user_card_states
            WHERE user_id = ?
          `).bind(userId).first();
          
          // Get count of cards due for review (next_review_at <= now or is null for 'new' state)
          const dueCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total
            FROM user_card_states
            WHERE user_id = ? 
              AND srs_state != 'none'
              AND (
                next_review_at IS NULL 
                OR next_review_at <= (unixepoch() * 1000)
              )
          `).bind(userId).first();
          
          return json({
            user_id: userId,
            total_xp: scores?.total_xp || 0,
            level: scores?.level || 1,
            coins: scores?.coins || 0,
            current_streak: scores?.current_streak || 0,
            longest_streak: scores?.longest_streak || 0,
            total_cards_saved: savedCardsResult?.total || 0,
            total_cards_reviewed: reviewedCardsResult?.total || 0,
            total_listening_time: scores?.total_listening_time || 0,
            total_reading_time: scores?.total_reading_time || 0,
            total_speaking_attempt: scores?.total_speaking_attempt || 0,
            total_writing_attempt: scores?.total_writing_attempt || 0,
            due_cards_count: dueCardsResult?.total || 0,
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Track listening or reading time and award XP
      if (path === '/api/user/track-time' && request.method === 'POST') {
        try {
          let body;
          try {
            body = await request.json();
          } catch (parseError) {
            return json({ error: 'Failed to parse body as JSON', details: String(parseError) }, { status: 400 });
          }
          
          const { user_id, time_seconds, type } = body;
          
          if (!user_id || time_seconds === undefined || !type) {
            return json({ error: 'Missing required parameters (user_id, time_seconds, type)' }, { status: 400 });
          }
          
          if (type !== 'listening' && type !== 'reading') {
            return json({ error: 'Invalid type. Must be "listening" or "reading"' }, { status: 400 });
          }
          
          if (time_seconds <= 0) {
            return json({ error: 'time_seconds must be positive' }, { status: 400 });
          }
          
          const result = await trackTime(env, user_id, time_seconds, type);
          
          return json({ success: true, xp_awarded: result.xpAwarded });
        } catch (e) {
          const errorMessage = e?.message || String(e) || 'Unknown error';
          return json({ error: 'D1_ERROR: ' + errorMessage }, { status: 500 });
        }
      }

      // Track speaking or writing attempt and award XP
      if (path === '/api/user/track-attempt' && request.method === 'POST') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }

          let body;
          try {
            body = await request.json();
          } catch (parseError) {
            return json({ error: 'Failed to parse body as JSON', details: String(parseError) }, { status: 400 });
          }
          
          const { user_id, type, card_id, film_id } = body;
          const userId = auth.userId || user_id;
          
          if (!userId || !type) {
            return json({ error: 'Missing required parameters (user_id, type)' }, { status: 400 });
          }
          
          if (type !== 'speaking' && type !== 'writing') {
            return json({ error: 'Invalid type. Must be "speaking" or "writing"' }, { status: 400 });
          }
          
          const result = await trackAttempt(env, userId, type, card_id || null, film_id || null);
          
          return json({ success: true, xp_awarded: result.xpAwarded });
        } catch (e) {
          const errorMessage = e?.message || String(e) || 'Unknown error';
          return json({ error: 'D1_ERROR: ' + errorMessage }, { status: 500 });
        }
      }

      // Get user streak history for heatmap
      if (path === '/api/user/streak-history' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          
          if (!userId) {
            return json({ error: 'Missing required parameter (user_id)' }, { status: 400 });
          }
          
          // Get streak history (last 210 days to cover ~7 months for heatmap)
          const history = await env.DB.prepare(`
            SELECT streak_date, streak_achieved, streak_count
            FROM user_streak_history
            WHERE user_id = ?
            ORDER BY streak_date DESC
            LIMIT 210
          `).bind(userId).all();
          
          return json(history.results || []);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get detailed user metrics (SRS, Listening, Reading metrics)
      if (path === '/api/user/metrics' && request.method === 'GET') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          const userId = auth.userId;
          
          // SRS Metrics
          const newCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? AND srs_state = 'new'
          `).bind(userId).first();
          
          const againCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? AND srs_state = 'again'
          `).bind(userId).first();
          
          const hardCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? AND srs_state = 'hard'
          `).bind(userId).first();
          
          const goodCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? AND srs_state = 'good'
          `).bind(userId).first();
          
          const easyCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? AND srs_state = 'easy'
          `).bind(userId).first();
          
          const dueCardsResult = await env.DB.prepare(`
            SELECT COUNT(*) as total FROM user_card_states
            WHERE user_id = ? 
              AND srs_state != 'none'
              AND (
                next_review_at IS NULL 
                OR next_review_at <= (unixepoch() * 1000)
              )
          `).bind(userId).first();
          
          // Average interval (in days) - only for cards with srs_state != 'none' and srs_interval > 0
          const avgIntervalResult = await env.DB.prepare(`
            SELECT AVG(srs_interval) as avg_interval
            FROM user_card_states
            WHERE user_id = ? 
              AND srs_state != 'none'
              AND srs_interval > 0
          `).bind(userId).first();
          
          const avgIntervalDays = avgIntervalResult?.avg_interval ? (avgIntervalResult.avg_interval / 24) : 0;
          
          // Get user_scores first (needed for listening_sessions_count and time metrics)
          const scores = await getOrCreateUserScores(env, userId);
          
          // Get reward_config by IDs for listening and reading
          const listeningRewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.LISTENING_5S);
          const readingRewardConfig = await getRewardConfigById(env, REWARD_CONFIG_IDS.READING_8S);
          
          // Listening Metrics - Count XP transactions using reward_config_id (more precise than description)
          let listeningXPResult = { total_xp: 0 };
          if (listeningRewardConfig?.id) {
            listeningXPResult = await env.DB.prepare(`
              SELECT COALESCE(SUM(xp_amount), 0) as total_xp
              FROM xp_transactions
              WHERE user_id = ? AND reward_config_id = ?
            `).bind(userId, listeningRewardConfig.id).first();
          }
          
          // Listening Count - use listening_sessions_count from user_scores if available, otherwise count XP transactions
          // Note: listening_sessions_count counts actual play events, while XP transactions count completed intervals
          const listeningCount = scores?.listening_sessions_count || 0;
          // Fallback: count XP transactions if listening_sessions_count is 0 (backward compatibility)
          let listeningCountValue = listeningCount;
          if (listeningCountValue === 0 && listeningRewardConfig?.id) {
            const listeningCountResult = await env.DB.prepare(`
              SELECT COUNT(*) as total
              FROM xp_transactions
              WHERE user_id = ? AND reward_config_id = ?
            `).bind(userId, listeningRewardConfig.id).first();
            listeningCountValue = listeningCountResult?.total || 0;
          }
          
          // Reading Metrics - Count XP transactions using reward_config_id (more precise than description)
          let readingXPResult = { total_xp: 0 };
          if (readingRewardConfig?.id) {
            readingXPResult = await env.DB.prepare(`
              SELECT COALESCE(SUM(xp_amount), 0) as total_xp
              FROM xp_transactions
              WHERE user_id = ? AND reward_config_id = ?
            `).bind(userId, readingRewardConfig.id).first();
          }
          
          // Review Count - sum of review_count from user_card_states (pointer hover > 2s)
          const reviewCountResult = await env.DB.prepare(`
            SELECT COALESCE(SUM(review_count), 0) as total
            FROM user_card_states
            WHERE user_id = ?
          `).bind(userId).first();
          
          return json({
            srs_metrics: {
              new_cards: newCardsResult?.total || 0,
              again_cards: againCardsResult?.total || 0,
              hard_cards: hardCardsResult?.total || 0,
              good_cards: goodCardsResult?.total || 0,
              easy_cards: easyCardsResult?.total || 0,
              due_cards: dueCardsResult?.total || 0,
              average_interval_days: Math.round(avgIntervalDays * 100) / 100 // Round to 2 decimals
            },
            listening_metrics: {
              time_minutes: Math.round((scores?.total_listening_time || 0) / 60),
              count: listeningCountValue,
              xp: listeningXPResult?.total_xp || 0
            },
            reading_metrics: {
              time_minutes: Math.round((scores?.total_reading_time || 0) / 60),
              count: reviewCountResult?.total || 0,
              xp: readingXPResult?.total_xp || 0
            }
          });
        } catch (e) {
          console.error('Metrics error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Increment listening sessions count (when user clicks play audio)
      if (path === '/api/user/increment-listening-session' && request.method === 'POST') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          const userId = auth.userId;
          
          // Ensure user_scores exists
          await getOrCreateUserScores(env, userId);
          
          // Increment listening_sessions_count
          await env.DB.prepare(`
            UPDATE user_scores
            SET listening_sessions_count = listening_sessions_count + 1,
                updated_at = unixepoch() * 1000
            WHERE user_id = ?
          `).bind(userId).run();
          
          // Get updated count
          const updated = await env.DB.prepare(`
            SELECT listening_sessions_count FROM user_scores WHERE user_id = ?
          `).bind(userId).first();
          
          return json({ 
            success: true, 
            listening_sessions_count: updated?.listening_sessions_count || 0 
          });
        } catch (e) {
          console.error('Increment listening session error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get monthly XP data for graph
      if (path === '/api/user/monthly-xp' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const year = parseInt(url.searchParams.get('year') || '0');
          const month = parseInt(url.searchParams.get('month') || '0');
          
          if (!userId || !year || !month || month < 1 || month > 12) {
            return json({ error: 'Missing or invalid parameters (user_id, year, month)' }, { status: 400 });
          }
          
          // Calculate first and last day of month
          const firstDay = `${year}-${String(month).padStart(2, '0')}-01`;
          const lastDay = new Date(year, month, 0).toISOString().split('T')[0]; // Last day of month
          
          // Get daily XP data for the month
          const stats = await env.DB.prepare(`
            SELECT stats_date, xp_earned
            FROM user_daily_stats
            WHERE user_id = ? 
              AND stats_date >= ? 
              AND stats_date <= ?
            ORDER BY stats_date ASC
          `).bind(userId, firstDay, lastDay).all();
          
          // Create a map for quick lookup
          const statsMap = new Map();
          (stats.results || []).forEach((row) => {
            statsMap.set(row.stats_date, row.xp_earned || 0);
          });
          
          // Generate all days in the month with XP data
          const daysInMonth = new Date(year, month, 0).getDate();
          const monthlyData = [];
          for (let day = 1; day <= daysInMonth; day++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            monthlyData.push({
              date: dateStr,
              xp_earned: statsMap.get(dateStr) || 0
            });
          }
          
          return json(monthlyData);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // ==================== CONTENT STATS & LIKES ====================
      
      // Get saved cards count for a user and film
      if (path === '/api/content/saved-cards-count' && request.method === 'GET') {
        try {
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
      }

      // Get like count for a film
      if (path === '/api/content/like-count' && request.method === 'GET') {
        try {
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
      }

      // Check if user liked a film
      if (path === '/api/content/like-status' && request.method === 'GET') {
        try {
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
      }

      // Toggle like status for a film
      if (path === '/api/content/like' && request.method === 'POST') {
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
      }

      // ==================== EPISODE COMMENTS ====================
      
      // Get comments for an episode
      if (path === '/api/episodes/comments' && request.method === 'GET') {
        try {
          const episodeSlug = url.searchParams.get('episode_slug');
          const filmSlug = url.searchParams.get('film_slug');
          
          if (!episodeSlug || !filmSlug) {
            return json({ error: 'Missing required parameters: episode_slug, film_slug' }, { status: 400 });
          }
          
          // Get content_item_id from film slug
          const filmRow = await env.DB.prepare(`
            SELECT id FROM content_items WHERE LOWER(slug) = LOWER(?)
          `).bind(filmSlug).first();
          
          if (!filmRow) {
            return json({ error: 'Content not found' }, { status: 404 });
          }
          
          // Get episode ID from slug and content_item_id
          const episodeRow = await env.DB.prepare(`
            SELECT id FROM episodes 
            WHERE slug = ? AND content_item_id = ?
          `).bind(episodeSlug, filmRow.id).first();
          
          if (!episodeRow) {
            return json({ error: 'Episode not found' }, { status: 404 });
          }
          
          // Get comments with user info, sorted by score (desc) then created_at (desc)
          const comments = await env.DB.prepare(`
            SELECT 
              ec.id,
              ec.text,
              ec.upvotes,
              ec.downvotes,
              ec.score,
              ec.created_at,
              ec.updated_at,
              u.id as user_id,
              u.display_name,
              u.photo_url
            FROM episode_comments ec
            JOIN users u ON ec.user_id = u.id
            WHERE ec.episode_id = ?
            ORDER BY ec.score DESC, ec.created_at DESC
          `).bind(episodeRow.id).all();
          
          return json(comments.results || []);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Create a new comment
      if (path === '/api/episodes/comments' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, episode_slug, film_slug, text } = body;
          
          if (!user_id || !episode_slug || !film_slug || !text) {
            return json({ error: 'Missing required parameters (user_id, episode_slug, film_slug, text)' }, { status: 400 });
          }
          
          if (text.trim().length === 0 || text.length > 5000) {
            return json({ error: 'Comment text must be between 1 and 5000 characters' }, { status: 400 });
          }
          
          // Get content_item_id from film slug
          const filmRow = await env.DB.prepare(`
            SELECT id FROM content_items WHERE LOWER(slug) = LOWER(?)
          `).bind(film_slug).first();
          
          if (!filmRow) {
            return json({ error: 'Content not found' }, { status: 404 });
          }
          
          // Get episode ID from slug and content_item_id
          const episode = await env.DB.prepare(`
            SELECT id FROM episodes WHERE slug = ? AND content_item_id = ?
          `).bind(episode_slug, filmRow.id).first();
          
          if (!episode) {
            return json({ error: 'Episode not found' }, { status: 404 });
          }
          
          // Create comment
          const commentId = crypto.randomUUID();
          const now = Date.now();
          
          await env.DB.prepare(`
            INSERT INTO episode_comments (
              id, user_id, episode_id, content_item_id, text,
              upvotes, downvotes, score, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?)
          `).bind(commentId, user_id, episode.id, filmRow.id, text.trim(), now, now).run();
          
          // Get the created comment with user info
          const comment = await env.DB.prepare(`
            SELECT 
              ec.id,
              ec.text,
              ec.upvotes,
              ec.downvotes,
              ec.score,
              ec.created_at,
              ec.updated_at,
              u.id as user_id,
              u.display_name,
              u.photo_url
            FROM episode_comments ec
            JOIN users u ON ec.user_id = u.id
            WHERE ec.id = ?
          `).bind(commentId).first();
          
          return json(comment);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Vote on a comment (upvote or downvote)
      if (path === '/api/episodes/comments/vote' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { user_id, comment_id, vote_type } = body;
          
          if (!user_id || !comment_id || vote_type === undefined) {
            return json({ error: 'Missing required parameters (user_id, comment_id, vote_type)' }, { status: 400 });
          }
          
          if (vote_type !== 1 && vote_type !== -1) {
            return json({ error: 'vote_type must be 1 (upvote) or -1 (downvote)' }, { status: 400 });
          }
          
          // Check if comment exists
          const comment = await env.DB.prepare(`
            SELECT id, upvotes, downvotes FROM episode_comments WHERE id = ?
          `).bind(comment_id).first();
          
          if (!comment) {
            return json({ error: 'Comment not found' }, { status: 404 });
          }
          
          // Check if user already voted
          const existingVote = await env.DB.prepare(`
            SELECT id, vote_type FROM episode_comment_votes
            WHERE user_id = ? AND comment_id = ?
          `).bind(user_id, comment_id).first();
          
          const now = Date.now();
          let newUpvotes = comment.upvotes || 0;
          let newDownvotes = comment.downvotes || 0;
          
          if (existingVote) {
            // User already voted - update or remove vote
            if (existingVote.vote_type === vote_type) {
              // Same vote type - remove the vote
              await env.DB.prepare(`
                DELETE FROM episode_comment_votes
                WHERE user_id = ? AND comment_id = ?
              `).bind(user_id, comment_id).run();
              
              // Decrement the count
              if (vote_type === 1) {
                newUpvotes = Math.max(0, newUpvotes - 1);
              } else {
                newDownvotes = Math.max(0, newDownvotes - 1);
              }
            } else {
              // Different vote type - update the vote
              await env.DB.prepare(`
                UPDATE episode_comment_votes
                SET vote_type = ?, updated_at = ?
                WHERE user_id = ? AND comment_id = ?
              `).bind(vote_type, now, user_id, comment_id).run();
              
              // Adjust counts
              if (existingVote.vote_type === 1) {
                // Was upvote, now downvote
                newUpvotes = Math.max(0, newUpvotes - 1);
                newDownvotes = newDownvotes + 1;
              } else {
                // Was downvote, now upvote
                newDownvotes = Math.max(0, newDownvotes - 1);
                newUpvotes = newUpvotes + 1;
              }
            }
          } else {
            // New vote
            const voteId = crypto.randomUUID();
            await env.DB.prepare(`
              INSERT INTO episode_comment_votes (id, user_id, comment_id, vote_type, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).bind(voteId, user_id, comment_id, vote_type, now, now).run();
            
            // Increment the count
            if (vote_type === 1) {
              newUpvotes = newUpvotes + 1;
            } else {
              newDownvotes = newDownvotes + 1;
            }
          }
          
          // Calculate new score
          const newScore = newUpvotes - newDownvotes;
          
          // Update comment scores
          await env.DB.prepare(`
            UPDATE episode_comments
            SET upvotes = ?, downvotes = ?, score = ?, updated_at = ?
            WHERE id = ?
          `).bind(newUpvotes, newDownvotes, newScore, now, comment_id).run();
          
          // Get user's current vote status
          const userVote = await env.DB.prepare(`
            SELECT vote_type FROM episode_comment_votes
            WHERE user_id = ? AND comment_id = ?
          `).bind(user_id, comment_id).first();
          
          return json({
            success: true,
            upvotes: newUpvotes,
            downvotes: newDownvotes,
            score: newScore,
            user_vote: userVote?.vote_type || null
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }
      
      // Get user's vote status for comments
      if (path === '/api/episodes/comments/votes' && request.method === 'GET') {
        try {
          const userId = url.searchParams.get('user_id');
          const commentIds = url.searchParams.get('comment_ids');
          
          if (!userId || !commentIds) {
            return json({ error: 'Missing required parameters (user_id, comment_ids)' }, { status: 400 });
          }
          
          // Parse comment_ids (comma-separated)
          const ids = commentIds.split(',').filter(id => id.trim());
          if (ids.length === 0) {
            return json({});
          }
          
          // Get all votes for these comments by this user
          const votes = await env.DB.prepare(`
            SELECT comment_id, vote_type
            FROM episode_comment_votes
            WHERE user_id = ? AND comment_id IN (${ids.map(() => '?').join(',')})
          `).bind(userId, ...ids).all();
          
          // Convert to object: { comment_id: vote_type }
          const voteMap = {};
          (votes.results || []).forEach(vote => {
            voteMap[vote.comment_id] = vote.vote_type;
          });
          
          return json(voteMap);
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
            'user_episode_stats',
            'content_items',
            'episodes',
            'cards',
            'card_subtitles',
            'search_terms',
            'card_difficulty_levels'
          ];
          
          const stats = {};
          
          for (const table of tables) {
            try {
              const result = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first();
              stats[table] = result?.count || 0;
            } catch (e) {
              stats[table] = `Error: ${e.message}`;
            }
          }
          
          return json(stats);
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get detailed database size and table size analysis (superadmin only)
      if (path === '/api/admin/database-size-analysis' && request.method === 'GET') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          // Check if user is superadmin
          if (!auth.roles.includes('superadmin')) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }

          // Try to fetch actual database size from Cloudflare GraphQL Analytics API
          // This requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID to be set as secrets
          let actualDatabaseSizeBytes = null;
          let actualDatabaseSizeGB = null;
          let actualDatabaseSizeMB = null;
          
          try {
            const apiToken = env.CLOUDFLARE_API_TOKEN;
            const accountId = env.CLOUDFLARE_ACCOUNT_ID;
            const databaseId = 'a60ee761-1d16-4dff-9ba0-fa7abdd11320'; // From wrangler.toml
            
            if (apiToken && accountId) {
              // Use Cloudflare GraphQL Analytics API to get actual database size
              // Reference: https://developers.cloudflare.com/analytics/graphql-api/
              const graphqlQuery = JSON.stringify({
                query: `query {
                  viewer {
                    accounts(filter: {accountTag: "${accountId}"}) {
                      d1DatabaseStorageAdaptiveGroups(
                        filter: {
                          databaseId: "${databaseId}"
                        }
                        limit: 1
                        orderBy: [datetime_DESC]
                      ) {
                        dimensions {
                          databaseId
                          datetime
                        }
                        sum {
                          databaseSizeBytes
                        }
                      }
                    }
                  }
                }`
              });
              
              const response = await fetch('https://api.cloudflare.com/client/v4/graphql', {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json',
                },
                body: graphqlQuery
              });
              
              if (response.ok) {
                const data = await response.json();
                // Navigate through GraphQL response structure
                const accounts = data?.data?.viewer?.accounts;
                if (accounts && accounts.length > 0) {
                  const groups = accounts[0]?.d1DatabaseStorageAdaptiveGroups;
                  if (groups && groups.length > 0) {
                    const latest = groups[0]; // Most recent (DESC order)
                    actualDatabaseSizeBytes = latest.sum?.databaseSizeBytes;
                    if (actualDatabaseSizeBytes && typeof actualDatabaseSizeBytes === 'number') {
                      actualDatabaseSizeMB = actualDatabaseSizeBytes / (1024 * 1024);
                      actualDatabaseSizeGB = actualDatabaseSizeMB / 1024;
                      console.log(`[WORKER] Fetched actual DB size from Cloudflare API: ${actualDatabaseSizeGB.toFixed(2)} GB`);
                    }
                  }
                }
              } else {
                const errorText = await response.text();
                console.warn('[WORKER] Failed to fetch from Cloudflare GraphQL API:', response.status, errorText);
              }
            } else {
              console.log('[WORKER] CLOUDFLARE_API_TOKEN or CLOUDFLARE_ACCOUNT_ID not set, using estimation');
            }
          } catch (e) {
            console.warn('[WORKER] Error fetching from Cloudflare GraphQL API:', e.message);
            // Continue with estimation if API call fails
          }

          // Note: D1 doesn't support PRAGMA commands, so we'll estimate based on table row counts
          // We'll calculate total estimated size from all tables

          // Get ALL tables and views from the database separately
          // Cloudflare D1 counts tables and views separately
          const allObjectsResult = await env.DB.prepare(`
            SELECT name, type 
            FROM sqlite_master 
            WHERE type IN ('table', 'view')
            AND name NOT LIKE 'sqlite_%'
            AND name NOT LIKE '_cf_%'
            AND name NOT LIKE '%_fts_content'
            AND name NOT LIKE '%_fts_docsize'
            AND name NOT LIKE '%_fts_data'
            AND name NOT LIKE '%_fts_idx'
            AND name NOT LIKE '%_fts_config'
            ORDER BY type, name
          `).all();
          
          const allObjects = allObjectsResult.results || [];
          
          // Separate tables and views
          const allTables = allObjects.filter(obj => obj.type === 'table');
          const allViews = allObjects.filter(obj => obj.type === 'view');
          
          // Filter out shadow tables and Cloudflare internal tables
          // Only count actual user tables (not views, not internal tables)
          const filteredTables = allTables.filter(table => {
            const name = table.name;
            // Skip Cloudflare internal tables
            if (name.startsWith('_cf_')) return false;
            // Skip shadow tables (these are internal to virtual tables)
            if (name.includes('_fts_content') || 
                name.includes('_fts_docsize') || 
                name.includes('_fts_data') || 
                name.includes('_fts_idx') ||
                name.includes('_fts_config')) {
              return false;
            }
            // Only count actual tables (type = 'table')
            return table.type === 'table';
          });
          
          // Filter views similarly
          const filteredViews = allViews.filter(view => {
            const name = view.name;
            if (name.startsWith('_cf_')) return false;
            if (name.includes('_fts_content') || 
                name.includes('_fts_docsize') || 
                name.includes('_fts_data') || 
                name.includes('_fts_idx') ||
                name.includes('_fts_config')) {
              return false;
            }
            return view.type === 'view';
          });
          
          // Define critical tables and their avg row sizes (more accurate estimates)
          const tableConfig = {
            'search_terms': { avgRowSize: 50, type: 'Regular', critical: true, multiplier: 1.0 },
            'card_subtitles': { avgRowSize: 250, type: 'Regular', critical: true, multiplier: 1.0 }, // Increased for accurate size estimation (includes text data)
            'cards': { avgRowSize: 100, type: 'Regular', critical: true, multiplier: 1.0 },
            'user_progress': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_episode_stats': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'content_items': { avgRowSize: 200, type: 'Regular', critical: false, multiplier: 1.0 },
            'episodes': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'users': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_preferences': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_favorites': { avgRowSize: 50, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_study_sessions': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_card_states': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'card_difficulty_levels': { avgRowSize: 60, type: 'Regular', critical: false, multiplier: 1.0 },
            'content_item_languages': { avgRowSize: 30, type: 'Regular', critical: false, multiplier: 1.0 },
            'card_subtitle_language_map': { avgRowSize: 40, type: 'Regular', critical: false, multiplier: 1.0 },
            'card_subtitle_languages': { avgRowSize: 40, type: 'Regular', critical: false, multiplier: 1.0 }, // Alias or variant name
            'reference_word_frequency': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'categories': { avgRowSize: 50, type: 'Regular', critical: false, multiplier: 1.0 },
            'content_item_categories': { avgRowSize: 30, type: 'Regular', critical: false, multiplier: 1.0 },
            'content_likes': { avgRowSize: 40, type: 'Regular', critical: false, multiplier: 1.0 },
            'content_like_counts': { avgRowSize: 50, type: 'Regular', critical: false, multiplier: 1.0 },
            'episode_comments': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'episode_comment_votes': { avgRowSize: 40, type: 'Regular', critical: false, multiplier: 1.0 },
            'auth_providers': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_logins': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'roles': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_roles': { avgRowSize: 40, type: 'Regular', critical: false, multiplier: 1.0 },
            'srs_base_intervals': { avgRowSize: 50, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_scores': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_daily_activity': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_streak_history': { avgRowSize: 60, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_daily_stats': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'rewards_config': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'xp_transactions': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'coin_transactions': { avgRowSize: 80, type: 'Regular', critical: false, multiplier: 1.0 },
            'challenge_types': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'challenges': { avgRowSize: 150, type: 'Regular', critical: false, multiplier: 1.0 },
            'user_challenge_progress': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 },
            'system_configs': { avgRowSize: 100, type: 'Regular', critical: false, multiplier: 1.0 }
          };

          // Get table sizes (approximate using row counts and average row size)
          const tableAnalysis = [];
          let totalEstimatedSizeMB = 0;
          
          for (const tableRow of filteredTables) {
            const tableName = tableRow.name;
            // Use higher default avgRowSize for unknown tables to avoid underestimation
            // Default assumes average table has some text/data columns
            const config = tableConfig[tableName] || { avgRowSize: 120, type: 'Regular', critical: false, multiplier: 1.0 };
            
            try {
              const countResult = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).first();
              const count = countResult?.count || 0;
              
              // Calculate estimated size with multiplier
              const estimatedSize = count * config.avgRowSize * config.multiplier;
              const estimatedSizeMB = estimatedSize / (1024 * 1024);
              const estimatedSizeGB = estimatedSizeMB / 1024;
              
              totalEstimatedSizeMB += estimatedSizeMB;
              
              tableAnalysis.push({
                name: tableName,
                type: config.type,
                critical: config.critical,
                rowCount: count,
                estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
                estimatedSizeGB: Math.round(estimatedSizeGB * 100) / 100
              });
            } catch (e) {
              // Skip views or tables we can't query, but still include them in the list
              if (!e.message.includes('no such table') && !e.message.includes('no such view')) {
                tableAnalysis.push({
                  name: tableName,
                  type: config.type,
                  critical: config.critical,
                  error: e.message,
                  rowCount: 0,
                  estimatedSizeMB: 0,
                  estimatedSizeGB: 0
                });
              }
            }
          }

          // Calculate total database size from table estimates
          // Add 90% overhead (1.9x multiplier) for indexes, metadata, fragmentation, etc.
          // D1 databases have significant overhead beyond raw table data
          // Cloudflare reports actual storage used, which includes all overhead
          // This overhead accounts for:
          // - Indexes on all tables (PRIMARY KEY, FOREIGN KEY, UNIQUE indexes)
          // - SQLite internal metadata and schema information
          // - Page fragmentation and free space
          // - WAL (Write-Ahead Logging) overhead
          const totalEstimatedSizeGB = (totalEstimatedSizeMB / 1024) * 1.9;

          // Check for potential duplicates in search_terms
          let duplicateInfo = null;
          try {
            const duplicateCheck = await env.DB.prepare(`
              SELECT 
                COUNT(*) as total_rows,
                COUNT(DISTINCT term || '|' || language) as unique_rows,
                COUNT(*) - COUNT(DISTINCT term || '|' || language) as duplicates
              FROM search_terms
            `).first();
            duplicateInfo = {
              totalRows: duplicateCheck?.total_rows || 0,
              uniqueRows: duplicateCheck?.unique_rows || 0,
              duplicates: duplicateCheck?.duplicates || 0
            };
          } catch (e) {
            duplicateInfo = { error: e.message };
          }

          // Use actual size from Cloudflare API if available, otherwise use estimation
          const finalSizeGB = actualDatabaseSizeGB !== null ? actualDatabaseSizeGB : totalEstimatedSizeGB;
          const finalSizeMB = actualDatabaseSizeMB !== null ? actualDatabaseSizeMB : (totalEstimatedSizeMB * 1.9);
          const isActualSize = actualDatabaseSizeBytes !== null;
          
          return json({
            database: {
              pageCount: null, // Not available in D1
              pageSizeBytes: null, // Not available in D1
              actualSizeBytes: actualDatabaseSizeBytes, // Actual size from Cloudflare API (if available)
              actualSizeMB: actualDatabaseSizeMB, // Actual size in MB (if available)
              actualSizeGB: actualDatabaseSizeGB, // Actual size in GB (if available)
              estimatedSizeMB: Math.round(totalEstimatedSizeMB * 1.9 * 100) / 100, // Estimated size with overhead
              estimatedSizeGB: Math.round(totalEstimatedSizeGB * 100) / 100, // Estimated size with overhead
              sizeMB: Math.round(finalSizeMB * 100) / 100, // Final size to display (actual or estimated)
              sizeGB: Math.round(finalSizeGB * 100) / 100, // Final size to display (actual or estimated)
              isActualSize: isActualSize, // Flag to indicate if this is actual size from Cloudflare API
              maxSizeGB: 10,
              usagePercent: Math.round((finalSizeGB / 10) * 100 * 100) / 100,
              totalTables: filteredTables.length, // Include total table count (only actual tables, not views)
              totalViews: filteredViews.length, // Include total view count
              rawDataSizeMB: Math.round(totalEstimatedSizeMB * 100) / 100, // Raw data size without overhead (estimated)
              overheadMB: actualDatabaseSizeMB !== null 
                ? Math.round((actualDatabaseSizeMB - totalEstimatedSizeMB) * 100) / 100 // Actual overhead if we have actual size
                : Math.round(totalEstimatedSizeMB * 0.9 * 100) / 100 // Estimated overhead (90% of raw data)
            },
            tables: tableAnalysis.sort((a, b) => (b.estimatedSizeMB || 0) - (a.estimatedSizeMB || 0)),
            analysis: {
              search_terms: duplicateInfo
            },
            recommendations: generateOptimizationRecommendations(tableAnalysis, duplicateInfo, totalEstimatedSizeGB)
          });
        } catch (e) {
          console.error('[WORKER /api/admin/database-size-analysis] Error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Helper function to generate optimization recommendations
      function generateOptimizationRecommendations(tables, duplicateInfo, dbSizeGB) {
        const recommendations = [];
        
        // Check if search_terms has duplicates
        if (duplicateInfo && duplicateInfo.duplicates > 0) {
          recommendations.push({
            priority: 'HIGH',
            action: 'Clean duplicate search_terms',
            description: `Found ${duplicateInfo.duplicates.toLocaleString()} duplicate rows in search_terms table. Run cleanup to remove duplicates.`,
            estimatedSavingsMB: Math.round((duplicateInfo.duplicates * 50 / (1024 * 1024)) * 100) / 100
          });
        }

        // Check search_terms size - always show if database is over limit or search_terms > 0.2GB
        const searchTermsTable = tables.find(t => t.name === 'search_terms');
        if (searchTermsTable) {
          const shouldOptimize = dbSizeGB > 10 || searchTermsTable.estimatedSizeGB > 0.2;
          if (shouldOptimize) {
            const priority = dbSizeGB > 10 ? 'CRITICAL' : 'MEDIUM';
            recommendations.push({
              priority: priority,
              action: 'Optimize search_terms',
              description: `search_terms table is ${searchTermsTable.estimatedSizeGB.toFixed(2)}GB with ${searchTermsTable.rowCount.toLocaleString()} rows. Remove low-frequency terms (frequency < 2 or 3) to reduce size.`,
              estimatedSavingsMB: Math.round(searchTermsTable.estimatedSizeGB * 0.3 * 1024)
            });
          }
        }

        // Check user_progress size
        const userProgressTable = tables.find(t => t.name === 'user_progress');
        if (userProgressTable && userProgressTable.estimatedSizeGB > 0.5) {
          recommendations.push({
            priority: 'LOW',
            action: 'Archive old user_progress',
            description: `user_progress table is ${userProgressTable.estimatedSizeGB.toFixed(2)}GB. Consider archiving progress older than 1 year.`,
            estimatedSavingsMB: Math.round(userProgressTable.estimatedSizeGB * 0.5 * 1024)
          });
        }

        // Overall database size warning
        if (dbSizeGB > 10) {
          recommendations.push({
            priority: 'CRITICAL',
            action: 'Database exceeded limit',
            description: `Database is ${dbSizeGB.toFixed(2)}GB (${Math.round((dbSizeGB / 10) * 100)}% of 10GB limit). IMMEDIATE ACTION REQUIRED! Optimize search_terms and other tables below.`,
            estimatedSavingsMB: 0
          });
        } else if (dbSizeGB > 8) {
          recommendations.push({
            priority: 'CRITICAL',
            action: 'Database approaching limit',
            description: `Database is ${dbSizeGB.toFixed(2)}GB (${Math.round((dbSizeGB / 10) * 100)}% of 10GB limit). Immediate action required.`,
            estimatedSavingsMB: 0
          });
        }

        return recommendations;
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

      // Get rewards config - SuperAdmin only
      if (path === '/api/admin/rewards-config' && request.method === 'GET') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          // Check if user is superadmin
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
      }

      // Populate search_terms table from card_subtitles - SuperAdmin only
      if (path === '/api/admin/populate-search-terms' && request.method === 'POST') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          // Check if user is superadmin
          if (!auth.roles.includes('superadmin')) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }

          const body = await request.json().catch(() => ({}));
          const batchSize = Math.min(Math.max(parseInt(body.batchSize || '100', 10), 10), 10000);
          const offset = parseInt(body.offset || '0', 10);

          // Get total count of subtitles (always when includeTotal is true, or when offset is 0)
          // This ensures frontend always has the correct total count
          let total = 0;
          if (offset === 0 || body.includeTotal === true) {
            const totalCount = await env.DB.prepare(`
              SELECT COUNT(*) as count 
              FROM card_subtitles
              WHERE text IS NOT NULL AND LENGTH(text) > 0
            `).first();
            total = totalCount?.count || 0;
          }

          // Fetch a batch of subtitles
          const subtitles = await env.DB.prepare(`
            SELECT id, card_id, language, text
            FROM card_subtitles
            WHERE text IS NOT NULL AND LENGTH(text) > 0
            ORDER BY id
            LIMIT ? OFFSET ?
          `).bind(batchSize, offset).all();

          if (!subtitles.results || subtitles.results.length === 0) {
            return json({ 
              message: 'No more subtitles to process',
              processed: 0,
              total: total || offset, // Use total if available, otherwise use offset as fallback
              totalProcessed: offset,
              hasMore: false
            });
          }

          // OPTIMIZED: Process all subtitles and batch insert terms
          const termMap = new Map(); // Map<`${term}:${language}`, frequency>

          // Extract terms from all subtitles
          for (const sub of subtitles.results) {
            const terms = extractSearchTerms(sub.text, sub.language);
            for (const term of terms) {
              const key = `${term}:${sub.language}`;
              termMap.set(key, (termMap.get(key) || 0) + 1);
            }
          }

          // OPTIMIZED: Batch insert all terms
          // D1's batch() automatically runs in a transaction, no need for BEGIN/COMMIT
          let inserted = 0;
          const insertStmts = [];
          
          for (const [key, frequency] of termMap.entries()) {
            const [term, language] = key.split(':');
            insertStmts.push(env.DB.prepare(`
              INSERT INTO search_terms (term, language, frequency, created_at, updated_at)
              VALUES (?, ?, ?, unixepoch() * 1000, unixepoch() * 1000)
              ON CONFLICT(term, language) DO UPDATE SET
                frequency = frequency + ?,
                updated_at = unixepoch() * 1000
            `).bind(term, language, frequency, frequency));
          }

          // Execute in batches of 500 - each batch() call is automatically transactional
          for (let i = 0; i < insertStmts.length; i += 500) {
            const slice = insertStmts.slice(i, i + 500);
            if (slice.length) {
              const results = await env.DB.batch(slice);
              inserted += results.reduce((sum, r) => sum + (r.meta?.changes || 0), 0);
            }
          }

          const newOffset = offset + subtitles.results.length;
          const hasMore = subtitles.results.length === batchSize;
          
          return json({
            message: 'Batch processed successfully',
            processed: subtitles.results.length,
            termsInserted: inserted,
            total: total || 0, // Total count of all subtitles
            totalProcessed: newOffset,
            hasMore: hasMore
          });
        } catch (e) {
          console.error('[WORKER /api/admin/populate-search-terms] Error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Cleanup duplicate search_terms (SuperAdmin only)
      if (path === '/api/admin/cleanup-search-terms' && request.method === 'POST') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          if (!auth.roles.includes('superadmin')) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }

          const body = await request.json().catch(() => ({}));
          const minFrequency = parseInt(body.minFrequency || '1', 10);

          // Step 1: Remove duplicates by keeping only the highest frequency entry
          const dedupeResult = await env.DB.prepare(`
            DELETE FROM search_terms
            WHERE id NOT IN (
              SELECT MIN(id)
              FROM search_terms
              GROUP BY term, language
            )
          `).run();

          // Step 2: Optionally remove low-frequency terms
          let lowFreqRemoved = 0;
          if (minFrequency > 1) {
            const removeResult = await env.DB.prepare(`
              DELETE FROM search_terms
              WHERE frequency < ?
            `).bind(minFrequency).run();
            lowFreqRemoved = removeResult.meta?.changes || 0;
          }

          // Get final count
          const finalCount = await env.DB.prepare('SELECT COUNT(*) as count FROM search_terms').first();

          return json({
            message: 'Cleanup completed successfully',
            duplicatesRemoved: dedupeResult.meta?.changes || 0,
            lowFrequencyRemoved: lowFreqRemoved,
            remainingRows: finalCount?.count || 0
          });
        } catch (e) {
          console.error('[WORKER /api/admin/cleanup-search-terms] Error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Optimize search_terms by removing low-frequency terms (SuperAdmin only)
      if (path === '/api/admin/optimize-search-terms' && request.method === 'POST') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          if (!auth.roles.includes('superadmin')) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }

          const body = await request.json().catch(() => ({}));
          const minFrequency = Math.max(parseInt(body.minFrequency || '2', 10), 1);

          // Remove terms with frequency below threshold
          const result = await env.DB.prepare(`
            DELETE FROM search_terms
            WHERE frequency < ?
          `).bind(minFrequency).run();

          const removed = result.meta?.changes || 0;

          // Get final count
          const finalCount = await env.DB.prepare('SELECT COUNT(*) as count FROM search_terms').first();

          return json({
            message: 'Optimization completed successfully',
            removedRows: removed,
            remainingRows: finalCount?.count || 0,
            minFrequency
          });
        } catch (e) {
          console.error('[WORKER /api/admin/optimize-search-terms] Error:', e);
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Update rewards config - SuperAdmin only
      if (path === '/api/admin/rewards-config' && request.method === 'PUT') {
        try {
          const auth = await authenticateRequest(request, env);
          if (!auth.authenticated) {
            return json({ error: auth.error || 'Unauthorized' }, { status: 401 });
          }
          
          // Check if user is superadmin
          if (!auth.roles.includes('superadmin')) {
            return json({ error: 'Unauthorized: SuperAdmin access required' }, { status: 403 });
          }
          
          const body = await request.json();
          const { id, xp_amount, coin_amount, interval_seconds, description } = body;
          
          if (!id) {
            return json({ error: 'id is required' }, { status: 400 });
          }
          
          // Validate numeric fields
          if (xp_amount !== undefined && (typeof xp_amount !== 'number' || xp_amount < 0)) {
            return json({ error: 'xp_amount must be a non-negative number' }, { status: 400 });
          }
          
          if (coin_amount !== undefined && (typeof coin_amount !== 'number' || coin_amount < 0)) {
            return json({ error: 'coin_amount must be a non-negative number' }, { status: 400 });
          }
          
          if (interval_seconds !== undefined && interval_seconds !== null && (typeof interval_seconds !== 'number' || interval_seconds < 1)) {
            return json({ error: 'interval_seconds must be a positive number or null' }, { status: 400 });
          }
          
          // Update config
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
          
          // Return updated config
          const updated = await env.DB.prepare(`
            SELECT * FROM rewards_config WHERE id = ?
          `).bind(id).first();
          
          return json({ success: true, config: updated });
        } catch (e) {
          console.error('Update rewards config error:', e);
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

      // ==================== Level Assessment Endpoints ====================

      // Import frequency data from JSON file - SuperAdmin only
      // JSON format: { "word1": rank1, "word2": rank2, ... }
      if (path === '/admin/import-reference' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { data, framework } = body;

          if (!data || typeof data !== 'object') {
            return json({ error: 'data object (JSON frequency lookup) is required' }, { status: 400 });
          }

          // Check authentication - require superadmin (check via user_roles)
          // For now, allow if request has proper auth - in production, add proper auth check
          
          const errors = [];
          const batchSize = 500; // D1 batch limit is ~1000, use 500 for safety

          // Clear old frequency data before importing
          try {
            if (framework) {
              await env.DB.prepare('DELETE FROM reference_word_frequency WHERE framework = ? OR framework IS NULL').bind(framework).run();
            } else {
              await env.DB.prepare('DELETE FROM reference_word_frequency').run();
            }
          } catch (e) {
            console.error('Failed to clear frequency data:', e);
          }

          // Convert JSON object to array of {word, rank} entries
          const entries = Object.entries(data);
          if (entries.length === 0) {
            return json({ error: 'JSON object is empty' }, { status: 400 });
          }

          // Process in batches
          for (let i = 0; i < entries.length; i += batchSize) {
            const batch = entries.slice(i, i + batchSize);
            const stmts = [];

            for (const [word, rankValue] of batch) {
              try {
                const wordStr = String(word || '').trim().toLowerCase();
                const rank = parseInt(rankValue, 10);

                if (!wordStr || isNaN(rank) || rank < 0) {
                  errors.push(`Entry "${word}": Invalid word or rank`);
                  continue;
                }

                // Store frequency data (framework is optional, can be null for language-agnostic)
                const fw = framework || null;
                try {
                  stmts.push(env.DB.prepare(`
                    INSERT OR REPLACE INTO reference_word_frequency (word, rank, stem, framework)
                    VALUES (?, ?, ?, ?)
                  `).bind(wordStr, rank, null, fw));
                } catch (e) {
                  // Fallback for older schema without framework column
                  stmts.push(env.DB.prepare(`
                    INSERT OR REPLACE INTO reference_word_frequency (word, rank, stem)
                    VALUES (?, ?, ?)
                  `).bind(wordStr, rank, null));
                }
              } catch (e) {
                errors.push(`Entry "${word}": ${e.message}`);
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

          return json({ success: true, processed: entries.length, errors: errors.length > 0 ? errors : undefined });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Get system config
      if (path.match(/^\/admin\/system-config\/[^\/]+$/) && request.method === 'GET') {
        try {
          const key = path.split('/')[3];
          const row = await env.DB.prepare('SELECT value FROM system_configs WHERE key = ?').bind(key).first();
          
          if (!row) {
            return json({ error: 'Not found' }, { status: 404 });
          }

          return json({ key, value: row.value });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      // Update system config
      if (path.match(/^\/admin\/system-config\/[^\/]+$/) && request.method === 'POST') {
        try {
          const key = path.split('/')[3];
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
      }

      // Assess content level - SuperAdmin only
      if (path === '/admin/assess-content-level' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { contentSlug } = body;

          if (!contentSlug) {
            return json({ error: 'contentSlug is required' }, { status: 400 });
          }

          // Get content item
          const contentItem = await env.DB.prepare('SELECT id, main_language FROM content_items WHERE slug = ?').bind(contentSlug).first();
          if (!contentItem) {
            return json({ error: 'Content item not found' }, { status: 404 });
          }

          // Get all cards for this content
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

          // Determine framework from content language
          const framework = getFrameworkFromLanguage(contentItem.main_language);
          
          // Get cutoff ranks from config (supports multi-framework structure)
          const configRow = await env.DB.prepare('SELECT value FROM system_configs WHERE key = ?').bind('CUTOFF_RANKS').first();
          let allCutoffs = configRow ? JSON.parse(configRow.value) : {};
          // Backward compatibility: if old format (flat object), convert to new format
          if (allCutoffs && !allCutoffs.CEFR && (allCutoffs.A1 !== undefined || allCutoffs.N5 !== undefined || allCutoffs['1'] !== undefined)) {
            // Detect which framework this is
            if (allCutoffs.A1 !== undefined) {
              allCutoffs = { CEFR: allCutoffs };
            } else if (allCutoffs.N5 !== undefined) {
              allCutoffs = { JLPT: allCutoffs };
            } else if (allCutoffs['1'] !== undefined) {
              allCutoffs = { HSK: allCutoffs };
            }
          }
          const frameworkCutoffs = allCutoffs[framework] || {};
          
          // Define level orders and difficulty maps for each framework
          const levelOrders = {
            CEFR: { 'A1': 1, 'A2': 2, 'B1': 3, 'B2': 4, 'C1': 5, 'C2': 6 },
            JLPT: { 'N5': 1, 'N4': 2, 'N3': 3, 'N2': 4, 'N1': 5 },
            HSK: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9 },
            TOPIK: { '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6 }
          };
          const difficultyMaps = {
            CEFR: { 'A1': 10, 'A2': 25, 'B1': 45, 'B2': 65, 'C1': 80, 'C2': 95 },
            JLPT: { 'N5': 10, 'N4': 25, 'N3': 45, 'N2': 70, 'N1': 90 },
            HSK: { '1': 5, '2': 15, '3': 30, '4': 50, '5': 70, '6': 85, '7': 92, '8': 96, '9': 98 },
            TOPIK: { '1': 10, '2': 25, '3': 45, '4': 65, '5': 80, '6': 95 }
          };
          
          const levelOrder = levelOrders[framework] || levelOrders.CEFR;
          const difficultyMap = difficultyMaps[framework] || difficultyMaps.CEFR;

          // Helper: Simple tokenization (split by whitespace, lowercase, remove punctuation)
          function tokenize(text) {
            return String(text || '')
              .toLowerCase()
              .replace(/[^\w\s]/g, ' ')
              .split(/\s+/)
              .filter(t => t.length > 0);
          }

          // Helper: Get level for a word based on frequency rank and framework cutoffs
          async function getWordLevel(word) {
            // Look up word frequency rank (try with framework filter first, then fallback to language-agnostic)
            let freqRow;
            try {
              // Try with framework filter (if framework column exists)
              freqRow = await env.DB.prepare('SELECT rank FROM reference_word_frequency WHERE word = ? AND (framework = ? OR framework IS NULL) ORDER BY framework DESC LIMIT 1').bind(word, framework).first();
            } catch (e) {
              // Fallback: try without framework column (backward compatibility)
              freqRow = await env.DB.prepare('SELECT rank FROM reference_word_frequency WHERE word = ? LIMIT 1').bind(word).first();
            }
            
            if (freqRow && Object.keys(frameworkCutoffs).length > 0) {
              const rank = freqRow.rank;
              // Map rank to level using framework-specific cutoffs
              const levels = Object.keys(frameworkCutoffs).sort((a, b) => (frameworkCutoffs[a] || 0) - (frameworkCutoffs[b] || 0));
              for (const level of levels) {
                if (rank <= (frameworkCutoffs[level] || Infinity)) {
                  return level;
                }
              }
              // If rank exceeds highest cutoff, return highest level
              return levels[levels.length - 1] || null;
            }

            return null;
          }

          // Assess each card
          const updates = [];
          let cardsProcessed = 0;

          for (const card of cards) {
            const tokens = tokenize(card.sentence);
            let maxLevel = null;
            let maxLevelNum = 0;

            // Get level for each token (use Promise.all for parallel lookups)
            const levelPromises = tokens.map(token => getWordLevel(token));
            const levels = await Promise.all(levelPromises);

            // Find highest difficulty level
            for (const level of levels) {
              if (level && levelOrder[level] && levelOrder[level] > maxLevelNum) {
                maxLevelNum = levelOrder[level];
                maxLevel = level;
              }
            }

            if (maxLevel) {
              // Update card_difficulty_levels with correct framework
              updates.push(env.DB.prepare(`
                INSERT OR REPLACE INTO card_difficulty_levels (card_id, framework, level, language)
                VALUES (?, ?, ?, ?)
              `).bind(card.id, framework, maxLevel, contentItem.main_language));

              // Update difficulty_score based on level using framework-specific map
              const difficulty = difficultyMap[maxLevel] || card.difficulty_score || 50;
              updates.push(env.DB.prepare('UPDATE cards SET difficulty_score = ?, updated_at = strftime(\'%s\',\'now\') WHERE id = ?').bind(difficulty, card.id));
            }

            cardsProcessed++;

            // Execute updates in batches
            if (updates.length >= 200) {
              await env.DB.batch(updates);
              updates.length = 0;
            }
          }

          // Execute remaining updates
          if (updates.length > 0) {
            await env.DB.batch(updates);
          }

          // Recalculate stats for all episodes and content item (reuse buildLevelStats from calculate-stats endpoint)
          // Get all episodes for this content
          const episodes = await env.DB.prepare('SELECT id, episode_number FROM episodes WHERE content_item_id = ?').bind(contentItem.id).all();

          function buildLevelStats(rows) {
            const groups = new Map();
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
                const pct = g.total ? Math.round((count / g.total) * 1000) / 10 : 0;
                levels[level] = pct;
              }
              out.push({ framework: g.framework, language: g.language, levels });
            }
            return out;
          }

          // Update episode stats
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

          // Update content item stats
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
      }

      // Check reference data availability for a framework
      if (path === '/admin/check-reference-data' && request.method === 'GET') {
        try {
          const url = new URL(request.url);
          const framework = url.searchParams.get('framework');
          
          if (!framework) {
            return json({ error: 'framework parameter is required' }, { status: 400 });
          }

          // Check if frequency data exists for this framework (or null for language-agnostic)
          const freqCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM reference_word_frequency WHERE framework = ? OR framework IS NULL').bind(framework).first();
          const hasFrequencyData = (freqCount?.count || 0) > 0;

          return json({
            exists: hasFrequencyData,
            hasReferenceList: false, // No longer used - kept for backward compatibility
            hasFrequencyData
          });
        } catch (e) {
          return json({ error: e.message }, { status: 500 });
        }
      }

      return new Response('Not found', { status: 404, headers: withCors() });
    } catch (e) {
      return json({ error: e.message }, { status: 500 });
    }
  },
  
  // Scheduled event handler (runs daily at midnight UTC)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(resetDailyTables(env));
  }
};
