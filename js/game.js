/**
 * The power hour engine: build a queue, start each track at a random point,
 * run a 60-second clock, chime, repeat until the hour is up.
 */
import * as api from './api.js';
import * as playback from './player.js';
import { playChime, playTick } from './chime.js';

const TICK_MS = 200;
/** Slack left after the round so a song never runs out mid-minute. */
const TAIL_PAD_MS = 5000;

/* ── Track selection ───────────────────────────────────────────────── */

export function playableTracks(tracks) {
  const seen = new Set();
  return tracks.filter((t) => {
    if (!t || t.type !== 'track' || t.is_local || !t.uri) return false;
    if (t.is_playable === false) return false;
    if (!t.duration_ms || t.duration_ms < 30000) return false;
    if (seen.has(t.uri)) return false;
    seen.add(t.uri);
    return true;
  });
}

function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Deal `count` tracks. Short playlists get reshuffled passes rather than
 * random draws, so every song is used once before any repeats.
 */
export function buildQueue(tracks, count, allowRepeats, roundMs = 60000) {
  // Prefer songs with room for a full round plus a random offset, but fall back
  // to the whole playlist rather than refusing to run.
  const longEnough = tracks.filter((t) => t.duration_ms >= roundMs + 30000);
  const pool = longEnough.length >= Math.min(count, 20) ? longEnough : tracks;

  const queue = shuffle(pool);
  if (queue.length >= count) return queue.slice(0, count);
  if (!allowRepeats) return queue;

  while (queue.length < count) {
    const pass = shuffle(pool);
    // Don't let a reshuffle seam play the same song twice in a row.
    if (pass.length > 1 && pass[0].uri === queue[queue.length - 1].uri) {
      [pass[0], pass[1]] = [pass[1], pass[0]];
    }
    queue.push(...pass);
  }
  return queue.slice(0, count);
}

/** A random drop-in point that still leaves a full round before the outro. */
export function randomStart(durationMs, roundMs) {
  const latest = durationMs - roundMs - TAIL_PAD_MS;
  const earliest = Math.min(15000, durationMs * 0.08);
  if (latest <= earliest) return Math.max(0, Math.floor((durationMs - roundMs) / 2));
  return Math.floor(earliest + Math.random() * (latest - earliest));
}

/* ── Engine ────────────────────────────────────────────────────────── */

export function createGame({
  tracks,
  roundMs = 60000,
  totalRounds = 60,
  chime = 'bell',
  allowRepeats = true,
  on = {},
}) {
  const queue = buildQueue(tracks, totalRounds, allowRepeats, roundMs);
  const spares = shuffle(tracks);
  let spareCursor = 0;

  let index = 0;
  let deadline = 0;
  let remainingWhenPaused = roundMs;
  let timer = null;
  let status = 'idle';         // idle | playing | paused | finished
  let lastTickSecond = -1;
  let startedAt = 0;
  let wakeLock = null;
  /** Bumped on every round change so a slow `play()` can't revive a stale round. */
  let generation = 0;

  const current = () => queue[index];

  async function acquireWakeLock() {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch { /* unsupported or denied — harmless */ }
  }

  function releaseWakeLock() {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && status === 'playing' && !wakeLock) acquireWakeLock();
  });

  /** Start (or restart) the current round's track at a fresh random offset. */
  async function startTrack() {
    const track = current();
    if (!track) return finish();

    const mine = ++generation;
    const positionMs = randomStart(track.duration_ms, roundMs);
    on.round?.({ index, total: totalRounds, track, positionMs, roundMs });

    try {
      await api.play(playback.getDeviceId(), track.uri, positionMs);
      if (mine !== generation) return;   // skipped/rerolled while this was in flight
    } catch (err) {
      if (mine !== generation) return;
      // Device went stale (tab backgrounded, Spotify moved playback elsewhere).
      if (err.status === 404 || err.status === 502) {
        try {
          await api.transferPlayback(playback.getDeviceId(), false);
          await api.play(playback.getDeviceId(), track.uri, positionMs);
        } catch {
          return on.error?.('Lost the browser playback device. Check that Spotify is not playing on another device, then press Resume.');
        }
      } else if (err.status === 403) {
        return on.error?.('Spotify refused playback. This usually means the account is not Premium.');
      } else {
        return on.error?.(`Could not start the track: ${err.message}`);
      }
    }

    deadline = performance.now() + roundMs;
    lastTickSecond = -1;
    status = 'playing';
    run();
  }

  function run() {
    clearInterval(timer);
    timer = setInterval(() => {
      const remaining = deadline - performance.now();

      if (remaining <= 0) return nextRound();

      const secondsLeft = Math.ceil(remaining / 1000);
      if (secondsLeft !== lastTickSecond) {
        lastTickSecond = secondsLeft;
        if (secondsLeft <= 3 && secondsLeft > 0) playTick(secondsLeft === 1);
      }
      on.tick?.({
        remainingMs: remaining,
        roundMs,
        index,
        totalRounds,
        elapsedTotalMs: index * roundMs + (roundMs - remaining),
      });
    }, TICK_MS);
  }

  function nextRound() {
    clearInterval(timer);
    // Chime first, then hand off — it rings over the new song's first beat,
    // which is how a real power hour sounds.
    playChime(chime);
    index += 1;
    if (index >= totalRounds) return finish();
    startTrack();
  }

  async function finish() {
    clearInterval(timer);
    status = 'finished';
    releaseWakeLock();
    try { await playback.pause(); } catch { /* already stopped */ }
    on.finish?.({ rounds: totalRounds, roundMs, elapsedMs: Date.now() - startedAt });
  }

  return {
    get status() { return status; },
    get index() { return index; },
    get totalRounds() { return totalRounds; },
    get track() { return current(); },
    queueLength: queue.length,

    async start() {
      startedAt = Date.now();
      index = 0;
      acquireWakeLock();
      await startTrack();
    },

    async pause() {
      if (status !== 'playing') return;
      clearInterval(timer);
      remainingWhenPaused = Math.max(0, deadline - performance.now());
      status = 'paused';
      releaseWakeLock();
      try { await playback.pause(); } catch { /* ignore */ }
      on.pause?.({ remainingMs: remainingWhenPaused });
    },

    async resume() {
      if (status !== 'paused') return;
      acquireWakeLock();
      try {
        await playback.resume();
      } catch {
        return on.error?.('Could not resume playback.');
      }
      deadline = performance.now() + remainingWhenPaused;
      status = 'playing';
      run();
      on.resume?.();
    },

    /**
     * Swap in a different song without burning the minute. Prefers a track the
     * run hasn't used yet; always guarantees it isn't the one just rejected.
     */
    async reroll() {
      if (status === 'finished') return;
      clearInterval(timer);

      const rejectedUri = current()?.uri;
      const alreadyPlayed = new Set(queue.slice(0, index).map((t) => t.uri));
      let unplayed = null;
      let anyOther = null;

      for (let i = 0; i < spares.length && !unplayed; i++) {
        const candidate = spares[(spareCursor + i) % spares.length];
        if (candidate.uri === rejectedUri) continue;
        anyOther ??= candidate;
        if (!alreadyPlayed.has(candidate.uri)) unplayed = candidate;
      }

      const replacement = unplayed || anyOther;
      if (replacement) {
        queue[index] = replacement;
        spareCursor = (spares.indexOf(replacement) + 1) % spares.length;
      }
      await startTrack();
    },

    /** Count this minute as done and move on. */
    skip() {
      if (status === 'finished') return;
      nextRound();
    },

    async stop() {
      clearInterval(timer);
      status = 'finished';
      releaseWakeLock();
      try { await playback.pause(); } catch { /* ignore */ }
    },
  };
}
