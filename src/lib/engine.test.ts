import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTrack, makeTracks } from '@/test/factories'
import { wakeLockLog } from '@/test/setup'
import type * as ApiModuleNamespace from '@/lib/api'

type ApiModule = typeof ApiModuleNamespace

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<ApiModule>('@/lib/api')
  return {
    ...actual,
    play: vi.fn().mockResolvedValue(null),
    pause: vi.fn().mockResolvedValue(null),
    transferPlayback: vi.fn().mockResolvedValue(null),
  }
})

vi.mock('@/lib/playback', () => ({
  getDeviceId: vi.fn(() => 'device-1'),
  resume: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn().mockResolvedValue(undefined),
  setVolume: vi.fn().mockResolvedValue(undefined),
  isMobileBrowser: vi.fn(() => false),
  connectPlayer: vi.fn().mockResolvedValue('device-1'),
  disconnect: vi.fn(),
}))

import * as api from '@/lib/api'
import { ApiError } from '@/lib/api'
import * as playback from '@/lib/playback'
import { buildQueue, createGame, playableTracks, randomStart } from '@/lib/engine'

const ROUND = 60_000

/** Let queued microtasks (the awaited `play()` call) settle. */
const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('playableTracks', () => {
  it('keeps ordinary playable tracks', () => {
    const tracks = makeTracks(3)
    expect(playableTracks(tracks)).toHaveLength(3)
  })

  it.each([
    ['local files', { is_local: true }],
    ['tracks unavailable in the market', { is_playable: false }],
    ['tracks under 30 seconds', { duration_ms: 12_000 }],
    ['podcast episodes', { type: 'episode' }],
  ])('drops %s', (_label, overrides) => {
    expect(playableTracks([makeTrack(overrides)])).toHaveLength(0)
  })

  it('drops duplicates by uri, keeping the first', () => {
    const dupe = makeTrack({ uri: 'spotify:track:same', name: 'First' })
    const other = makeTrack({ uri: 'spotify:track:same', name: 'Second' })
    const result = playableTracks([dupe, other])
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('First')
  })

  it('survives null-ish entries from the API', () => {
    const tracks = [null, undefined, makeTrack()] as unknown as Parameters<typeof playableTracks>[0]
    expect(playableTracks(tracks)).toHaveLength(1)
  })
})

describe('buildQueue', () => {
  it('draws exactly the requested count when the pool is large enough', () => {
    const queue = buildQueue(makeTracks(200), 60, true, ROUND)
    expect(queue).toHaveLength(60)
  })

  it('never repeats a track when the pool covers the count', () => {
    const queue = buildQueue(makeTracks(200), 60, true, ROUND)
    expect(new Set(queue.map((t) => t.uri)).size).toBe(60)
  })

  it('reuses a short playlist to fill the count when repeats are allowed', () => {
    const queue = buildQueue(makeTracks(3), 60, true, ROUND)
    expect(queue).toHaveLength(60)
  })

  it('never places the same track back to back across a reshuffle seam', () => {
    // Run repeatedly — the seam only collides on some shuffles.
    for (let attempt = 0; attempt < 50; attempt++) {
      const queue = buildQueue(makeTracks(3), 60, true, ROUND)
      const backToBack = queue.filter((t, i) => i > 0 && t.uri === queue[i - 1].uri)
      expect(backToBack).toHaveLength(0)
    }
  })

  it('plays every track once before any repeats', () => {
    const queue = buildQueue(makeTracks(5), 10, true, ROUND)
    expect(new Set(queue.slice(0, 5).map((t) => t.uri)).size).toBe(5)
  })

  it('returns a short queue instead of padding when repeats are disallowed', () => {
    expect(buildQueue(makeTracks(3), 60, false, ROUND)).toHaveLength(3)
  })

  it('prefers tracks with room for the full round', () => {
    const short = makeTracks(30, { duration_ms: 60_000 })
    const long = makeTracks(30, { duration_ms: 240_000 })
    const queue = buildQueue([...short, ...long], 20, true, ROUND)
    expect(queue.every((t) => t.duration_ms >= ROUND + 30_000)).toBe(true)
  })

  it('falls back to the whole playlist when too few tracks are long enough', () => {
    const tracks = makeTracks(10, { duration_ms: 60_000 })
    expect(buildQueue(tracks, 10, true, ROUND)).toHaveLength(10)
  })

  it('scales the length preference to the configured round length', () => {
    const tracks = [
      ...makeTracks(30, { duration_ms: 100_000 }),
      ...makeTracks(30, { duration_ms: 400_000 }),
    ]
    const queue = buildQueue(tracks, 20, true, 120_000)
    expect(queue.every((t) => t.duration_ms >= 150_000)).toBe(true)
  })
})

describe('randomStart', () => {
  it('always leaves a full round plus slack before the end', () => {
    for (const duration of [90_000, 210_000, 400_000, 600_000]) {
      for (let i = 0; i < 2000; i++) {
        const start = randomStart(duration, ROUND)
        expect(start).toBeGreaterThanOrEqual(0)
        expect(start + ROUND).toBeLessThanOrEqual(duration)
      }
    }
  })

  it('skips the cold intro', () => {
    for (let i = 0; i < 2000; i++) {
      expect(randomStart(400_000, ROUND)).toBeGreaterThanOrEqual(15_000)
    }
  })

  it('spreads across the song rather than clustering', () => {
    const samples = Array.from({ length: 3000 }, () => randomStart(400_000, ROUND))
    const spread = Math.max(...samples) - Math.min(...samples)
    expect(spread).toBeGreaterThan(200_000)
  })

  it('centres the window when the song barely fits a round', () => {
    expect(randomStart(70_000, ROUND)).toBe(5000)
  })

  it('never returns a negative offset for songs shorter than a round', () => {
    expect(randomStart(30_000, ROUND)).toBe(0)
  })
})

describe('createGame', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // Module-factory mocks live for the whole file; clear call history (but not
    // implementations) so counts don't leak between cases.
    vi.clearAllMocks()
    vi.mocked(api.play).mockClear().mockResolvedValue(null)
    vi.mocked(api.pause).mockClear().mockResolvedValue(null)
    vi.mocked(api.transferPlayback).mockClear().mockResolvedValue(null)
    vi.mocked(playback.getDeviceId).mockReturnValue('device-1')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const start = async (options: Partial<Parameters<typeof createGame>[0]> = {}) => {
    const on = {
      round: vi.fn(),
      tick: vi.fn(),
      finish: vi.fn(),
      error: vi.fn(),
      statusChange: vi.fn(),
    }
    const game = createGame({
      tracks: makeTracks(40),
      roundMs: ROUND,
      totalRounds: 3,
      chime: 'none',
      on,
      ...options,
    })
    const started = game.start()
    await flush()
    await started
    return { game, on }
  }

  it('starts playback at the drawn offset on the connected device', async () => {
    const { on } = await start()
    expect(api.play).toHaveBeenCalledTimes(1)
    const [device, uri, position] = vi.mocked(api.play).mock.calls[0]
    expect(device).toBe('device-1')
    expect(uri).toMatch(/^spotify:track:/)
    expect(position).toBe(on.round.mock.calls[0][0].positionMs)
  })

  it('reports the round before the network call, so the UI never lags', async () => {
    const { on } = await start()
    expect(on.round).toHaveBeenCalledTimes(1)
    expect(on.round.mock.calls[0][0]).toMatchObject({ index: 0, total: 3, roundMs: ROUND })
  })

  it('advances to the next round when the clock runs out', async () => {
    const { on } = await start()
    await vi.advanceTimersByTimeAsync(ROUND + 250)
    expect(on.round).toHaveBeenCalledTimes(2)
    expect(on.round.mock.calls[1][0].index).toBe(1)
  })

  it('finishes after the configured number of rounds', async () => {
    const { on } = await start()
    await vi.advanceTimersByTimeAsync(ROUND * 3 + 1000)
    expect(on.finish).toHaveBeenCalledTimes(1)
    expect(on.finish.mock.calls[0][0]).toMatchObject({ rounds: 3, roundMs: ROUND })
  })

  it('emits ticks that count down toward zero', async () => {
    const { on } = await start()
    await vi.advanceTimersByTimeAsync(1000)
    const remainings = on.tick.mock.calls.map((c) => c[0].remainingMs)
    expect(remainings.length).toBeGreaterThan(1)
    expect(remainings[0]).toBeGreaterThan(remainings[remainings.length - 1])
  })

  it('tracks elapsed time across rounds for the hour bar', async () => {
    const { on } = await start()
    await vi.advanceTimersByTimeAsync(ROUND + 1000)
    const last = on.tick.mock.calls.at(-1)![0]
    expect(last.index).toBe(1)
    expect(last.elapsedTotalMs).toBeGreaterThan(ROUND)
  })

  it('uses a deadline rather than accumulating ticks, so a stalled tab cannot drift', async () => {
    const { on } = await start()
    // One huge jump stands in for a throttled background tab: the round should
    // end once, not once per skipped interval.
    await vi.advanceTimersByTimeAsync(ROUND * 2)
    expect(on.round.mock.calls.map((c) => c[0].index)).toEqual([0, 1, 2])
  })

  describe('pause and resume', () => {
    it('pauses playback and stops the clock', async () => {
      const { game, on } = await start()
      await vi.advanceTimersByTimeAsync(1000)
      await game.pause()
      const ticksAtPause = on.tick.mock.calls.length
      await vi.advanceTimersByTimeAsync(5000)
      expect(playback.pause).toHaveBeenCalled()
      expect(on.tick.mock.calls.length).toBe(ticksAtPause)
      expect(game.status).toBe('paused')
    })

    it('resumes with the remaining time intact', async () => {
      const { game, on } = await start()
      await vi.advanceTimersByTimeAsync(20_000)
      const remainingAtPause = on.tick.mock.calls.at(-1)![0].remainingMs
      await game.pause()
      await vi.advanceTimersByTimeAsync(30_000)
      await game.resume()
      await vi.advanceTimersByTimeAsync(250)
      const afterResume = on.tick.mock.calls.at(-1)![0].remainingMs
      expect(afterResume).toBeLessThanOrEqual(remainingAtPause)
      expect(afterResume).toBeGreaterThan(remainingAtPause - 2000)
    })

    it('does not restart the track on resume', async () => {
      const { game } = await start()
      await game.pause()
      await game.resume()
      expect(playback.resume).toHaveBeenCalled()
      expect(api.play).toHaveBeenCalledTimes(1)
    })

    it('ignores resume when not paused', async () => {
      const { game } = await start()
      await game.resume()
      expect(playback.resume).not.toHaveBeenCalled()
    })
  })

  describe('reroll', () => {
    it('keeps the round number but plays a different track', async () => {
      const { game, on } = await start()
      const first = on.round.mock.calls[0][0].track.uri
      await game.reroll()
      await flush()
      const second = on.round.mock.calls[1][0]
      expect(second.index).toBe(0)
      expect(second.track.uri).not.toBe(first)
    })

    it('restarts the full round clock', async () => {
      const { game, on } = await start()
      await vi.advanceTimersByTimeAsync(30_000)
      await game.reroll()
      await flush()
      await vi.advanceTimersByTimeAsync(250)
      expect(on.tick.mock.calls.at(-1)![0].remainingMs).toBeGreaterThan(ROUND - 2000)
    })

    it('prefers a track the run has not used yet', async () => {
      const { game, on } = await start({ tracks: makeTracks(5), totalRounds: 5 })
      await vi.advanceTimersByTimeAsync(ROUND * 2 + 250)
      const played = on.round.mock.calls.map((c) => c[0].track.uri)
      await game.reroll()
      await flush()
      const replacement = on.round.mock.calls.at(-1)![0].track.uri
      expect(played.slice(0, -1)).not.toContain(replacement)
    })

    it('still swaps when every track has already been played', async () => {
      const { game, on } = await start({ tracks: makeTracks(2), totalRounds: 4 })
      await vi.advanceTimersByTimeAsync(ROUND * 3 + 250)
      const before = on.round.mock.calls.at(-1)![0].track.uri
      await game.reroll()
      await flush()
      expect(on.round.mock.calls.at(-1)![0].track.uri).not.toBe(before)
    })
  })

  describe('skip', () => {
    it('counts the minute as done and advances', async () => {
      const { game, on } = await start()
      game.skip()
      await flush()
      expect(on.round.mock.calls.at(-1)![0].index).toBe(1)
    })

    it('finishes the run when skipping the final round', async () => {
      const { game, on } = await start({ totalRounds: 1 })
      game.skip()
      await flush()
      expect(on.finish).toHaveBeenCalled()
    })

    it('mashing skip does not let a stale play() resurrect a dead round', async () => {
      // Round 1's request resolves slowly and out of order, after round 3 started.
      const resolvers: (() => void)[] = []
      vi.mocked(api.play).mockImplementation(
        () => new Promise<null>((resolve) => resolvers.push(() => resolve(null))),
      )

      const on = { round: vi.fn(), tick: vi.fn(), finish: vi.fn(), error: vi.fn() }
      const game = createGame({
        tracks: makeTracks(40),
        roundMs: ROUND,
        totalRounds: 5,
        chime: 'none',
        on,
      })
      void game.start()
      await flush()

      game.skip()
      await flush()
      game.skip()
      await flush()

      // Now let the *first* request finally resolve, last.
      resolvers[0]()
      await flush()
      resolvers[2]?.()
      await flush()

      await vi.advanceTimersByTimeAsync(250)
      // The clock must belong to round 3, not the resurrected round 1.
      const ticks = on.tick.mock.calls.map((c) => c[0].index)
      expect(ticks.every((i) => i === 2)).toBe(true)
    })
  })

  describe('failure handling', () => {
    it('retries through a device transfer when the device went stale', async () => {
      vi.mocked(api.play)
        .mockRejectedValueOnce(new ApiError(404, 'Device not found'))
        .mockResolvedValue(null)
      const { on } = await start()
      expect(api.transferPlayback).toHaveBeenCalledWith('device-1', false)
      expect(on.error).not.toHaveBeenCalled()
    })

    it('explains a 403 as a Premium problem', async () => {
      vi.mocked(api.play).mockRejectedValue(new ApiError(403, 'Forbidden'))
      const { on } = await start()
      expect(on.error).toHaveBeenCalledWith(expect.stringContaining('Premium'))
    })

    it('surfaces an unrecoverable transfer failure', async () => {
      vi.mocked(api.play).mockRejectedValue(new ApiError(404, 'gone'))
      vi.mocked(api.transferPlayback).mockRejectedValue(new ApiError(404, 'gone'))
      const { on } = await start()
      expect(on.error).toHaveBeenCalledWith(expect.stringContaining('Lost the browser playback'))
    })

    it('reports when no playback device is connected', async () => {
      vi.mocked(playback.getDeviceId).mockReturnValue(null)
      const { on } = await start()
      expect(on.error).toHaveBeenCalledWith(expect.stringContaining('No Spotify playback device'))
      expect(api.play).not.toHaveBeenCalled()
    })
  })

  describe('lifecycle', () => {
    it('reports status transitions', async () => {
      const { game, on } = await start()
      expect(on.statusChange).toHaveBeenCalledWith('playing')
      await game.pause()
      expect(on.statusChange).toHaveBeenCalledWith('paused')
      await game.stop()
      expect(on.statusChange).toHaveBeenCalledWith('finished')
    })

    it('takes a screen wake lock while running and releases it on stop', async () => {
      const { game } = await start()
      expect(wakeLockLog.requests).toBeGreaterThan(0)
      await game.stop()
      expect(wakeLockLog.releases).toBeGreaterThan(0)
    })

    it('stops the clock and playback on stop', async () => {
      const { game, on } = await start()
      await game.stop()
      const ticks = on.tick.mock.calls.length
      await vi.advanceTimersByTimeAsync(ROUND * 2)
      expect(on.tick.mock.calls.length).toBe(ticks)
      expect(playback.pause).toHaveBeenCalled()
    })

    it('detaches its visibilitychange listener when the run ends', async () => {
      const remove = vi.spyOn(document, 'removeEventListener')
      const { game } = await start()
      await game.stop()
      expect(remove).toHaveBeenCalledWith('visibilitychange', expect.any(Function))
    })
  })
})
