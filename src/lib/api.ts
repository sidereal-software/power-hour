/** Thin Spotify Web API client: auth header, 401 refresh, 429 backoff. */
import { forceRefresh, getAccessToken } from './auth'
import type { SpotifyPlaylist, SpotifyTrack, SpotifyUser } from './spotify-types'

const BASE = 'https://api.spotify.com/v1'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * `RequestInit['headers']` also allows `Headers` and `string[][]`, and spreading
 * either into an object literal yields index keys rather than header names.
 * Every call site here passes a plain record, so require that.
 */
interface RequestOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
  allowRetry = true,
): Promise<T> {
  const token = await getAccessToken()
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  })

  if (res.status === 401 && allowRetry) {
    await forceRefresh()
    return request<T>(path, options, false)
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') ?? 2)
    await sleep((retryAfter + 1) * 1000)
    return request<T>(path, options, allowRetry)
  }

  if (!res.ok) {
    let detail = ''
    try {
      detail = ((await res.json()) as { error?: { message?: string } })?.error?.message ?? ''
    } catch {
      /* empty or non-JSON body */
    }
    throw new ApiError(res.status, detail || res.statusText || `HTTP ${res.status}`)
  }

  if (res.status === 204) return null as T
  const text = await res.text()
  return (text ? JSON.parse(text) : null) as T
}

interface Page<T> {
  items: T[]
  next: string | null
  /** Size of the whole collection, not this page. Present on every paging object. */
  total?: number
}

/* ── Account ───────────────────────────────────────────────────────── */

export const getMe = () => request<SpotifyUser>('/me')

/* ── Playlists ─────────────────────────────────────────────────────── */

export async function getMyPlaylists(): Promise<SpotifyPlaylist[]> {
  const playlists: SpotifyPlaylist[] = []
  let url: string | null = '/me/playlists?limit=50'
  while (url) {
    const page: Page<SpotifyPlaylist | null> = await request(url)
    playlists.push(...page.items.filter((p): p is SpotifyPlaylist => Boolean(p)))
    url = page.next ? page.next.replace(BASE, '') : null
  }
  return playlists
}

const TRACK_FIELDS =
  'next,items(is_local,track(uri,id,name,duration_ms,is_playable,is_local,type,' +
  'artists(name),album(name,images)))'

/**
 * Every playable track in a playlist, paginated.
 * `market` matters twice: it populates `is_playable` and it relinks tracks to
 * versions actually available in the user's country.
 */
export async function getPlaylistTracks(
  playlistId: string,
  market?: string,
  onProgress?: (loaded: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  // `total` is not inside `fields`, so ask for it explicitly or it is omitted.
  const params = new URLSearchParams({ limit: '100', fields: `total,${TRACK_FIELDS}` })
  if (market) params.set('market', market)
  let url: string | null = `/playlists/${playlistId}/tracks?${params}`

  while (url) {
    const page: Page<{ track: SpotifyTrack | null }> = await request(url, { signal })
    tracks.push(...page.items.map((i) => i?.track).filter((t): t is SpotifyTrack => Boolean(t)))
    onProgress?.(tracks.length, page.total)
    url = page.next ? page.next.replace(BASE, '') : null
  }
  return tracks
}

export async function getLikedTracks(
  market?: string,
  onProgress?: (loaded: number, total?: number) => void,
  signal?: AbortSignal,
): Promise<SpotifyTrack[]> {
  const tracks: SpotifyTrack[] = []
  const params = new URLSearchParams({ limit: '50' })
  if (market) params.set('market', market)
  let url: string | null = `/me/tracks?${params}`

  while (url) {
    const page: Page<{ track: SpotifyTrack | null }> = await request(url, { signal })
    tracks.push(...page.items.map((i) => i?.track).filter((t): t is SpotifyTrack => Boolean(t)))
    onProgress?.(tracks.length, page.total)
    url = page.next ? page.next.replace(BASE, '') : null
  }
  return tracks
}

/* ── Playback ──────────────────────────────────────────────────────── */

export function play(deviceId: string, uri: string, positionMs: number) {
  return request<null>(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(positionMs)) }),
  })
}

export function pause(deviceId: string) {
  return request<null>(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
  })
}

export function transferPlayback(deviceId: string, startPlaying = false) {
  return request<null>('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play: startPlaying }),
  })
}
