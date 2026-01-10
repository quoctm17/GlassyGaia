// User tracking and gamification API service
// Handles XP, coins, streaks, listening/reading time tracking
import { getAuthHeaders } from "../utils/api";

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

/**
 * Track listening or reading time and award XP
 * @param userId - User ID
 * @param timeSeconds - Time in seconds to track
 * @param type - 'listening' or 'reading'
 * @returns Promise with success status and XP awarded
 */
export async function apiTrackTime(
  userId: string,
  timeSeconds: number,
  type: 'listening' | 'reading'
): Promise<{ success: boolean; xp_awarded: number }> {
  assertApiBase();

  const res = await fetch(`${API_BASE}/api/user/track-time`, {
    method: "POST",
    headers: getAuthHeaders({
      "Content-Type": "application/json",
      Accept: "application/json",
    }),
    body: JSON.stringify({
      user_id: userId,
      time_seconds: timeSeconds,
      type: type,
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to track time: ${res.status} ${text}`);
  }

  return res.json();
}
