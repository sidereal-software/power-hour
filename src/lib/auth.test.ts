import { beforeEach, describe, expect, it, vi } from 'vitest'

import { readTokens, seedTokens } from '@/test/factories'

const ORIGINAL_LOCATION = window.location

/** Swap window.location so we can assert on redirects and query strings. */
function stubLocation(url: string) {
  const parsed = new URL(url)
  const assign = vi.fn()
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: parsed.href,
      origin: parsed.origin,
      pathname: parsed.pathname,
      search: parsed.search,
      assign,
    },
  })
  return assign
}

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(window, 'location', { configurable: true, value: ORIGINAL_LOCATION })
  localStorage.setItem('ph.clientId', 'test-client-id')
})

const loadAuth = () => import('@/lib/auth')

const tokenResponse = (body: Record<string, unknown>, ok = true) =>
  ({
    ok,
    status: ok ? 200 : 400,
    json: () => Promise.resolve(body),
  }) as Response

describe('login (PKCE authorize request)', () => {
  it('sends the user to Spotify with an S256 challenge', async () => {
    const assign = stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()

    await auth.login()

    expect(assign).toHaveBeenCalledTimes(1)
    const url = new URL(assign.mock.calls[0][0] as string)
    expect(url.origin + url.pathname).toBe('https://accounts.spotify.com/authorize')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('client_id')).toBe('test-client-id')
  })

  it('derives the challenge as base64url(SHA-256(verifier)) with no padding', async () => {
    const assign = stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await auth.login()

    const challenge = new URL(assign.mock.calls[0][0] as string).searchParams.get('code_challenge')!
    const verifier = sessionStorage.getItem('ph.verifier')!

    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
    const expected = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '')

    expect(challenge).toBe(expected)
    expect(challenge).not.toContain('=')
  })

  it('stores a verifier long enough to satisfy the PKCE spec', async () => {
    stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await auth.login()
    const verifier = sessionStorage.getItem('ph.verifier')!
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(verifier.length).toBeLessThanOrEqual(128)
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]+$/)
  })

  it('generates a fresh verifier and state on every attempt', async () => {
    stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await auth.login()
    const first = sessionStorage.getItem('ph.verifier')
    await auth.login()
    expect(sessionStorage.getItem('ph.verifier')).not.toBe(first)
  })

  it('requests every scope the SDK and picker need', async () => {
    const assign = stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await auth.login()
    const scopes = new URL(assign.mock.calls[0][0] as string).searchParams.get('scope')!.split(' ')
    expect(scopes).toEqual(
      expect.arrayContaining([
        'streaming',
        'user-read-email',
        'user-read-private',
        'playlist-read-private',
        'user-modify-playback-state',
      ]),
    )
  })

  it('refuses to start without a client ID', async () => {
    localStorage.removeItem('ph.clientId')
    stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await expect(auth.login()).rejects.toThrow(/Client ID/)
  })
})

describe('handleRedirect', () => {
  it('does nothing when there is no code in the URL', async () => {
    stubLocation('https://user.github.io/power-hour/')
    const auth = await loadAuth()
    await expect(auth.handleRedirect()).resolves.toBeNull()
  })

  it('exchanges the code and stores tokens', async () => {
    stubLocation('https://user.github.io/power-hour/?code=abc&state=xyz')
    sessionStorage.setItem('ph.state', 'xyz')
    sessionStorage.setItem('ph.verifier', 'verifier-value')
    const replaceState = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        tokenResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
      )

    const auth = await loadAuth()
    await expect(auth.handleRedirect()).resolves.toBe('signed-in')

    const body = new URLSearchParams(fetchSpy.mock.calls[0][1]!.body as string)
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code_verifier')).toBe('verifier-value')
    expect(body.get('client_id')).toBe('test-client-id')
    // No client secret is ever sent — that is the whole point of PKCE.
    expect(body.get('client_secret')).toBeNull()

    expect(readTokens()).toMatchObject({ access_token: 'AT', refresh_token: 'RT' })
    expect(replaceState).toHaveBeenCalled()
  })

  it('rejects a mismatched state (CSRF guard)', async () => {
    stubLocation('https://user.github.io/power-hour/?code=abc&state=attacker')
    sessionStorage.setItem('ph.state', 'expected')
    sessionStorage.setItem('ph.verifier', 'v')
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    const auth = await loadAuth()
    await expect(auth.handleRedirect()).rejects.toThrow(/state mismatch/i)
  })

  it('reports a cancelled authorisation', async () => {
    stubLocation('https://user.github.io/power-hour/?error=access_denied')
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    const auth = await loadAuth()
    await expect(auth.handleRedirect()).resolves.toBe('denied')
  })

  it('consumes the verifier so a replayed code cannot be reused', async () => {
    stubLocation('https://user.github.io/power-hour/?code=abc&state=xyz')
    sessionStorage.setItem('ph.state', 'xyz')
    sessionStorage.setItem('ph.verifier', 'v')
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: 'AT', refresh_token: 'RT', expires_in: 3600 }),
    )
    const auth = await loadAuth()
    await auth.handleRedirect()
    expect(sessionStorage.getItem('ph.verifier')).toBeNull()
    expect(sessionStorage.getItem('ph.state')).toBeNull()
  })

  it('surfaces the provider error description on a failed exchange', async () => {
    stubLocation('https://user.github.io/power-hour/?code=abc&state=xyz')
    sessionStorage.setItem('ph.state', 'xyz')
    sessionStorage.setItem('ph.verifier', 'v')
    vi.spyOn(window.history, 'replaceState').mockImplementation(() => {})
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ error: 'invalid_grant', error_description: 'Bad verifier' }, false),
    )
    const auth = await loadAuth()
    await expect(auth.handleRedirect()).rejects.toThrow('Bad verifier')
  })
})

describe('getAccessToken', () => {
  it('returns the stored token while it is comfortably valid', async () => {
    seedTokens(3_600_000)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const auth = await loadAuth()
    await expect(auth.getAccessToken()).resolves.toBe('access-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refreshes early — a token expiring inside the margin is not handed out', async () => {
    // 4 minutes left: still technically valid, but inside REFRESH_MARGIN_MS.
    seedTokens(4 * 60 * 1000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: 'FRESH', refresh_token: 'RT2', expires_in: 3600 }),
    )
    const auth = await loadAuth()
    await expect(auth.getAccessToken()).resolves.toBe('FRESH')
  })

  it('does not refresh a token with more than the margin left', async () => {
    seedTokens(6 * 60 * 1000)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const auth = await loadAuth()
    await expect(auth.getAccessToken()).resolves.toBe('access-token')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('throws when there is no session at all', async () => {
    const auth = await loadAuth()
    await expect(auth.getAccessToken()).rejects.toThrow(/Not signed in/)
  })
})

describe('refresh', () => {
  it('keeps the previous refresh token when the response omits one', async () => {
    seedTokens(-1000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: 'AT2', expires_in: 3600 }),
    )
    const auth = await loadAuth()
    await auth.getAccessToken()
    // PKCE rotates refresh tokens, but a response may omit one — dropping it
    // would silently end the session at the next refresh.
    expect(readTokens()).toMatchObject({ access_token: 'AT2', refresh_token: 'refresh-token' })
  })

  it('stores a rotated refresh token when one is returned', async () => {
    seedTokens(-1000)
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      tokenResponse({ access_token: 'AT2', refresh_token: 'ROTATED', expires_in: 3600 }),
    )
    const auth = await loadAuth()
    await auth.getAccessToken()
    expect(readTokens()?.refresh_token).toBe('ROTATED')
  })

  it('single-flights concurrent refreshes into one network call', async () => {
    seedTokens(-1000)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: 'AT2', expires_in: 3600 }))
    const auth = await loadAuth()

    // The SDK and the Web API both ask for a token constantly.
    const results = await Promise.all([
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.getAccessToken(),
      auth.forceRefresh(),
    ])

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(results.slice(0, 3)).toEqual(['AT2', 'AT2', 'AT2'])
  })

  it('allows a new refresh after the previous one settles', async () => {
    seedTokens(-1000)
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(tokenResponse({ access_token: 'AT2', expires_in: 3600 }))
    const auth = await loadAuth()
    await auth.forceRefresh()
    await auth.forceRefresh()
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('fails clearly when there is no refresh token to spend', async () => {
    localStorage.setItem(
      'ph.tokens',
      JSON.stringify({ access_token: 'stale', expires_at: Date.now() - 1000 }),
    )
    const auth = await loadAuth()
    await expect(auth.getAccessToken()).rejects.toThrow(/connect Spotify again/i)
  })
})

describe('session state', () => {
  it('treats a refresh token as being logged in even past expiry', async () => {
    seedTokens(-10_000)
    const auth = await loadAuth()
    expect(auth.isLoggedIn()).toBe(true)
  })

  it('is logged out with no tokens', async () => {
    const auth = await loadAuth()
    expect(auth.isLoggedIn()).toBe(false)
  })

  it('survives corrupt storage without throwing', async () => {
    localStorage.setItem('ph.tokens', 'not json{')
    const auth = await loadAuth()
    expect(auth.isLoggedIn()).toBe(false)
  })

  it('logout clears tokens and the in-flight PKCE material', async () => {
    seedTokens()
    sessionStorage.setItem('ph.verifier', 'v')
    sessionStorage.setItem('ph.state', 's')
    const auth = await loadAuth()
    auth.logout()
    expect(localStorage.getItem('ph.tokens')).toBeNull()
    expect(sessionStorage.getItem('ph.verifier')).toBeNull()
    expect(auth.isLoggedIn()).toBe(false)
  })
})
