// API utility functions

/**
 * Get JWT token from localStorage
 */
export function getJWTToken(): string | null {
  return localStorage.getItem('jwt_token');
}

/**
 * Get headers with JWT token if available
 */
export function getAuthHeaders(additionalHeaders: Record<string, string> = {}): HeadersInit {
  const headers: HeadersInit = {
    ...additionalHeaders,
  };
  
  const token = getJWTToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  return headers;
}
