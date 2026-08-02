/**
 * There is no server here — the Spotify Client ID is a public identifier and is
 * safe to ship in the bundle. The PKCE flow never uses a client secret, which is
 * exactly why this can live on GitHub Pages.
 *
 * Precedence: build-time env var (set `VITE_SPOTIFY_CLIENT_ID`, e.g. from a
 * GitHub Actions repository variable) → value the user pasted into the setup
 * screen → nothing, in which case the setup screen asks for one.
 */
const BUILD_TIME_CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID ?? ''

const CLIENT_ID_KEY = 'ph.clientId'

export const SCOPES = [
  'streaming', // Web Playback SDK
  'user-read-email', // required alongside `streaming`
  'user-read-private', // account country + Premium check
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read', // Liked Songs as a pseudo-playlist
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ')

/** Spotify demands an exact redirect-URI match, so normalise `/index.html` away. */
export function redirectUri(): string {
  const { origin, pathname } = window.location
  return origin + pathname.replace(/index\.html$/, '')
}

export function getClientId(): string {
  return BUILD_TIME_CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || ''
}

/** True when the ID is baked in at build time and the user can't override it. */
export const clientIdIsFixed = Boolean(BUILD_TIME_CLIENT_ID)

export function setClientId(id: string): void {
  localStorage.setItem(CLIENT_ID_KEY, id.trim())
}

export function clearClientId(): void {
  localStorage.removeItem(CLIENT_ID_KEY)
}
