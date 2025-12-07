// User management service - API calls to Cloudflare Worker

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

// ==================== User Profile ====================

export interface UserProfile {
  id: string;
  email?: string;
  display_name?: string;
  photo_url?: string;
  auth_provider?: string;
  is_active: number;
  is_admin: number;
  created_at: number;
  updated_at: number;
  last_login_at?: number;
  roles?: string[]; // Array of role names from user_roles table
  // Preferences (from view)
  main_language?: string;
  subtitle_languages?: string;
  require_all_languages?: number;
  difficulty_min?: number;
  difficulty_max?: number;
  auto_play?: number;
  playback_speed?: number;
  theme?: string;
  show_romanization?: number;
}

export interface UserPreferences {
  id?: number;
  user_id: string;
  main_language?: string;
  subtitle_languages?: string; // JSON string
  require_all_languages?: number;
  difficulty_min?: number;
  difficulty_max?: number;
  auto_play?: number;
  playback_speed?: number;
  theme?: string;
  show_romanization?: number;
  created_at?: number;
  updated_at?: number;
}

export interface UserFavorite {
  id: number;
  user_id: string;
  card_id: string;
  film_id?: string;
  episode_id?: string;
  notes?: string;
  tags?: string; // JSON string
  created_at: number;
  updated_at: number;
}

export interface UserStats {
  user_id: string;
  display_name?: string;
  films_studied: number;
  episodes_studied: number;
  total_cards_completed: number;
  total_favorites: number;
  last_study_time?: number;
  first_study_time?: number;
  study_days_span?: number;
}

/**
 * Register or update user profile
 */
export async function registerUser(data: {
  id: string;
  email?: string;
  display_name?: string;
  photo_url?: string;
  auth_provider?: string;
}): Promise<UserProfile> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to register user: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Update last login timestamp
 */
export async function updateLastLogin(userId: string): Promise<void> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ user_id: userId }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update last login: ${res.status} ${text}`);
  }
}

/**
 * Get user profile with preferences
 */
export async function getUserProfile(userId: string): Promise<UserProfile> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user profile: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get user roles
 */
export async function getUserRoles(userId: string): Promise<Array<{ role_name: string; description: string; permissions: string }>> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}/roles`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user roles: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Update user profile
 */
export async function updateUserProfile(
  userId: string,
  data: {
    email?: string;
    display_name?: string;
    photo_url?: string;
  }
): Promise<UserProfile> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update user profile: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Delete user and all related data
 */
export async function deleteUser(userId: string): Promise<{
  success: boolean;
  deleted: {
    user: number;
    progress: number;
    episode_stats: number;
    favorites: number;
    study_sessions: number;
    preferences: number;
    roles: number;
    logins: number;
  };
}> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}`, {
    method: "DELETE",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to delete user: ${res.status} ${text}`);
  }

  return res.json();
}

// ==================== User Preferences ====================

/**
 * Get user preferences
 */
export async function getUserPreferences(
  userId: string
): Promise<UserPreferences> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}/preferences`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user preferences: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Update user preferences
 */
export async function updateUserPreferences(
  userId: string,
  data: {
    main_language?: string;
    subtitle_languages?: string[];
    require_all_languages?: boolean;
    difficulty_min?: number;
    difficulty_max?: number;
    auto_play?: boolean;
    playback_speed?: number;
    theme?: string;
    show_romanization?: boolean;
  }
): Promise<UserPreferences> {
  assertApiBase();
  
  // Convert booleans to integers for SQLite
  const payload = {
    ...data,
    require_all_languages: data.require_all_languages !== undefined ? (data.require_all_languages ? 1 : 0) : undefined,
    auto_play: data.auto_play !== undefined ? (data.auto_play ? 1 : 0) : undefined,
    show_romanization: data.show_romanization !== undefined ? (data.show_romanization ? 1 : 0) : undefined,
  };
  
  const res = await fetch(`${API_BASE}/api/users/${userId}/preferences`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to update user preferences: ${res.status} ${text}`);
  }

  return res.json();
}

// ==================== User Favorites ====================

/**
 * Get user favorites
 */
export async function getUserFavorites(
  userId: string,
  filmId?: string
): Promise<UserFavorite[]> {
  assertApiBase();
  const params = new URLSearchParams();
  if (filmId) params.set("film_id", filmId);

  const url = `${API_BASE}/api/users/${userId}/favorites${
    params.toString() ? `?${params}` : ""
  }`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user favorites: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Add or update favorite
 */
export async function addFavorite(
  userId: string,
  data: {
    card_id: string;
    film_id?: string;
    episode_id?: string;
    notes?: string;
    tags?: string[];
  }
): Promise<UserFavorite> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}/favorites`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to add favorite: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Remove favorite
 */
export async function removeFavorite(
  userId: string,
  cardId: string
): Promise<void> {
  assertApiBase();
  const res = await fetch(
    `${API_BASE}/api/users/${userId}/favorites/${cardId}`,
    {
      method: "DELETE",
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to remove favorite: ${res.status} ${text}`);
  }
}

// ==================== User Statistics ====================

/**
 * Get user statistics
 */
export async function getUserStats(userId: string): Promise<UserStats> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}/stats`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user stats: ${res.status} ${text}`);
  }

  return res.json();
}

// ==================== Admin Functions ====================

export interface UserCardProgress {
  id?: number;
  user_id: string;
  film_id: string;
  episode_id?: string;
  card_id: string;
  card_index: number;
  completed_at: number;
}

export interface UserEpisodeStats {
  id?: number;
  user_id: string;
  film_id: string;
  episode_id?: string;
  total_cards: number;
  completed_cards: number;
  completion_percentage: number;
  last_card_index: number;
  first_completed_at?: number;
  last_completed_at?: number;
}

export interface UserProgressData {
  episode_stats: UserEpisodeStats[];
  recent_cards: UserCardProgress[];
}

/**
 * Get all users (admin endpoint)
 */
export async function getAllUsers(): Promise<UserProfile[]> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get all users: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get user progress details (admin endpoint)
 */
export async function getUserProgressData(
  userId: string
): Promise<UserProgressData> {
  assertApiBase();
  const res = await fetch(`${API_BASE}/api/users/${userId}/progress`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user progress data: ${res.status} ${text}`);
  }

  return res.json();
}
