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

export interface WebPlaybackPlayer {
  connect(): Promise<boolean>
  disconnect(): void
  addListener(event: string, cb: (payload: never) => void): boolean
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
