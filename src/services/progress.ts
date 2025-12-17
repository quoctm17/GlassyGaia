// API-based progress/favorites using Cloudflare Worker

function normalizeBase(input: string | undefined): string {
  if (!input) return "";
  let t = String(input).trim();
  if (!/^https?:\/\//i.test(t)) t = `https://${t}`;
  return t.replace(/\/$/, "");
}

const API_BASE = normalizeBase(import.meta.env.VITE_CF_API_BASE as string | undefined);

export interface FavoriteEntry {
  card_id: string;
  film_id?: string;
  episode_id?: string;
  notes?: string;
  tags?: string[];
  created_at?: number;
}

export async function logViewCard(_uid: string, _cardId: string, _langs: string[]) {
  // intentionally unused for now to keep API compatibility
  void _uid; void _cardId; void _langs;
}

export async function toggleFavorite(uid: string, cardId: string, meta?: { film_id?: string; episode_id?: string }): Promise<boolean> {
  // Check if already favorited
  const favorites = await listFavorites(uid);
  const exists = favorites.some(f => f.card_id === cardId);
  
  if (exists) {
    // Remove favorite
    const res = await fetch(`${API_BASE}/api/users/${uid}/favorites/${encodeURIComponent(cardId)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to remove favorite');
    return false;
  } else {
    // Add favorite
    const res = await fetch(`${API_BASE}/api/users/${uid}/favorites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        card_id: cardId,
        film_id: meta?.film_id,
        episode_id: meta?.episode_id,
      }),
    });
    if (!res.ok) throw new Error('Failed to add favorite');
    return true;
  }
}

export async function addToDeck(_uid: string, _cardId: string, _deckId: string) {
  // intentionally unused for now to keep API compatibility
  void _uid; void _cardId; void _deckId;
}

export async function listFavorites(uid: string): Promise<FavoriteEntry[]> {
  const res = await fetch(`${API_BASE}/api/users/${uid}/favorites`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}
