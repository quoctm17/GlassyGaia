// Authentication service - Email/Password and OAuth

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(
  import.meta.env.VITE_CF_API_BASE as string | undefined
);

function assertApiBase() {
  if (!API_BASE) {
    throw new Error(
      "VITE_CF_API_BASE is not set. Provide your Cloudflare Worker/Pages API base URL."
    );
  }
}

export interface AuthResponse {
  success: boolean;
  user?: {
    id: string;
    email: string;
    display_name: string;
    photo_url?: string;
    auth_provider: string;
    role?: string;
    is_admin?: number;
  };
  token?: string;
  error?: string;
}

/**
 * Sign up with email and password
 */
export async function signupWithEmailPassword(data: {
  email: string;
  password: string;
  displayName: string;
}): Promise<AuthResponse> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/auth/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Signup failed" }));
    return {
      success: false,
      error: errorData.error || `Signup failed: ${res.status}`,
    };
  }

  return await res.json();
}

/**
 * Login with email/phone and password
 */
export async function loginWithEmailPassword(
  emailOrPhone: string,
  password: string
): Promise<AuthResponse> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: emailOrPhone,
      password,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Login failed" }));
    return {
      success: false,
      error: errorData.error || `Login failed: ${res.status}`,
    };
  }

  return await res.json();
}

/**
 * Request password reset
 */
export async function requestPasswordReset(email: string): Promise<{ success: boolean; error?: string }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/auth/forgot-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Request failed" }));
    return {
      success: false,
      error: errorData.error || "Failed to send reset email",
    };
  }

  return { success: true };
}

/**
 * Reset password with token
 */
export async function resetPassword(
  token: string,
  newPassword: string
): Promise<{ success: boolean; error?: string }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/auth/reset-password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token, password: newPassword }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Reset failed" }));
    return {
      success: false,
      error: errorData.error || "Failed to reset password",
    };
  }

  return { success: true };
}

/**
 * Verify email with token
 */
export async function verifyEmail(token: string): Promise<{ success: boolean; error?: string }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/auth/verify-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({ error: "Verification failed" }));
    return {
      success: false,
      error: errorData.error || "Failed to verify email",
    };
  }

  return { success: true };
}
