/**
 * Web Playback SDK wrapper — turns this browser tab into a Spotify device.
 * Premium-only, and desktop browsers only (the SDK has no mobile support).
 */
import { forceRefresh, getAccessToken } from './auth'
import type { WebPlaybackPlayer } from './spotify-types'

let player: WebPlaybackPlayer | null = null
let deviceId: string | null = null

export function getDeviceId(): string | null {
  return deviceId
}

export function isMobileBrowser(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent)
}

interface ConnectOptions {
  onError?: (message: string) => void
  volume?: number
}

/**
 * Connect the SDK. Call this from a user gesture — browsers gate audio
 * playback on one, and the SDK opens its audio context on connect.
 * Resolves once Spotify hands us a device_id.
 */
export async function connectPlayer({ onError, volume = 0.8 }: ConnectOptions = {}): Promise<string> {
  if (player && deviceId) return deviceId

  await window.__sdkReady

  player = new window.Spotify.Player({
    name: 'Power Hour',
    volume,
    getOAuthToken: (cb) => {
      getAccessToken()
        .then(cb)
        // A failed refresh here surfaces as an authentication_error below.
        .catch(() =>
          forceRefresh()
            .then((t) => cb(t.access_token))
            .catch(() => {}),
        )
    },
  })

  const fail = (message: string) => onError?.(message)
  const listen = (event: string, handler: (payload: { message: string }) => void) =>
    player!.addListener(event, handler as (payload: never) => void)

  listen('initialization_error', ({ message }) =>
    fail(`Playback could not start in this browser. ${message}`))
  listen('authentication_error', ({ message }) => fail(`Spotify rejected the session. ${message}`))
  listen('account_error', () => fail('Spotify Premium is required for in-browser playback.'))
  listen('playback_error', ({ message }) => fail(`Playback error: ${message}`))
  listen('autoplay_failed', () =>
    fail('The browser blocked autoplay. Press play again to continue.'))

  const ready = new Promise<string>((resolve, reject) => {
    player!.addListener('ready', ((payload: { device_id: string }) => {
      deviceId = payload.device_id
      resolve(payload.device_id)
    }) as (payload: never) => void)
    setTimeout(
      () => reject(new Error('Timed out waiting for the Spotify player to start.')),
      20000,
    )
  })

  player.addListener('not_ready', (() => {
    deviceId = null
  }) as (payload: never) => void)

  const connected = await player.connect()
  if (!connected) throw new Error('Could not connect to Spotify playback.')

  return ready
}

export const resume = () => player?.resume()
export const pause = () => player?.pause()
export const setVolume = (value: number) => player?.setVolume(Math.min(1, Math.max(0, value)))

export function disconnect(): void {
  player?.disconnect()
  player = null
  deviceId = null
}
