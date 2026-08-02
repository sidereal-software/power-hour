import { expect, test } from './fixtures/spotify'

test.describe('First-run setup', () => {
  test.beforeEach(async ({ page }) => {
    // Start with no Client ID at all.
    await page.addInitScript(() => localStorage.removeItem('ph.clientId'))
  })

  test('asks for a Client ID and shows the exact redirect URI', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByText('One-time setup')).toBeVisible()
    await expect(page.locator('code')).toHaveText(new URL(page.url()).origin + '/')
  })

  test('accepting a Client ID reveals the connect button', async ({ page }) => {
    await page.goto('/')

    await page.getByLabel('Client ID').fill('typed-client-id')
    await page.getByRole('button', { name: 'Save Client ID' }).click()

    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible()
    await expect(page.getByText('One-time setup')).toBeHidden()
  })
})

test.describe('Configured but signed out', () => {
  test('states the Premium and desktop requirements before connecting', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText(/Spotify Premium and a desktop browser/i)).toBeVisible()
  })
})

test.describe('PKCE authorization request', () => {
  test('redirects to Spotify with a correctly formed PKCE challenge', async ({ page }) => {
    await page.route('https://accounts.spotify.com/**', (route) => route.abort())
    await page.goto('/')
    // Capture the origin before the click — the redirect navigates the page away.
    const appOrigin = new URL(page.url()).origin

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().startsWith('https://accounts.spotify.com/authorize')),
      page.getByRole('button', { name: 'Connect Spotify' }).click(),
    ])

    const url = new URL(request.url())
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    // base64url of a SHA-256 digest, unpadded.
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9\-_]{43}$/)
    expect(url.searchParams.get('state')).toBeTruthy()
    expect(url.searchParams.get('client_id')).toBe('e2e-client-id')

    // The redirect URI must match what the setup screen told the user to paste.
    expect(url.searchParams.get('redirect_uri')).toBe(appOrigin + '/')

    // A public client must never ship a secret.
    expect(url.searchParams.get('client_secret')).toBeNull()
  })

  test('requests the scopes the SDK and picker need', async ({ page }) => {
    await page.route('https://accounts.spotify.com/**', (route) => route.abort())
    await page.goto('/')

    const [request] = await Promise.all([
      page.waitForRequest((r) => r.url().startsWith('https://accounts.spotify.com/authorize')),
      page.getByRole('button', { name: 'Connect Spotify' }).click(),
    ])

    const scopes = new URL(request.url()).searchParams.get('scope')!.split(' ')
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
})

test.describe('Session', () => {
  test('an existing session skips setup and lands on the picker', async ({ page, spotify }) => {
    await spotify.signIn()
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
  })

  test('logging out returns to setup and clears the session', async ({ page, spotify }) => {
    await spotify.signIn()
    await page.goto('/')
    await page.getByRole('button', { name: /log out/i }).click()

    await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('ph.tokens'))).toBeNull()
  })
})
