// JWT utility functions for frontend

/**
 * Decode JWT token (without verification - for client-side use only)
 * Note: This does NOT verify the signature. Always verify on the server.
 */
export function decodeJWT(token: string): { payload?: any; error?: string } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { error: 'Invalid token format' };
    }
    
    const [, encodedPayload] = parts;
    
    // Base64URL decode
    const base64 = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    let padding = '';
    while ((base64.length + padding.length) % 4) {
      padding += '=';
    }
    const decoded = atob(base64 + padding);
    const payload = JSON.parse(decoded);
    
    return { payload };
  } catch (e) {
    return { error: (e as Error).message || 'Failed to decode token' };
  }
}

/**
 * Check if JWT token is expired
 */
export function isJWTExpired(token: string): boolean {
  const decoded = decodeJWT(token);
  if (decoded.error || !decoded.payload) {
    return true;
  }
  
  const exp = decoded.payload.exp;
  if (!exp) {
    return true; // No expiration = invalid
  }
  
  const now = Math.floor(Date.now() / 1000);
  return exp < now;
}

/**
 * Get remaining time until token expires (in seconds)
 */
export function getJWTTimeToExpiry(token: string): number {
  const decoded = decodeJWT(token);
  if (decoded.error || !decoded.payload) {
    return 0;
  }
  
  const exp = decoded.payload.exp;
  if (!exp) {
    return 0;
  }
  
  const now = Math.floor(Date.now() / 1000);
  return Math.max(0, exp - now);
}
