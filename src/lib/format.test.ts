import { describe, expect, it } from 'vitest'

import { artistsOf, artOf, clock } from '@/lib/format'
import { makeTrack } from '@/test/factories'

describe('clock', () => {
  it.each([
    [0, '0:00'],
    [1000, '0:01'],
    [59_000, '0:59'],
    [60_000, '1:00'],
    [125_000, '2:05'],
    [3_600_000, '1:00:00'],
    [3_661_000, '1:01:01'],
  ])('formats %ims as %s', (ms, expected) => {
    expect(clock(ms)).toBe(expected)
  })

  it('never renders a negative clock', () => {
    expect(clock(-5000)).toBe('0:00')
  })

  it('rounds to the nearest second', () => {
    expect(clock(1499)).toBe('0:01')
    expect(clock(1500)).toBe('0:02')
  })
})

describe('artistsOf', () => {
  it('joins multiple artists', () => {
    const track = makeTrack({ artists: [{ name: 'A' }, { name: 'B' }] })
    expect(artistsOf(track)).toBe('A, B')
  })

  it('is safe with no track', () => {
    expect(artistsOf(null)).toBe('')
    expect(artistsOf(undefined)).toBe('')
  })
})

describe('artOf', () => {
  it('takes the first (largest) image', () => {
    const track = makeTrack({
      album: { name: 'X', images: [{ url: 'big.jpg' }, { url: 'small.jpg' }] },
    })
    expect(artOf(track)).toBe('big.jpg')
  })

  it('returns an empty string when there is no art', () => {
    expect(artOf(makeTrack({ album: { name: 'X', images: [] } }))).toBe('')
    expect(artOf(null)).toBe('')
  })
})
