import { beforeEach, describe, expect, it, vi } from 'vitest'

import * as api from '@/lib/api'
import { ApiError } from '@/lib/api'
import * as auth from '@/lib/auth'
import { makePlaylist, makeTrack, makeUser } from '@/test/factories'

const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  ({
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: 'Test',
    headers: new Headers(init.headers ?? {}),
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body),
  }) as Response

const empty = (status = 204) =>
  ({
    ok: true,
    status,
    statusText: 'No Content',
    headers: new Headers(),
    text: () => Promise.resolve(''),
    json: () => Promise.reject(new Error('no body')),
  }) as unknown as Response

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  vi.spyOn(auth, 'getAccessToken').mockResolvedValue('access-token')
  vi.spyOn(auth, 'forceRefresh').mockResolvedValue({
    access_token: 'fresh',
    refresh_token: 'r',
    expires_at: Date.now() + 3_600_000,
  })
  fetchSpy = vi.spyOn(globalThis, 'fetch')
})

describe('request plumbing', () => {
  it('attaches the bearer token', async () => {
    fetchSpy.mockResolvedValue(json(makeUser()))
    await api.getMe()
    const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer access-token')
  })

  it('sets a JSON content type only when there is a body', async () => {
    fetchSpy.mockResolvedValue(json(makeUser()))
    await api.getMe()
    expect((fetchSpy.mock.calls[0][1]!.headers as Record<string, string>)['Content-Type']).toBe(
      undefined,
    )

    fetchSpy.mockResolvedValue(empty())
    await api.play('dev', 'spotify:track:1', 1000)
    expect((fetchSpy.mock.calls[1][1]!.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json',
    )
  })

  it('returns null for a 204 rather than trying to parse it', async () => {
    fetchSpy.mockResolvedValue(empty())
    await expect(api.pause('dev')).resolves.toBeNull()
  })

  it('refreshes once and retries on a 401', async () => {
    fetchSpy
      .mockResolvedValueOnce(json({}, { status: 401 }))
      .mockResolvedValueOnce(json(makeUser()))
    await expect(api.getMe()).resolves.toMatchObject({ id: 'tester' })
    expect(auth.forceRefresh).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('does not loop forever when the retry also 401s', async () => {
    fetchSpy.mockResolvedValue(json({ error: { message: 'Expired' } }, { status: 401 }))
    await expect(api.getMe()).rejects.toThrow(ApiError)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('honours Retry-After on a 429 and then succeeds', async () => {
    vi.useFakeTimers()
    fetchSpy
      .mockResolvedValueOnce(json({}, { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(json(makeUser()))

    const promise = api.getMe()
    await vi.advanceTimersByTimeAsync(3100)
    await expect(promise).resolves.toMatchObject({ id: 'tester' })
    vi.useRealTimers()
  })

  it('surfaces the Spotify error message', async () => {
    fetchSpy.mockResolvedValue(
      json({ error: { message: 'Player command failed' } }, { status: 403 }),
    )
    await expect(api.play('dev', 'spotify:track:1', 0)).rejects.toThrow('Player command failed')
  })

  it('carries the HTTP status on the thrown error', async () => {
    fetchSpy.mockResolvedValue(json({ error: { message: 'nope' } }, { status: 404 }))
    await expect(api.play('dev', 'spotify:track:1', 0)).rejects.toMatchObject({ status: 404 })
  })

  it('falls back to a status line when the error body is not JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      headers: new Headers(),
      json: () => Promise.reject(new Error('not json')),
      text: () => Promise.resolve(''),
    })
    await expect(api.getMe()).rejects.toThrow('Internal Server Error')
  })
})

describe('pagination', () => {
  it('follows `next` across playlist pages', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        json({
          items: [makePlaylist({ id: 'a' })],
          next: 'https://api.spotify.com/v1/me/playlists?offset=50',
        }),
      )
      .mockResolvedValueOnce(json({ items: [makePlaylist({ id: 'b' })], next: null }))

    const playlists = await api.getMyPlaylists()
    expect(playlists.map((p) => p.id)).toEqual(['a', 'b'])
    expect(fetchSpy.mock.calls[1][0]).toBe('https://api.spotify.com/v1/me/playlists?offset=50')
  })

  it('skips null playlist entries', async () => {
    fetchSpy.mockResolvedValue(json({ items: [null, makePlaylist()], next: null }))
    await expect(api.getMyPlaylists()).resolves.toHaveLength(1)
  })

  it('unwraps playlist track items and reports progress', async () => {
    const onProgress = vi.fn()
    fetchSpy
      .mockResolvedValueOnce(
        json({
          items: [{ track: makeTrack() }, { track: null }],
          next: 'https://api.spotify.com/v1/playlists/pl1/tracks?offset=100',
        }),
      )
      .mockResolvedValueOnce(json({ items: [{ track: makeTrack() }], next: null }))

    const tracks = await api.getPlaylistTracks('pl1', 'US', onProgress)
    expect(tracks).toHaveLength(2)
    expect(onProgress).toHaveBeenCalledTimes(2)
  })

  it('passes market so is_playable is populated and tracks are relinked', async () => {
    fetchSpy.mockResolvedValue(json({ items: [], next: null }))
    await api.getPlaylistTracks('pl1', 'GB')
    expect(fetchSpy.mock.calls[0][0]).toContain('market=GB')
  })

  it('omits market when the account country is unknown', async () => {
    fetchSpy.mockResolvedValue(json({ items: [], next: null }))
    await api.getPlaylistTracks('pl1', undefined)
    expect(fetchSpy.mock.calls[0][0]).not.toContain('market=')
  })

  it('requests only the track fields the app reads', async () => {
    fetchSpy.mockResolvedValue(json({ items: [], next: null }))
    await api.getPlaylistTracks('pl1', 'US')
    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('fields=')
    expect(decodeURIComponent(url)).toContain('duration_ms')
  })

  it('pages through liked songs', async () => {
    fetchSpy
      .mockResolvedValueOnce(
        json({
          items: [{ track: makeTrack() }],
          next: 'https://api.spotify.com/v1/me/tracks?offset=50',
        }),
      )
      .mockResolvedValueOnce(json({ items: [{ track: makeTrack() }], next: null }))
    await expect(api.getLikedTracks('US')).resolves.toHaveLength(2)
  })
})

describe('playback commands', () => {
  it('starts a single uri at a floored, non-negative position', async () => {
    fetchSpy.mockResolvedValue(empty())
    await api.play('device-1', 'spotify:track:xyz', 12_345.9)
    const [url, init] = fetchSpy.mock.calls[0]
    expect(url).toContain('device_id=device-1')
    expect(JSON.parse(init!.body as string)).toEqual({
      uris: ['spotify:track:xyz'],
      position_ms: 12_345,
    })
  })

  it('clamps a negative position to zero', async () => {
    fetchSpy.mockResolvedValue(empty())
    await api.play('device-1', 'spotify:track:xyz', -500)
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string).position_ms).toBe(0)
  })

  it('url-encodes the device id', async () => {
    fetchSpy.mockResolvedValue(empty())
    await api.pause('device with spaces')
    expect(fetchSpy.mock.calls[0][0]).toContain('device%20with%20spaces')
  })

  it('transfers playback without auto-starting by default', async () => {
    fetchSpy.mockResolvedValue(empty())
    await api.transferPlayback('device-1')
    expect(JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)).toEqual({
      device_ids: ['device-1'],
      play: false,
    })
  })
})
