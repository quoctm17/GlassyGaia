// Portfolio API service
import { getAuthHeaders } from "../utils/api";
// Separate file for portfolio-related API calls

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

export interface UserPortfolio {
  user_id: string;
  total_xp: number;
  level: number;
  coins: number;
  current_streak: number;
  longest_streak: number;
  total_cards_saved: number;
  total_cards_reviewed: number;
  total_listening_time: number;
  total_reading_time: number;
  due_cards_count: number;
}

/**
 * Get user portfolio/stats
 */
export async function apiGetUserPortfolio(
  userId: string
): Promise<UserPortfolio | null> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
  });

  const res = await fetch(`${API_BASE}/api/user/portfolio?${params}`, {
    method: "GET",
    headers: getAuthHeaders({
      Accept: "application/json",
    }),
  });

  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user portfolio: ${res.status} ${text}`);
  }

  return res.json();
}

export interface StreakHistoryItem {
  streak_date: string; // YYYY-MM-DD
  streak_achieved: number; // 1 = achieved, 0 = missed
  streak_count: number;
}

export interface MonthlyXPData {
  date: string; // YYYY-MM-DD
  xp_earned: number;
}

export interface UserMetrics {
  srs_metrics: {
    new_cards: number;
    again_cards: number;
    hard_cards: number;
    good_cards: number;
    easy_cards: number;
    due_cards: number;
    average_interval_days: number;
  };
  listening_metrics: {
    time_minutes: number;
    count: number;
    xp: number;
  };
  reading_metrics: {
    time_minutes: number;
    count: number;
    xp: number;
  };
}

/**
 * Get detailed user metrics (SRS, Listening, Reading)
 */
export async function apiGetUserMetrics(_userId: string): Promise<UserMetrics | null> {
  assertApiBase();
  
  const res = await fetch(`${API_BASE}/api/user/metrics`, {
    method: "GET",
    headers: getAuthHeaders({
      Accept: "application/json",
    }),
  });

  if (!res.ok) {
    if (res.status === 404) {
      return null;
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get user metrics: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get user streak history for heatmap
 */
export async function apiGetStreakHistory(
  userId: string
): Promise<StreakHistoryItem[]> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
  });

  const res = await fetch(`${API_BASE}/api/user/streak-history?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return [];
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get streak history: ${res.status} ${text}`);
  }

  return res.json();
}

/**
 * Get monthly XP data for graph
 */
export async function apiGetMonthlyXP(
  userId: string,
  year: number,
  month: number // 1-12
): Promise<MonthlyXPData[]> {
  assertApiBase();
  const params = new URLSearchParams({
    user_id: userId,
    year: year.toString(),
    month: month.toString(),
  });

  const res = await fetch(`${API_BASE}/api/user/monthly-xp?${params}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 404) {
      return [];
    }
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to get monthly XP: ${res.status} ${text}`);
  }

  return res.json();
}
