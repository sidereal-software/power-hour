import { beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_LOCATION = window.location

function stubLocation(url: string) {
  const parsed = new URL(url)
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { href: parsed.href, origin: parsed.origin, pathname: parsed.pathname },
  })
}

beforeEach(() => {
  vi.resetModules()
  Object.defineProperty(window, 'location', { configurable: true, value: ORIGINAL_LOCATION })
})

describe('redirectUri', () => {
  it.each([
    ['https://user.github.io/power-hour/', 'https://user.github.io/power-hour/'],
    // Spotify matches byte-for-byte, so index.html must normalise away.
    ['https://user.github.io/power-hour/index.html', 'https://user.github.io/power-hour/'],
    ['https://user.github.io/', 'https://user.github.io/'],
    ['http://127.0.0.1:5173/', 'http://127.0.0.1:5173/'],
    ['http://127.0.0.1:5173/index.html', 'http://127.0.0.1:5173/'],
  ])('normalises %s to %s', async (url, expected) => {
    stubLocation(url)
    const { redirectUri } = await import('@/lib/config')
    expect(redirectUri()).toBe(expected)
  })

  it('ignores the query string left by the OAuth redirect', async () => {
    stubLocation('https://user.github.io/power-hour/?code=abc&state=xyz')
    const { redirectUri } = await import('@/lib/config')
    expect(redirectUri()).toBe('https://user.github.io/power-hour/')
  })
})

describe('client ID resolution', () => {
  it('is empty when nothing is configured', async () => {
    const { getClientId } = await import('@/lib/config')
    expect(getClientId()).toBe('')
  })

  it('reads and trims a value saved from the setup screen', async () => {
    const { getClientId, setClientId } = await import('@/lib/config')
    setClientId('  pasted-id  ')
    expect(getClientId()).toBe('pasted-id')
  })

  it('clears the stored value', async () => {
    const { clearClientId, getClientId, setClientId } = await import('@/lib/config')
    setClientId('pasted-id')
    clearClientId()
    expect(getClientId()).toBe('')
  })

  it('prefers the build-time value over anything in storage', async () => {
    vi.stubEnv('VITE_SPOTIFY_CLIENT_ID', 'baked-in-id')
    vi.resetModules()
    const { getClientId, clientIdIsFixed } = await import('@/lib/config')
    localStorage.setItem('ph.clientId', 'pasted-id')
    expect(getClientId()).toBe('baked-in-id')
    expect(clientIdIsFixed).toBe(true)
  })

  it('is not fixed when no build-time value is set', async () => {
    const { clientIdIsFixed } = await import('@/lib/config')
    expect(clientIdIsFixed).toBe(false)
  })
})

describe('scopes', () => {
  it('requests streaming plus the two scopes Spotify requires alongside it', async () => {
    const { SCOPES } = await import('@/lib/config')
    const scopes = SCOPES.split(' ')
    expect(scopes).toContain('streaming')
    expect(scopes).toContain('user-read-email')
    expect(scopes).toContain('user-read-private')
  })

  it('does not request any write scope beyond playback control', async () => {
    const { SCOPES } = await import('@/lib/config')
    expect(SCOPES).not.toContain('playlist-modify')
    expect(SCOPES).not.toContain('user-library-modify')
  })
})
