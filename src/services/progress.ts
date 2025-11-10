// Local-storage based progress/favorites (no Firebase)

export interface FavoriteEntry {
  card_id: string;
  film_id?: string;
  episode_id?: string;
}

const LS_KEY = "lingua_favorites"; // stores Record<uid, FavoriteEntry[]>

function readAll(): Record<string, FavoriteEntry[]> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, FavoriteEntry[]>) : {};
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, FavoriteEntry[]>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

export async function logViewCard(_uid: string, _cardId: string, _langs: string[]) {
  // intentionally unused for now to keep API compatibility
  void _uid; void _cardId; void _langs;
}

export async function toggleFavorite(uid: string, cardId: string, meta?: { film_id?: string; episode_id?: string }) {
  const all = readAll();
  const arr = all[uid] || [];
  const idx = arr.findIndex((e) => e.card_id === cardId);
  if (idx >= 0) {
    arr.splice(idx, 1);
    all[uid] = arr;
    writeAll(all);
    return false;
  }
  arr.push({ card_id: cardId, film_id: meta?.film_id, episode_id: meta?.episode_id });
  all[uid] = arr;
  writeAll(all);
  return true;
}

export async function addToDeck(_uid: string, _cardId: string, _deckId: string) {
  // intentionally unused for now to keep API compatibility
  void _uid; void _cardId; void _deckId;
}

export async function listFavorites(uid: string): Promise<FavoriteEntry[]> {
  const all = readAll();
  return all[uid] || [];
}
