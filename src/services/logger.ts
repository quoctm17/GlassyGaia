// Lightweight client-side logger. No Firebase.
// If VITE_CF_API_BASE is configured and your API supports it, we'll POST to /events.
// Otherwise we silently no-op.

const API_BASE = (import.meta.env.VITE_CF_API_BASE as string | undefined)?.replace(/\/$/, "") || "";

export async function logUserEvent(
  uid: string,
  event: string,
  payload: Record<string, unknown>
) {
  try {
    if (!API_BASE) return; // no-op if not configured
    await fetch(`${API_BASE}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid, event, payload, createdAt: new Date().toISOString() }),
    });
  } catch {
    // swallow errors; logging must never break UX
  }
}
