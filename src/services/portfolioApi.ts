// Portfolio API service
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
    headers: {
      Accept: "application/json",
    },
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

