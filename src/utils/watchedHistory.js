/**
 * Watched-history tracking for the Spark feed.
 *
 * §2026-05-23 fei: extended from write-only to read+write, with a FIFO cap.
 *   Previously only had markAsWatched() — no way to know what's been seen,
 *   so the Spark feed kept showing the same videos. Now exports getWatchedIds()
 *   / isWatched() so callers can filter their feed against the watched set.
 *
 *   Storage: localStorage (device-scoped, not synced across devices/browsers).
 *     Acceptable trade-off for a v1 — moving to a Supabase table would add
 *     extra round-trips and complicate the offline path. Can swap backend
 *     later if cross-device sync becomes important.
 *
 *   FIFO cap: 1000 entries. JSON-stringify of 1000 UUIDs is ~36KB, well
 *     under localStorage's 5-10MB quota. Set iteration preserves insertion
 *     order, so when we exceed cap we just slice the oldest entries.
 */
const KEY = 'uvera_watched_branches';
const MAX = 1000;

function readArray() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeArray(arr) {
  try {
    // FIFO cap — keep the most recent MAX entries.
    const trimmed = arr.length > MAX ? arr.slice(arr.length - MAX) : arr;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.error('watchedHistory write failed', err);
  }
}

export function markAsWatched(id) {
  if (!id) return;
  const arr = readArray();
  // Skip duplicates without touching the array — keeps existing insertion
  // order so the FIFO cap evicts truly-old entries, not re-watched ones.
  if (arr.includes(id)) return;
  arr.push(id);
  writeArray(arr);
}

/**
 * Returns a Set<string> of all watched IDs. Snapshot — callers should call
 * this once per session (e.g. at SparkMode mount) and use the snapshot for
 * filtering. Mid-session changes (videos watched while the feed is open)
 * intentionally do NOT re-filter the current feed — the user might want to
 * swipe back to a video they just watched. Next session will pick them up.
 */
export function getWatchedIds() {
  return new Set(readArray());
}

/**
 * Convenience predicate. Reads localStorage on every call — fine for one-off
 * checks; for bulk filtering prefer `const watched = getWatchedIds()` and
 * use the snapshot.
 */
export function isWatched(id) {
  if (!id) return false;
  return readArray().includes(id);
}
