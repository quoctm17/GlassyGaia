// Hash password using PBKDF2
export async function hashPassword(password) {
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

// Verify password against hash
export async function verifyPassword(password, hash) {
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
export function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.prototype.map.call(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

// Generate user ID
export function generateUserId() {
  return `user_${crypto.randomUUID()}`;
}

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
  try {
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
  } catch (err) {
    console.error('[createSignature] Crypto error:', err.message);
    throw new Error('Signature generation failed');
  }
}

// Generate JWT token
export async function generateJWT(userId, email, roles, secret, expiresInDays = 7) {
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

  return `${data}.${encodedSignature}`;
}

// Verify JWT token
export async function verifyJWT(token, secret) {
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
    if (payload.iat && payload.iat > now + 60) {
      return { valid: false, error: 'Token issued in the future' };
    }

    // 6. Token hợp lệ
    return { valid: true, payload };
  } catch (e) {
    return { valid: false, error: e.message || 'Token verification failed' };
  }
}

// Middleware để authenticate request
export async function authenticateRequest(request, env) {
  // 1. Lấy token từ header
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { authenticated: false, error: 'Missing or invalid Authorization header' };
  }

  const token = authHeader.slice(7).trim(); // Dùng .slice() và .trim() để sạch token
  if (!token) {
    return { authenticated: false, error: 'Unauthorized: Token is empty' };
  }

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
  const { user_id, email, roles, exp } = result.payload;

  const userRoles = roles || [];
  return {
    authenticated: true,
    userId: user_id,
    email: email,
    roles: userRoles,
    expiresAt: exp,
    isAdmin: userRoles.includes('admin'),
    isPremium: userRoles.includes('premium')
  };
}
