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
export async function connectPlayer({
  onError,
  volume = 0.8,
}: ConnectOptions = {}): Promise<string> {
  if (player && deviceId) return deviceId

  await window.__sdkReady

  // Bind to a local const: the module-level `player` is mutable, so TypeScript
  // discards its narrowing across the closures created below.
  const instance = new window.Spotify.Player({
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

  player = instance

  const fail = (message: string) => onError?.(message)

  instance.addListener('initialization_error', ({ message }) =>
    fail(`Playback could not start in this browser. ${message}`),
  )
  instance.addListener('authentication_error', ({ message }) =>
    fail(`Spotify rejected the session. ${message}`),
  )
  instance.addListener('account_error', () =>
    fail('Spotify Premium is required for in-browser playback.'),
  )
  instance.addListener('playback_error', ({ message }) => fail(`Playback error: ${message}`))
  instance.addListener('autoplay_failed', () =>
    fail('The browser blocked autoplay. Press play again to continue.'),
  )

  const ready = new Promise<string>((resolve, reject) => {
    instance.addListener('ready', ({ device_id }) => {
      deviceId = device_id
      resolve(device_id)
    })
    setTimeout(() => reject(new Error('Timed out waiting for the Spotify player to start.')), 20000)
  })

  instance.addListener('not_ready', () => {
    deviceId = null
  })

  const connected = await instance.connect()
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
