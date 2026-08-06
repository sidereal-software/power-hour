import { test as base, type Page } from '@playwright/test'

/**
 * A stand-in for the Web Playback SDK. The real script is a remote bundle that
 * needs DRM and a Premium session, so e2e runs against a stub that emits the
 * same events. Everything below the SDK boundary — auth storage, the Web API
 * calls, the round clock, the UI — is the real application code.
 */
const SDK_STUB = `
window.__phPlayerEvents = [];
window.Spotify = {
  Player: class {
    constructor(options) {
      this.options = options;
      this.listeners = {};
      window.__phPlayer = this;
    }
    addListener(event, cb) {
      (this.listeners[event] ||= []).push(cb);
      return true;
    }
    emit(event, payload) {
      (this.listeners[event] || []).forEach((cb) => cb(payload));
    }
    async connect() {
      setTimeout(() => this.emit('ready', { device_id: 'stub-device' }), 30);
      return true;
    }
    async resume() { window.__phPlayerEvents.push('resume'); }
    async pause() { window.__phPlayerEvents.push('pause'); }
    async setVolume(v) { window.__phPlayerEvents.push('volume:' + v.toFixed(2)); }
    async getCurrentState() { return null; }
    disconnect() { window.__phPlayerEvents.push('disconnect'); }
  },
};
if (window.onSpotifyWebPlaybackSDKReady) window.onSpotifyWebPlaybackSDKReady();
`

export interface PlayCall {
  uris: string[]
  position_ms: number
  device: string | null
}

/** One `{ track: … }` entry as the playlist-tracks endpoint returns it. */
export type StubTrackItem = ReturnType<typeof makeTracks>[number]

export interface SpotifyStub {
  /** Every `PUT /me/player/play` the app issued, in order. */
  playCalls: PlayCall[]
  /** Give the page a valid session so it boots straight to the picker. */
  signIn: () => Promise<void>
  /** Configure the account payload (product, country, name). */
  setUser: (user: Record<string, unknown>) => void
  setPlaylists: (playlists: Record<string, unknown>[]) => void
  setTracks: (tracks: StubTrackItem[]) => void
  /** Force a status code for the next N play calls. */
  failNextPlay: (status: number, times?: number) => void
  /** Stall the track-list request, so a long load can be observed and cancelled. */
  stallTrackLoad: (ms: number) => void
  /** How many track-list requests were issued. */
  trackRequests: () => number
}

export function makeTracks(count: number, overrides: Record<string, unknown> = {}) {
  return Array.from({ length: count }, (_, i) => ({
    track: {
      uri: `spotify:track:t${i}`,
      id: `t${i}`,
      name: `Song ${i}`,
      duration_ms: 180_000 + i * 1000,
      type: 'track',
      is_local: false,
      is_playable: true,
      artists: [{ name: `Artist ${i}` }],
      album: { name: `Album ${i}`, images: [] },
      ...overrides,
    },
  }))
}

export const test = base.extend<{ spotify: SpotifyStub }>({
  // `auto` so the Spotify stub is installed even for tests that only take { page };
  // Playwright skips fixtures a test does not destructure.
  spotify: [
    async ({ page }: { page: Page }, use) => {
      const playCalls: PlayCall[] = []
      let user: Record<string, unknown> = {
        id: 'tester',
        display_name: 'Tester',
        country: 'US',
        product: 'premium',
      }
      let playlists: Record<string, unknown>[] = [
        {
          id: 'pl1',
          name: 'Bangers',
          images: [],
          tracks: { total: 40 },
          owner: { display_name: 'Tester' },
        },
        {
          id: 'pl2',
          name: 'Quiet Storm',
          images: [],
          tracks: { total: 12 },
          owner: { display_name: 'Tester' },
        },
      ]
      let tracks = makeTracks(40)
      let forcedFailure: { status: number; remaining: number } | null = null
      let stallMs = 0
      let trackRequestCount = 0

      await page.addInitScript(() => {
        localStorage.setItem('ph.clientId', 'e2e-client-id')
      })

      await page.route('https://sdk.scdn.co/spotify-player.js', (route) =>
        route.fulfill({ contentType: 'application/javascript', body: SDK_STUB }),
      )

      await page.route('https://api.spotify.com/**', (route, request) => {
        const url = new URL(request.url())
        const json = (body: unknown) =>
          route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

        switch (url.pathname) {
          case '/v1/me':
            return json(user)
          case '/v1/me/playlists':
            return json({ items: playlists, next: null })
          case '/v1/playlists/pl1/tracks': {
            trackRequestCount += 1
            if (stallMs > 0) {
              return new Promise<void>((resolve) => setTimeout(resolve, stallMs)).then(() =>
                json({ items: tracks, next: null }),
              )
            }
            return json({ items: tracks, next: null })
          }
          case '/v1/playlists/pl2/tracks':
            return json({ items: tracks.slice(0, 12), next: null })
          case '/v1/me/tracks':
            return json({ items: tracks, next: null })
          case '/v1/me/player/play': {
            if (forcedFailure && forcedFailure.remaining > 0) {
              forcedFailure.remaining -= 1
              return route.fulfill({
                status: forcedFailure.status,
                contentType: 'application/json',
                body: JSON.stringify({ error: { message: 'Forced failure' } }),
              })
            }
            const body = JSON.parse(request.postData() ?? '{}') as {
              uris: string[]
              position_ms: number
            }
            playCalls.push({ ...body, device: url.searchParams.get('device_id') })
            return route.fulfill({ status: 204, body: '' })
          }
          case '/v1/me/player/pause':
          case '/v1/me/player':
            return route.fulfill({ status: 204, body: '' })
          default:
            return route.fulfill({ status: 404, body: '{}' })
        }
      })

      await use({
        playCalls,
        signIn: async () => {
          await page.addInitScript(() => {
            localStorage.setItem(
              'ph.tokens',
              JSON.stringify({
                access_token: 'e2e-access',
                refresh_token: 'e2e-refresh',
                expires_at: Date.now() + 3_600_000,
              }),
            )
          })
        },
        setUser: (next) => {
          user = next
        },
        setPlaylists: (next) => {
          playlists = next
        },
        setTracks: (next) => {
          tracks = next
        },
        failNextPlay: (status, times = 1) => {
          forcedFailure = { status, remaining: times }
        },
        stallTrackLoad: (ms) => {
          stallMs = ms
        },
        trackRequests: () => trackRequestCount,
      })
    },
    { auto: true },
  ],
})

export { expect } from '@playwright/test'

/** Drive the settings sliders down to their minimum for a fast run. */
export async function setShortRun(page: Page) {
  const roundLength = page.getByRole('slider', { name: /round length/i })
  const roundCount = page.getByRole('slider', { name: /number of rounds/i })
  await roundLength.focus()
  await page.keyboard.press('Home')
  await roundCount.focus()
  await page.keyboard.press('Home')
}
