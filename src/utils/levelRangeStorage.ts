/** SessionStorage keys and helpers for SetLevelModal range (min/max frequency) */

const KEY_MIN = 'sp_level_min';
const KEY_MAX = 'sp_level_max';

/** Get stored min frequency rank, or -1 if not set */
export function getStoredLevelMin(): number {
  try {
    const v = sessionStorage.getItem(KEY_MIN);
    if (v === null) return -1;
    const n = Number(v);
    return isNaN(n) ? -1 : n;
  } catch {
    return -1;
  }
}

/** Get stored max frequency rank, or -1 if not set */
export function getStoredLevelMax(): number {
  try {
    const v = sessionStorage.getItem(KEY_MAX);
    if (v === null) return -1;
    const n = Number(v);
    return isNaN(n) ? -1 : n;
  } catch {
    return -1;
  }
}

/** Store min and max frequency rank */
export function setStoredLevelRange(min: number, max: number): void {
  try {
    sessionStorage.setItem(KEY_MIN, String(min));
    sessionStorage.setItem(KEY_MAX, String(max));
  } catch { /* silent */
  }
}

/** Clear stored level range */
export function clearStoredLevelRange(): void {
  try {
    sessionStorage.removeItem(KEY_MIN);
    sessionStorage.removeItem(KEY_MAX);
  } catch { /* silent */
  }
}
