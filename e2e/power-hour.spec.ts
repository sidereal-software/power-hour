import { expect, makeTracks, setShortRun, test } from './fixtures/spotify'

test.beforeEach(async ({ spotify, page }) => {
  await spotify.signIn()
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
})

test.describe('Playlist picker', () => {
  test('lists Liked Songs alongside the account playlists', async ({ page }) => {
    const rows = page.locator('ul li button')
    await expect(rows).toHaveCount(3)
    await expect(rows.first()).toContainText('Liked Songs')
  })

  test('filters playlists by name', async ({ page }) => {
    await page.getByPlaceholder('Filter playlists…').fill('quiet')
    await expect(page.locator('ul li button')).toHaveCount(1)
    await expect(page.locator('ul li button')).toContainText('Quiet Storm')
  })

  test('settings persist across a reload', async ({ page }) => {
    await setShortRun(page)
    await expect(page.getByText('Total run time: 0:25')).toBeVisible()

    await page.reload()
    await expect(page.getByText('Total run time: 0:25')).toBeVisible()
  })

  test('blocks a free account from starting a run', async ({ page, spotify }) => {
    spotify.setUser({ id: 'free-user', display_name: 'Free', country: 'US', product: 'free' })
    await page.reload()

    await expect(page.getByText(/premium required/i)).toBeVisible()
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    await expect(page.getByText(/Spotify Premium required/i)).toBeVisible()
    expect(spotify.playCalls).toHaveLength(0)
  })
})

test.describe('A full run', () => {
  test('plays every round and reaches the victory screen', async ({ page, spotify }) => {
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    await expect(page.getByText(/dropping in at/)).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('round 1 of 5')).toBeVisible()

    // Let the clock — not the Skip button — carry the run to the end.
    await expect(page.getByRole('heading', { name: /passed the Power Hour/i })).toBeVisible({
      timeout: 60_000,
    })
    await expect(page.getByText('5 songs · 5 random timestamps · 0:25')).toBeVisible()

    expect(spotify.playCalls).toHaveLength(5)
    expect(new Set(spotify.playCalls.map((c) => c.uris[0])).size).toBe(5)
    for (const call of spotify.playCalls) {
      expect(call.device).toBe('stub-device')
    }
  })

  test('starts each track at a random, non-zero offset that leaves room for the round', async ({
    page,
    spotify,
  }) => {
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()
    await expect(page.getByRole('heading', { name: /passed the Power Hour/i })).toBeVisible({
      timeout: 60_000,
    })

    const ROUND_MS = 5000
    // Stub durations are deterministic: spotify:track:tN lasts 180s + N seconds.
    const durationOf = (uri: string) => 180_000 + Number(/t(\d+)$/.exec(uri)![1]) * 1000

    for (const call of spotify.playCalls) {
      const duration = durationOf(call.uris[0])
      // Never opens on a cold intro...
      expect(call.position_ms).toBeGreaterThanOrEqual(14_000)
      // ...and never runs off the end of the track mid-round.
      expect(call.position_ms + ROUND_MS).toBeLessThanOrEqual(duration)
    }

    // Random, not a fixed formula.
    const offsets = spotify.playCalls.map((c) => c.position_ms)
    expect(new Set(offsets).size).toBeGreaterThan(1)
  })

  test('"Go again" returns to the picker for another run', async ({ page }) => {
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()
    await expect(page.getByRole('heading', { name: /passed the Power Hour/i })).toBeVisible({
      timeout: 60_000,
    })

    await page.getByRole('button', { name: /go again/i }).click()
    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
  })
})

test.describe('In-game controls', () => {
  test.beforeEach(async ({ page }) => {
    await setShortRun(page)
    // 60s rounds so the clock does not run out mid-assertion.
    const roundLength = page.getByRole('slider', { name: /round length/i })
    await roundLength.focus()
    await page.keyboard.press('End')
    await page.locator('ul li button', { hasText: 'Bangers' }).click()
    await expect(page.getByText(/dropping in at/)).toBeVisible({ timeout: 15_000 })
  })

  test('pause stops the clock and the music together', async ({ page }) => {
    await page.getByRole('button', { name: 'Pause' }).click()
    const frozen = await page.getByRole('timer').textContent()

    await page.waitForTimeout(2000)
    expect(await page.getByRole('timer').textContent()).toBe(frozen)

    const events = await page.evaluate(() => (window as any).__phPlayerEvents as string[])
    expect(events).toContain('pause')
  })

  test('resume restarts the clock without restarting the track', async ({ page, spotify }) => {
    const playsBefore = spotify.playCalls.length
    await page.getByRole('button', { name: 'Pause' }).click()
    await page.getByRole('button', { name: 'Resume' }).click()

    const events = await page.evaluate(() => (window as any).__phPlayerEvents as string[])
    expect(events).toContain('resume')
    expect(spotify.playCalls).toHaveLength(playsBefore)
  })

  test('reroll swaps the song but keeps the round number', async ({ page, spotify }) => {
    const before = await page.getByRole('heading').first().textContent()
    const playsBefore = spotify.playCalls.length

    await page.getByRole('button', { name: /reroll song/i }).click()

    await expect(page.getByRole('heading').first()).not.toHaveText(before!)
    await expect(page.getByText('round 1 of 5')).toBeVisible()
    expect(spotify.playCalls.length).toBe(playsBefore + 1)
    expect(spotify.playCalls.at(-1)!.uris[0]).not.toBe(spotify.playCalls[playsBefore - 1].uris[0])
  })

  test('skip advances the round counter', async ({ page }) => {
    await page.getByRole('button', { name: /skip minute/i }).click()
    await expect(page.getByText('round 2 of 5')).toBeVisible()
  })

  test('mashing skip never lands on a stale round', async ({ page }) => {
    for (let i = 0; i < 3; i++) {
      await page.getByRole('button', { name: /skip minute/i }).click()
    }
    await expect(page.getByText('round 4 of 5')).toBeVisible()
    // The counter must not drift backwards once the in-flight calls settle.
    await page.waitForTimeout(1000)
    await expect(page.getByText('round 4 of 5')).toBeVisible()
  })

  test('the space bar toggles pause', async ({ page }) => {
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('Space')
    await expect(page.getByRole('button', { name: 'Resume' })).toBeVisible()
  })

  test('the volume slider drives the SDK', async ({ page }) => {
    const volume = page.getByRole('slider', { name: /volume/i })
    await volume.focus()
    await page.keyboard.press('ArrowLeft')

    const events = await page.evaluate(() => (window as any).__phPlayerEvents as string[])
    expect(events.some((e) => e.startsWith('volume:'))).toBe(true)
  })

  test('quit stops playback and returns to the picker', async ({ page }) => {
    await page.getByRole('button', { name: /quit/i }).click()
    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
  })
})

test.describe('Cancelling a long load', () => {
  test('a slow playlist can be abandoned and returns to the picker', async ({ page, spotify }) => {
    spotify.stallTrackLoad(20_000)
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    await expect(page.getByText(/Loading tracks/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /cancel/i }).click()

    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
    // Abandoning is a choice, not a failure — no error surface should appear.
    await expect(page.getByText(/Can't start this run/i)).toBeHidden()
    expect(spotify.playCalls).toHaveLength(0)
  })

  test('a second attempt after cancelling still works', async ({ page, spotify }) => {
    spotify.stallTrackLoad(20_000)
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()
    await expect(page.getByText(/Loading tracks/)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /cancel/i }).click()
    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()

    spotify.stallTrackLoad(0)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()
    await expect(page.getByText(/dropping in at/)).toBeVisible({ timeout: 15_000 })
  })
})

test.describe('Failure handling', () => {
  test('recovers from a stale device by transferring playback', async ({ page, spotify }) => {
    spotify.failNextPlay(404, 1)
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    // The retry after the transfer should still get a round on screen.
    await expect(page.getByText(/dropping in at/)).toBeVisible({ timeout: 15_000 })
    // The round renders before the API call resolves, so poll for the retry.
    await expect.poll(() => spotify.playCalls.length, { timeout: 10_000 }).toBeGreaterThan(0)
  })

  test('explains a playlist with nothing playable instead of hanging', async ({
    page,
    spotify,
  }) => {
    spotify.setTracks(makeTracks(5, { is_playable: false }))
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    await expect(page.getByText(/No playable tracks/i)).toBeVisible({ timeout: 15_000 })
    await page.getByRole('button', { name: /back to playlists/i }).click()
    await expect(page.getByRole('heading', { name: 'Choose your playlist' })).toBeVisible()
  })

  test('reports a Premium rejection from the playback API', async ({ page, spotify }) => {
    spotify.failNextPlay(403, 5)
    await setShortRun(page)
    await page.locator('ul li button', { hasText: 'Bangers' }).click()

    await expect(page.getByText(/not Premium/i)).toBeVisible({ timeout: 15_000 })
  })
})
