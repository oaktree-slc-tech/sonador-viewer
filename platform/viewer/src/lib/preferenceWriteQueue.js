// Persistent write queue for user-preference mutations (sonador#42 FR-19..FR-21, AR-10).
//
// ALL preference writes -- the four viewer section saves, every study-list interface slice,
// and FR-10 backfill posts -- flow through submitPreferenceWrite(). Writes are attempted
// online immediately; retryable failures (network, 5xx, 401/403) are enqueued in localStorage,
// coalesced to at most one pending payload per queue key (last-writer-wins), scoped to the
// authenticated user, and replayed on startup, on the browser `online` event, on an
// exponential-backoff timer, and after any successful write (FR-20). Validation failures
// (HTTP 400) are never queued or retried -- the payload is defective, not the network (FR-21).
//
// Plain module by design (AR-7): no React imports, testable under node.

import { toast } from 'react-hot-toast';

import {
  WRITE_QUEUE_BACKOFF_CAP_MS,
  WRITE_QUEUE_BACKOFF_FLOOR_MS,
  WRITE_QUEUE_PRUNE_AGE_MS,
  WRITE_QUEUE_STORAGE_KEY,
} from '../constants/preferences';

import { updateUserPreferenceSection } from '../api/preferences';

// Module state: timers and session flags only -- the queue itself lives in localStorage so it
// survives reloads and browser restarts (FR-19).
let started = false;
let flushing = false;
let retryTimer = null;
let retryDelay = WRITE_QUEUE_BACKOFF_FLOOR_MS;
let offlineToastShown = false;

// Monotonic sequence stamped onto queue entries. Removal after a successful POST is
// conditional on the stored seq being unchanged, so a newer payload coalesced onto the key
// while an older POST was in flight is never dequeued by the older POST's success. The
// time-based component keeps stamps ahead of any entry persisted by a previous session.
let seqCounter = 0;
const nextSeq = () => Date.now() * 4096 + (seqCounter++ % 4096);

const isValidationError = (error) => error && error.status === 400;
const isAuthError = (error) => error && (error.status === 401 || error.status === 403);
const isRetryableError = (error) => !isValidationError(error);

export const getCurrentPreferenceUser = () => {
  // The authenticated user's identity, from the same OIDC state getAuthToken() reads
  // (window.store is set at App module init). Entries are tagged with this identity so one
  // user's pending writes are never flushed -- or dropped -- by another user's session (FR-21).
  // Exported for the hydration module, which scopes its once-per-session latch to the same
  // identity source.
  try {
    const state = typeof window !== 'undefined' && window.store && window.store.getState();
    const profile = state && state.oidc && state.oidc.user && state.oidc.user.profile;
    if (!profile) {
      return null;
    }
    return profile.preferred_username || profile.sub || profile.email || null;
  } catch (e) {
    return null;
  }
};

const getStorage = () => {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
};

const readQueue = () => {
  const storage = getStorage();
  if (!storage) {
    return [];
  }
  try {
    const entries = JSON.parse(storage.getItem(WRITE_QUEUE_STORAGE_KEY) || '[]');
    return Array.isArray(entries) ? entries : [];
  } catch (e) {
    return [];
  }
};

const writeQueue = (entries) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    if (entries.length) {
      storage.setItem(WRITE_QUEUE_STORAGE_KEY, JSON.stringify(entries));
    } else {
      storage.removeItem(WRITE_QUEUE_STORAGE_KEY);
    }
  } catch (e) {
    console.warn('User preferences: unable to persist the write queue.', e);
  }
};

export const notifyPreferenceWriteQueued = () => {
  // At most one informational "will sync" notification per session (FR-17). Used by the
  // silent save-on-change paths (study-list sync); panel saves surface their own
  // per-save outcome notification instead (FR-7).
  if (offlineToastShown) {
    return;
  }
  offlineToastShown = true;
  try {
    toast('Preferences saved locally — they will sync when reconnected.');
  } catch (e) {
    // Notifications are best-effort; queueing must never fail because a toast did.
  }
};

const notifyDropped = (entry, error) => {
  console.error(
    `User preferences: queued write for "${entry.key}" was rejected by the server and will not be retried.`,
    error
  );
  try {
    toast.error(`Failed to sync preferences for "${entry.key}": the server rejected the saved values.`);
  } catch (e) {
    // Best-effort, as above.
  }
};

const enqueue = ({ key, section, payload }) => {
  const user = getCurrentPreferenceUser();
  if (!user) {
    // Without an identity the entry cannot be scoped (FR-19) -- keep local caches only.
    console.warn(`User preferences: no authenticated user; write for "${key}" was not queued.`);
    return false;
  }

  const entries = readQueue();
  const entry = {
    key,
    user,
    section,
    payload,
    queuedAt: new Date().toISOString(),
    attempts: 0,
    seq: nextSeq(),
  };

  // Last-writer-wins coalescing: at most one pending payload per key and user (FR-19). The
  // replaced entry keeps its queue position so flushes stay oldest-first.
  const existing = entries.findIndex((e) => e.key === key && e.user === user);
  if (existing >= 0) {
    entry.queuedAt = entries[existing].queuedAt;
    entries[existing] = entry;
  } else {
    entries.push(entry);
  }

  writeQueue(entries);
  scheduleRetry();
  return true;
};

const clearRetryTimer = () => {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
};

const scheduleRetry = () => {
  // Exponential-backoff retry while entries are pending for the current user (FR-20c).
  if (retryTimer || !hasPendingPreferenceWrites()) {
    return;
  }
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryDelay = Math.min(retryDelay * 2, WRITE_QUEUE_BACKOFF_CAP_MS);
    void flushPreferenceWrites();
  }, retryDelay);
};

export const hasPendingPreferenceWrite = (key) => {
  // Whether a pending queued write exists for `key` under the current user. Hydration uses
  // this to exclude keys from remote-overwrite -- the queued local value is newer (FR-20).
  const user = getCurrentPreferenceUser();
  return !!user && readQueue().some((e) => e.key === key && e.user === user);
};

export const hasPendingPreferenceWrites = () => {
  const user = getCurrentPreferenceUser();
  return !!user && readQueue().some((e) => e.user === user);
};

export const submitPreferenceWrite = async ({ key, section, payload }) => {
  // Single write path for every preference mutation (AR-10). Attempts the POST immediately;
  // on a retryable failure the payload is enqueued and the promise RESOLVES with
  // `{ outcome: 'queued' }` (the change is preserved -- FR-7), or `{ outcome: 'failed' }`
  // when it could NOT be enqueued (no authenticated identity to scope it to) so callers
  // never promise a sync that will not happen. Validation failures (400) REJECT so error
  // paths fire, and are never queued (FR-21).

  // Snapshot any already-pending entry for this key: if the POST succeeds, only that entry
  // (not a newer payload coalesced during the request) may be dequeued -- the server now
  // holds this submission's value, and anything queued later is newer still (FR-19).
  const user = getCurrentPreferenceUser();
  const priorEntry =
    user && readQueue().find((e) => e.key === key && e.user === user);

  try {
    const results = await updateUserPreferenceSection(section, payload);

    if (priorEntry) {
      removeEntry(priorEntry);
    }

    // A successful write doubles as a connectivity signal: drain anything pending (FR-20d).
    if (hasPendingPreferenceWrites()) {
      void flushPreferenceWrites();
    }

    return { outcome: 'saved', results };
  } catch (error) {
    if (!isRetryableError(error)) {
      throw error;
    }

    console.warn(`User preferences: save for "${key}" failed; the write was queued for retry.`, error);
    const queued = enqueue({ key, section, payload });
    return { outcome: queued ? 'queued' : 'failed', error };
  }
};

export const flushPreferenceWrites = async () => {
  // Replay pending entries for the current user, oldest first (FR-20). Per-entry outcomes
  // (FR-21): 2xx dequeues; 400 dequeues with an error notification and is never retried;
  // 401/403 holds for the next trigger (token refresh); network/5xx stays queued under
  // backoff. One entry's failure does not block the rest. Entries tagged for another user
  // are left untouched.

  const user = getCurrentPreferenceUser();
  if (!user || flushing) {
    return;
  }

  flushing = true;
  try {
    const pending = readQueue().filter((e) => e.user === user);
    let hadRetryableFailure = false;

    for (const entry of pending) {
      try {
        await updateUserPreferenceSection(entry.section, entry.payload);
        removeEntry(entry);
      } catch (error) {
        if (isValidationError(error)) {
          removeEntry(entry);
          notifyDropped(entry, error);
        } else {
          bumpAttempts(entry);
          hadRetryableFailure = true;
          if (isAuthError(error)) {
            // Held for the next trigger; do not hammer a 401 inside this flush.
            continue;
          }
        }
      }
    }

    if (!hadRetryableFailure) {
      retryDelay = WRITE_QUEUE_BACKOFF_FLOOR_MS;
    }
  } finally {
    flushing = false;
  }

  scheduleRetry();
};

const removeEntry = (entry) => {
  // Seq-conditional removal: if a newer payload was coalesced onto this key while the POST
  // was in flight, its seq differs and the entry is kept for the next flush.
  writeQueue(
    readQueue().filter((e) => !(e.key === entry.key && e.user === entry.user && e.seq === entry.seq))
  );
};

const bumpAttempts = (entry) => {
  // Seq-conditional like removeEntry: a newer payload coalesced onto the key during the
  // failed POST keeps its fresh attempt count.
  const entries = readQueue();
  const stored = entries.find((e) => e.key === entry.key && e.user === entry.user && e.seq === entry.seq);
  if (stored) {
    stored.attempts = (stored.attempts || 0) + 1;
    writeQueue(entries);
  }
};

const pruneStaleEntries = () => {
  // SHOULD per FR-21: drop entries older than 30 days, regardless of user.
  const cutoff = Date.now() - WRITE_QUEUE_PRUNE_AGE_MS;
  const entries = readQueue();
  const fresh = entries.filter((e) => {
    const queuedAt = Date.parse(e.queuedAt);
    return Number.isNaN(queuedAt) || queuedAt >= cutoff;
  });
  if (fresh.length !== entries.length) {
    writeQueue(fresh);
  }
};

const handleOnline = () => {
  retryDelay = WRITE_QUEUE_BACKOFF_FLOOR_MS;
  void flushPreferenceWrites();
};

export const startPreferenceWriteQueue = () => {
  // Idempotent session start: prune stale entries, watch for connectivity returning
  // (FR-20b), and arm the backoff timer if a previous session left entries pending.
  if (started) {
    return;
  }
  started = true;

  pruneStaleEntries();

  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('online', handleOnline);
  }

  scheduleRetry();
};

export const stopPreferenceWriteQueue = () => {
  // Teardown for tests; the queue itself stays in localStorage.
  started = false;
  flushing = false;
  offlineToastShown = false;
  retryDelay = WRITE_QUEUE_BACKOFF_FLOOR_MS;
  clearRetryTimer();
  if (typeof window !== 'undefined' && window.removeEventListener) {
    window.removeEventListener('online', handleOnline);
  }
};
