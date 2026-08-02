import type { SpotifyTrack } from './spotify-types'

const pad = (n: number) => String(n).padStart(2, '0')

/** m:ss, or h:mm:ss once past an hour. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3600)
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

export const artistsOf = (track?: SpotifyTrack | null): string =>
  track?.artists?.map((a) => a.name).join(', ') ?? ''

export const artOf = (track?: SpotifyTrack | null): string => track?.album?.images?.[0]?.url ?? ''
