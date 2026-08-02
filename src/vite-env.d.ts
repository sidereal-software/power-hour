/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional build-time Spotify Client ID (e.g. a GitHub Actions repo variable). */
  readonly VITE_SPOTIFY_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
