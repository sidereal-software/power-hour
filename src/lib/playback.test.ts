import { beforeEach, describe, expect, it, vi } from 'vitest'

// `vi.resetModules()` below hands playback.ts a fresh copy of its imports, so
// auth has to be mocked at the module level rather than spied on an instance.
const { getAccessToken, forceRefresh } = vi.hoisted(() => ({
  getAccessToken: vi.fn<() => Promise<string>>(),
  forceRefresh: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getAccessToken, forceRefresh }))

import type * as PlaybackModule from '@/lib/playback'

type Listener = (payload: unknown) => void
type PlayerOptions = { name: string; volume?: number; getOAuthToken: unknown }

/** Minimal stand-in for the Web Playback SDK player. */
class FakePlayer {
  static last: FakePlayer | null = null
  /** Set before connectPlayer() runs — connect() reads it immediately. */
  static nextConnectResult = true
  listeners: Record<string, Listener[]> = {}
  connectResult = FakePlayer.nextConnectResult
  resumed = 0
  paused = 0
  volume: number | null = null
  disconnected = false

  options: PlayerOptions

  constructor(options: PlayerOptions) {
    this.options = options
    FakePlayer.last = this
  }

  addListener(event: string, cb: Listener) {
    ;(this.listeners[event] ??= []).push(cb)
    return true
  }

  emit(event: string, payload?: unknown) {
    for (const cb of this.listeners[event] ?? []) cb(payload)
  }

  connect() {
    return Promise.resolve(this.connectResult)
  }
  resume() {
    this.resumed += 1
    return Promise.resolve()
  }
  pause() {
    this.paused += 1
    return Promise.resolve()
  }
  setVolume(v: number) {
    this.volume = v
    return Promise.resolve()
  }
  getCurrentState() {
    return Promise.resolve(null)
  }
  disconnect() {
    this.disconnected = true
  }
}

beforeEach(() => {
  vi.resetModules()
  FakePlayer.last = null
  FakePlayer.nextConnectResult = true
  Object.assign(window, {
    __sdkReady: Promise.resolve(),
    Spotify: { Player: FakePlayer },
  })
  getAccessToken.mockReset().mockResolvedValue('token')
  forceRefresh.mockReset()
})

const load = () => import('@/lib/playback')

/** Connect, emitting `ready` once the SDK has been constructed. */
async function connect(playback: typeof PlaybackModule, onError?: (m: string) => void) {
  const promise = playback.connectPlayer({ onError })
  await vi.waitFor(() => expect(FakePlayer.last).not.toBeNull())
  FakePlayer.last!.emit('ready', { device_id: 'device-1' })
  return promise
}

describe('connectPlayer', () => {
  it('resolves with the device id from the ready event', async () => {
    const playback = await load()
    await expect(connect(playback)).resolves.toBe('device-1')
    expect(playback.getDeviceId()).toBe('device-1')
  })

  it('waits for the SDK ready promise set up in index.html', async () => {
    let release!: () => void
    Object.assign(window, { __sdkReady: new Promise<void>((r) => (release = r)) })
    const playback = await load()
    const promise = playback.connectPlayer()

    await Promise.resolve()
    expect(FakePlayer.last).toBeNull()

    release()
    await vi.waitFor(() => expect(FakePlayer.last).not.toBeNull())
    FakePlayer.last!.emit('ready', { device_id: 'device-1' })
    await expect(promise).resolves.toBe('device-1')
  })

  it('names the device so it is recognisable in Spotify Connect', async () => {
    const playback = await load()
    await connect(playback)
    expect(FakePlayer.last!.options.name).toBe('Power Hour')
  })

  it('reuses the existing player on a second call', async () => {
    const playback = await load()
    await connect(playback)
    const first = FakePlayer.last
    await expect(playback.connectPlayer()).resolves.toBe('device-1')
    expect(FakePlayer.last).toBe(first)
  })

  it('throws when the SDK refuses to connect', async () => {
    FakePlayer.nextConnectResult = false
    const playback = await load()
    await expect(playback.connectPlayer()).rejects.toThrow(/Could not connect/)
  })

  it('supplies a fresh token when the SDK asks for one', async () => {
    const playback = await load()
    await connect(playback)
    const getOAuthToken = FakePlayer.last!.options.getOAuthToken as (
      cb: (t: string) => void,
    ) => void

    const token = await new Promise<string>((resolve) => getOAuthToken(resolve))
    expect(token).toBe('token')
  })

  it('falls back to a forced refresh if the cached token lookup fails', async () => {
    getAccessToken.mockRejectedValue(new Error('expired'))
    forceRefresh.mockResolvedValue({
      access_token: 'refreshed',
      refresh_token: 'r',
      expires_at: Date.now() + 3_600_000,
    })
    const playback = await load()
    await connect(playback)
    const getOAuthToken = FakePlayer.last!.options.getOAuthToken as (
      cb: (t: string) => void,
    ) => void

    const token = await new Promise<string>((resolve) => getOAuthToken(resolve))
    expect(token).toBe('refreshed')
  })

  it.each([
    ['initialization_error', { message: 'no EME' }, /could not start in this browser/i],
    ['authentication_error', { message: 'bad token' }, /rejected the session/i],
    ['account_error', {}, /Premium is required/i],
    ['playback_error', { message: 'stream failed' }, /Playback error/i],
    ['autoplay_failed', {}, /blocked autoplay/i],
  ])('translates %s into a readable message', async (event, payload, expected) => {
    const onError = vi.fn()
    const playback = await load()
    await connect(playback, onError)
    FakePlayer.last!.emit(event, payload)
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(expected))
  })

  it('drops the device id when the SDK goes not_ready', async () => {
    const playback = await load()
    await connect(playback)
    FakePlayer.last!.emit('not_ready', { device_id: 'device-1' })
    expect(playback.getDeviceId()).toBeNull()
  })
})

describe('transport controls', () => {
  it('forwards resume and pause to the SDK', async () => {
    const playback = await load()
    await connect(playback)
    await playback.resume()
    await playback.pause()
    expect(FakePlayer.last!.resumed).toBe(1)
    expect(FakePlayer.last!.paused).toBe(1)
  })

  it('clamps volume into 0–1', async () => {
    const playback = await load()
    await connect(playback)

    await playback.setVolume(2)
    expect(FakePlayer.last!.volume).toBe(1)

    await playback.setVolume(-3)
    expect(FakePlayer.last!.volume).toBe(0)

    await playback.setVolume(0.4)
    expect(FakePlayer.last!.volume).toBeCloseTo(0.4)
  })

  it('is a no-op before a player exists', async () => {
    const playback = await load()
    expect(() => playback.resume()).not.toThrow()
    expect(playback.getDeviceId()).toBeNull()
  })

  it('disconnect tears the player down', async () => {
    const playback = await load()
    await connect(playback)
    const player = FakePlayer.last!
    playback.disconnect()
    expect(player.disconnected).toBe(true)
    expect(playback.getDeviceId()).toBeNull()
  })
})

describe('isMobileBrowser', () => {
  const withUserAgent = async (ua: string) => {
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: ua })
    const playback = await load()
    return playback.isMobileBrowser()
  }

  it.each([
    ['iPhone', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148'],
    ['iPad', 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile/15E148'],
    ['Android', 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Safari/537.36'],
  ])('detects %s, which the SDK cannot support', async (_label, ua) => {
    await expect(withUserAgent(ua)).resolves.toBe(true)
  })

  it.each([
    ['macOS Chrome', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0 Safari/537.36'],
    [
      'Windows Edge',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36 Edg/120',
    ],
  ])('allows %s', async (_label, ua) => {
    await expect(withUserAgent(ua)).resolves.toBe(false)
  })
})
