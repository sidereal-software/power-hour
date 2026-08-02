/** The slice of Spotify's payloads this app actually reads. */

export interface SpotifyImage {
  url: string
  width?: number | null
  height?: number | null
}

export interface SpotifyArtist {
  name: string
}

export interface SpotifyAlbum {
  name: string
  images: SpotifyImage[]
}

export interface SpotifyTrack {
  uri: string
  id: string | null
  name: string
  duration_ms: number
  type: string
  is_local: boolean
  is_playable?: boolean
  artists: SpotifyArtist[]
  album: SpotifyAlbum
}

export interface SpotifyUser {
  id: string
  display_name: string | null
  country?: string
  product?: 'premium' | 'free' | 'open'
  images?: SpotifyImage[]
}

export interface SpotifyPlaylist {
  id: string
  name: string
  images: SpotifyImage[] | null
  tracks: { total: number }
  owner: { display_name: string | null }
}

/** A playlist as the picker renders it — includes the synthetic Liked Songs row. */
export interface PlaylistChoice {
  id: string
  kind: 'playlist' | 'liked'
  name: string
  subtitle: string
  image: string
  total: number
}

/* ── Web Playback SDK ──────────────────────────────────────────────── */

export interface WebPlaybackError {
  message: string
}

export interface WebPlaybackDevice {
  device_id: string
}

/**
 * Overloaded so each event's payload is typed at the call site — the SDK ships
 * no types of its own, and a single `(payload: never)` signature just pushes
 * casts into every listener.
 */
export interface WebPlaybackPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: 'ready' | 'not_ready', cb: (payload: WebPlaybackDevice) => void): boolean
  addListener(
    event: 'initialization_error' | 'authentication_error' | 'account_error' | 'playback_error',
    cb: (payload: WebPlaybackError) => void,
  ): boolean
  addListener(event: 'autoplay_failed', cb: () => void): boolean
  addListener(event: 'player_state_changed', cb: (state: unknown) => void): boolean
  resume(): Promise<void>
  pause(): Promise<void>
  setVolume(value: number): Promise<void>
  getCurrentState(): Promise<unknown>
}

declare global {
  interface Window {
    __sdkReady: Promise<void>
    onSpotifyWebPlaybackSDKReady: () => void
    Spotify: {
      Player: new (options: {
        name: string
        volume?: number
        getOAuthToken: (cb: (token: string) => void) => void
      }) => WebPlaybackPlayer
    }
  }
}
