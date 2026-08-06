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
  'items(is_local,track(uri,id,name,duration_ms,is_playable,is_local,type,' +
  'artists(name),album(name,images)))'

const PLAYLIST_PAGE_SIZE = 100
const LIKED_PAGE_SIZE = 50
/** Spotify tolerates this comfortably; higher mostly buys 429s. */
const PAGE_CONCURRENCY = 6

export interface TrackLoadOptions {
  /**
   * Doubles as availability and relinking: it populates `is_playable` and swaps
   * tracks for versions playable in the user's country.
   */
  market?: string
  /**
   * Soft ceiling on how many tracks to fetch. Above it, whole pages are drawn at
   * random from across the collection instead of reading it front to back.
   */
  maxTracks?: number
  onProgress?: (loaded: number, total?: number) => void
  signal?: AbortSignal
}

export interface TrackLoadResult {
  tracks: SpotifyTrack[]
  /** Size of the whole collection, per Spotify. */
  total: number
  /** True when only a random subset of pages was read. */
  sampled: boolean
}

type TrackItem = { track: SpotifyTrack | null }

/** `count` distinct page indexes drawn uniformly from `[0, pageCount)`. */
export function samplePageIndexes(pageCount: number, count: number): number[] {
  if (count >= pageCount) return Array.from({ length: pageCount }, (_, i) => i)
  const chosen = new Set<number>()
  while (chosen.size < count) chosen.add(Math.floor(Math.random() * pageCount))
  return [...chosen].toSorted((a, b) => a - b)
}

/** Run `fn` over `items`, at most `limit` in flight. */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await fn(items[index])
    }
  })
  await Promise.all(workers)
}

/**
 * Read a paged track collection.
 *
 * Reading a few thousand tracks front to back is dozens of sequential requests
 * for a pool the game will only draw sixty songs from. Past `maxTracks` this
 * instead picks whole pages at random across the collection, so a huge playlist
 * still contributes songs from its middle and end rather than only its opening.
 * Sampling is by page, so tracks arrive in contiguous runs — spread across the
 * playlist, not a simple random sample of it.
 */
async function loadTracks(
  buildUrl: (limit: number, offset: number) => string,
  pageSize: number,
  { maxTracks, onProgress, signal }: TrackLoadOptions,
): Promise<TrackLoadResult> {
  // One tiny request establishes the size before committing to the whole thing.
  const probe: Page<TrackItem> = await request(buildUrl(1, 0), { signal })
  const total = probe.total ?? 0
  if (total === 0) return { tracks: [], total: 0, sampled: false }

  const pageCount = Math.ceil(total / pageSize)
  const wantPages = maxTracks
    ? Math.min(pageCount, Math.max(1, Math.ceil(maxTracks / pageSize)))
    : pageCount
  const sampled = wantPages < pageCount
  const pages = sampled
    ? samplePageIndexes(pageCount, wantPages)
    : Array.from({ length: pageCount }, (_, i) => i)

  const expected = sampled ? Math.min(total, wantPages * pageSize) : total
  const tracks: SpotifyTrack[] = []
  onProgress?.(0, expected)

  await mapWithConcurrency(pages, PAGE_CONCURRENCY, async (page) => {
    const res: Page<TrackItem> = await request(buildUrl(pageSize, page * pageSize), { signal })
    for (const item of res.items) {
      if (item?.track) tracks.push(item.track)
    }
    onProgress?.(tracks.length, expected)
  })

  return { tracks, total, sampled }
}

export function getPlaylistTracks(
  playlistId: string,
  options: TrackLoadOptions = {},
): Promise<TrackLoadResult> {
  return loadTracks(
    (limit, offset) => {
      // `total` sits outside `fields`, so it must be requested explicitly.
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
        fields: `total,${TRACK_FIELDS}`,
      })
      if (options.market) params.set('market', options.market)
      return `/playlists/${playlistId}/tracks?${params}`
    },
    PLAYLIST_PAGE_SIZE,
    options,
  )
}

export function getLikedTracks(options: TrackLoadOptions = {}): Promise<TrackLoadResult> {
  return loadTracks(
    (limit, offset) => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
      if (options.market) params.set('market', options.market)
      return `/me/tracks?${params}`
    },
    LIKED_PAGE_SIZE,
    options,
  )
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
