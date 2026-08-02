/**
 * The power hour engine: build a queue, start each track at a random point,
 * run a 60-second clock, chime, repeat until the hour is up.
 *
 * Deliberately framework-free — React only subscribes to its callbacks.
 */
import * as api from './api'
import * as playback from './playback'
import { playChime, playTick, type ChimeName } from './chime'
import { ApiError } from './api'
import type { SpotifyTrack } from './spotify-types'

const TICK_MS = 200
/** Slack left after the round so a song never runs out mid-minute. */
const TAIL_PAD_MS = 5000

export type GameStatus = 'idle' | 'playing' | 'paused' | 'finished'

export interface RoundInfo {
  index: number
  total: number
  track: SpotifyTrack
  positionMs: number
  roundMs: number
}

export interface TickInfo {
  remainingMs: number
  roundMs: number
  index: number
  totalRounds: number
  elapsedTotalMs: number
}

/* ── Track selection ───────────────────────────────────────────────── */

export function playableTracks(tracks: SpotifyTrack[]): SpotifyTrack[] {
  const seen = new Set<string>()
  return tracks.filter((t) => {
    if (!t || t.type !== 'track' || t.is_local || !t.uri) return false
    if (t.is_playable === false) return false
    if (!t.duration_ms || t.duration_ms < 30000) return false
    if (seen.has(t.uri)) return false
    seen.add(t.uri)
    return true
  })
}

function shuffle<T>(items: T[]): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Deal `count` tracks. Short playlists get reshuffled passes rather than
 * random draws, so every song is used once before any repeats.
 */
export function buildQueue(
  tracks: SpotifyTrack[],
  count: number,
  allowRepeats: boolean,
  roundMs = 60000,
): SpotifyTrack[] {
  // Prefer songs with room for a full round plus a random offset, but fall back
  // to the whole playlist rather than refusing to run.
  const longEnough = tracks.filter((t) => t.duration_ms >= roundMs + 30000)
  const pool = longEnough.length >= Math.min(count, 20) ? longEnough : tracks

  const queue = shuffle(pool)
  if (queue.length >= count) return queue.slice(0, count)
  if (!allowRepeats) return queue

  while (queue.length < count) {
    const pass = shuffle(pool)
    // Don't let a reshuffle seam play the same song twice in a row.
    if (pass.length > 1 && pass[0].uri === queue[queue.length - 1].uri) {
      ;[pass[0], pass[1]] = [pass[1], pass[0]]
    }
    queue.push(...pass)
  }
  return queue.slice(0, count)
}

/** A random drop-in point that still leaves a full round before the outro. */
export function randomStart(durationMs: number, roundMs: number): number {
  const latest = durationMs - roundMs - TAIL_PAD_MS
  const earliest = Math.min(15000, durationMs * 0.08)
  if (latest <= earliest) return Math.max(0, Math.floor((durationMs - roundMs) / 2))
  return Math.floor(earliest + Math.random() * (latest - earliest))
}

/* ── Engine ────────────────────────────────────────────────────────── */

export interface GameCallbacks {
  round?: (info: RoundInfo) => void
  tick?: (info: TickInfo) => void
  finish?: (info: { rounds: number; roundMs: number }) => void
  error?: (message: string) => void
  statusChange?: (status: GameStatus) => void
}

export interface GameOptions {
  tracks: SpotifyTrack[]
  roundMs?: number
  totalRounds?: number
  chime?: ChimeName
  allowRepeats?: boolean
  on?: GameCallbacks
}

export interface Game {
  readonly status: GameStatus
  readonly index: number
  readonly totalRounds: number
  start(): Promise<void>
  pause(): Promise<void>
  resume(): Promise<void>
  reroll(): Promise<void>
  skip(): void
  stop(): Promise<void>
}

export function createGame({
  tracks,
  roundMs = 60000,
  totalRounds = 60,
  chime = 'bell',
  allowRepeats = true,
  on = {},
}: GameOptions): Game {
  const queue = buildQueue(tracks, totalRounds, allowRepeats, roundMs)
  const spares = shuffle(tracks)
  let spareCursor = 0

  let index = 0
  let deadline = 0
  let remainingWhenPaused = roundMs
  let timer: ReturnType<typeof setInterval> | undefined
  let status: GameStatus = 'idle'
  let lastTickSecond = -1
  let wakeLock: WakeLockSentinel | null = null
  /** Bumped on every round change so a slow `play()` can't revive a stale round. */
  let generation = 0

  const current = () => queue[index]

  function setStatus(next: GameStatus) {
    status = next
    on.statusChange?.(next)
  }

  async function acquireWakeLock() {
    try {
      wakeLock = (await navigator.wakeLock?.request('screen')) ?? null
    } catch {
      /* unsupported or denied — harmless */
    }
  }

  function releaseWakeLock() {
    void wakeLock?.release?.().catch(() => {})
    wakeLock = null
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && status === 'playing' && !wakeLock) {
      void acquireWakeLock()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)

  /** Start (or restart) the current round's track at a fresh random offset. */
  async function startTrack(): Promise<void> {
    const track = current()
    if (!track) return finish()

    const mine = ++generation
    const positionMs = randomStart(track.duration_ms, roundMs)
    on.round?.({ index, total: totalRounds, track, positionMs, roundMs })

    const deviceId = playback.getDeviceId()
    if (!deviceId) return on.error?.('No Spotify playback device. Reload and reconnect.')

    try {
      await api.play(deviceId, track.uri, positionMs)
      if (mine !== generation) return // skipped/rerolled while this was in flight
    } catch (err) {
      if (mine !== generation) return
      const status = err instanceof ApiError ? err.status : 0
      // Device went stale (tab backgrounded, Spotify moved playback elsewhere).
      if (status === 404 || status === 502) {
        try {
          await api.transferPlayback(deviceId, false)
          await api.play(deviceId, track.uri, positionMs)
        } catch {
          return on.error?.(
            'Lost the browser playback device. Check that Spotify is not playing on another device, then press Resume.',
          )
        }
      } else if (status === 403) {
        return on.error?.('Spotify refused playback. This usually means the account is not Premium.')
      } else {
        return on.error?.(`Could not start the track: ${(err as Error).message}`)
      }
    }

    deadline = performance.now() + roundMs
    lastTickSecond = -1
    setStatus('playing')
    run()
  }

  function run() {
    clearInterval(timer)
    timer = setInterval(() => {
      const remaining = deadline - performance.now()
      if (remaining <= 0) return nextRound()

      const secondsLeft = Math.ceil(remaining / 1000)
      if (secondsLeft !== lastTickSecond) {
        lastTickSecond = secondsLeft
        if (secondsLeft <= 3 && secondsLeft > 0) playTick(secondsLeft === 1)
      }
      on.tick?.({
        remainingMs: remaining,
        roundMs,
        index,
        totalRounds,
        elapsedTotalMs: index * roundMs + (roundMs - remaining),
      })
    }, TICK_MS)
  }

  function nextRound() {
    clearInterval(timer)
    // Chime first, then hand off — it rings over the new song's first beat,
    // which is how a real power hour sounds.
    playChime(chime)
    index += 1
    if (index >= totalRounds) return void finish()
    void startTrack()
  }

  async function finish() {
    clearInterval(timer)
    setStatus('finished')
    releaseWakeLock()
    document.removeEventListener('visibilitychange', onVisibility)
    try {
      await playback.pause()
    } catch {
      /* already stopped */
    }
    on.finish?.({ rounds: totalRounds, roundMs })
  }

  return {
    get status() {
      return status
    },
    get index() {
      return index
    },
    get totalRounds() {
      return totalRounds
    },

    async start() {
      index = 0
      void acquireWakeLock()
      await startTrack()
    },

    async pause() {
      if (status !== 'playing') return
      clearInterval(timer)
      remainingWhenPaused = Math.max(0, deadline - performance.now())
      setStatus('paused')
      releaseWakeLock()
      try {
        await playback.pause()
      } catch {
        /* ignore */
      }
    },

    async resume() {
      if (status !== 'paused') return
      void acquireWakeLock()
      try {
        await playback.resume()
      } catch {
        on.error?.('Could not resume playback.')
        return
      }
      deadline = performance.now() + remainingWhenPaused
      setStatus('playing')
      run()
    },

    /**
     * Swap in a different song without burning the minute. Prefers a track the
     * run hasn't used yet; always guarantees it isn't the one just rejected.
     */
    async reroll() {
      if (status === 'finished') return
      clearInterval(timer)

      const rejectedUri = current()?.uri
      const alreadyPlayed = new Set(queue.slice(0, index).map((t) => t.uri))
      let unplayed: SpotifyTrack | null = null
      let anyOther: SpotifyTrack | null = null

      for (let i = 0; i < spares.length && !unplayed; i++) {
        const candidate = spares[(spareCursor + i) % spares.length]
        if (candidate.uri === rejectedUri) continue
        anyOther ??= candidate
        if (!alreadyPlayed.has(candidate.uri)) unplayed = candidate
      }

      const replacement = unplayed ?? anyOther
      if (replacement) {
        queue[index] = replacement
        spareCursor = (spares.indexOf(replacement) + 1) % spares.length
      }
      await startTrack()
    },

    /** Count this minute as done and move on. */
    skip() {
      if (status === 'finished') return
      nextRound()
    },

    async stop() {
      clearInterval(timer)
      setStatus('finished')
      releaseWakeLock()
      document.removeEventListener('visibilitychange', onVisibility)
      try {
        await playback.pause()
      } catch {
        /* ignore */
      }
    },
  }
}
