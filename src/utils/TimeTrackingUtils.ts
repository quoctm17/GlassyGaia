/**
 * Debounced time-tracking utilities for reading and listening activities.
 * Extracted from SearchPage.tsx to keep that file clean.
 * Import this module to reuse the tracking logic in other components.
 */
import { apiTrackTime } from '../services/userTracking';

const READING_DEBOUNCE_MS = 8000;
const LISTENING_DEBOUNCE_MS = 5000;

/**
 * Plain object holding refs for time-tracking state.
 * Store this in a useRef or module-level variable in the host component.
 */
export interface TimeTrackingRefs {
  readingAccumulatorRef: { current: number };
  readingTimeoutRef: { current: ReturnType<typeof setTimeout> | null };
  listeningAccumulatorRef: { current: number };
  listeningTimeoutRef: { current: ReturnType<typeof setTimeout> | null };
}

/**
 * Creates the refs object for time tracking.
 * Call once per component instance.
 */
export function createTimeTrackingRefs(): TimeTrackingRefs {
  return {
    readingAccumulatorRef: { current: 0 },
    readingTimeoutRef: { current: null },
    listeningAccumulatorRef: { current: 0 },
    listeningTimeoutRef: { current: null },
  };
}

/**
 * Accumulates and debounces reading time, then sends to the API.
 * Call this function from the host component's `handleTrackReading`.
 *
 * @param seconds - Seconds of reading time to accumulate
 * @param refs - The refs object from createTimeTrackingRefs()
 * @param uid - The user's UID
 */
export function trackReading(
  seconds: number,
  refs: TimeTrackingRefs,
  uid: string | undefined
): void {
  if (!uid || seconds <= 0) return;

  refs.readingAccumulatorRef.current += seconds;

  if (refs.readingTimeoutRef.current) {
    clearTimeout(refs.readingTimeoutRef.current);
  }

  refs.readingTimeoutRef.current = setTimeout(async () => {
    const totalSeconds = refs.readingAccumulatorRef.current;
    if (totalSeconds > 0 && uid) {
      refs.readingAccumulatorRef.current = 0;
      try {
        await apiTrackTime(uid, totalSeconds, 'reading');
      } catch (error) {
        console.error('Failed to track reading time:', error);
      }
    }
  }, READING_DEBOUNCE_MS);
}

/**
 * Accumulates and debounces listening time, then sends to the API.
 *
 * @param seconds - Seconds of listening time to accumulate
 * @param refs - The refs object from createTimeTrackingRefs()
 * @param uid - The user's UID
 */
export function trackListening(
  seconds: number,
  refs: TimeTrackingRefs,
  uid: string | undefined
): void {
  if (!uid || seconds <= 0) return;

  refs.listeningAccumulatorRef.current += seconds;

  if (refs.listeningTimeoutRef.current) {
    clearTimeout(refs.listeningTimeoutRef.current);
  }

  refs.listeningTimeoutRef.current = setTimeout(async () => {
    const totalSeconds = refs.listeningAccumulatorRef.current;
    if (totalSeconds > 0 && uid) {
      refs.listeningAccumulatorRef.current = 0;
      try {
        await apiTrackTime(uid, totalSeconds, 'listening');
      } catch (error) {
        console.error('Failed to track listening time:', error);
      }
    }
  }, LISTENING_DEBOUNCE_MS);
}

/**
 * Cleanup helper — call in the host component's unmount effect.
 * Flushes any accumulated time and clears pending timeouts.
 *
 * @param refs - The refs object from createTimeTrackingRefs()
 * @param uid - The user's UID
 */
export function cleanupTimeTracking(
  refs: TimeTrackingRefs,
  uid: string | undefined
): void {
  if (refs.readingTimeoutRef.current) {
    clearTimeout(refs.readingTimeoutRef.current);
  }
  if (refs.listeningTimeoutRef.current) {
    clearTimeout(refs.listeningTimeoutRef.current);
  }
  if (refs.readingAccumulatorRef.current > 0 && uid) {
    apiTrackTime(uid, refs.readingAccumulatorRef.current, 'reading').catch(() => {});
  }
  if (refs.listeningAccumulatorRef.current > 0 && uid) {
    apiTrackTime(uid, refs.listeningAccumulatorRef.current, 'listening').catch(() => {});
  }
}
