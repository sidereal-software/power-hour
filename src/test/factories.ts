import type { SpotifyPlaylist, SpotifyTrack, SpotifyUser } from '@/lib/spotify-types'

let counter = 0

export function makeTrack(overrides: Partial<SpotifyTrack> = {}): SpotifyTrack {
  const n = counter++
  return {
    uri: `spotify:track:t${n}`,
    id: `t${n}`,
    name: `Song ${n}`,
    duration_ms: 210_000,
    type: 'track',
    is_local: false,
    is_playable: true,
    artists: [{ name: `Artist ${n}` }],
    album: { name: `Album ${n}`, images: [{ url: `https://img.test/${n}.jpg` }] },
    ...overrides,
  }
}

export const makeTracks = (count: number, overrides: Partial<SpotifyTrack> = {}) =>
  Array.from({ length: count }, () => makeTrack(overrides))

export function makeUser(overrides: Partial<SpotifyUser> = {}): SpotifyUser {
  return {
    id: 'tester',
    display_name: 'Tester',
    country: 'US',
    product: 'premium',
    ...overrides,
  }
}

export function makePlaylist(overrides: Partial<SpotifyPlaylist> = {}): SpotifyPlaylist {
  return {
    id: 'pl1',
    name: 'Bangers',
    images: [{ url: 'https://img.test/pl1.jpg' }],
    tracks: { total: 40 },
    owner: { display_name: 'Tester' },
    ...overrides,
  }
}

/** Seed a valid, non-expiring session so api/engine tests skip the auth dance. */
export function seedTokens(expiresInMs = 3_600_000) {
  localStorage.setItem(
    'ph.tokens',
    JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_at: Date.now() + expiresInMs,
    }),
  )
}

export const readTokens = () =>
  JSON.parse(localStorage.getItem('ph.tokens') ?? 'null') as {
    access_token: string
    refresh_token?: string
    expires_at: number
  } | null
