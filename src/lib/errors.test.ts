import { describe, expect, it } from 'vitest'

import { errorMessage } from '@/lib/errors'

describe('errorMessage', () => {
  it('reads the message off a real Error', () => {
    expect(errorMessage(new Error('Token expired'))).toBe('Token expired')
  })

  it('passes a thrown string straight through', () => {
    expect(errorMessage('Device not found')).toBe('Device not found')
  })

  it('reads message off a plain rejection object', () => {
    // Rejected fetch/SDK payloads are frequently bare objects, not Errors.
    expect(errorMessage({ message: 'Playback failed' })).toBe('Playback failed')
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['an empty Error', new Error('')],
    ['an empty string', ''],
    ['an object with no message', { code: 500 }],
    ['an object with a non-string message', { message: { nested: true } }],
  ])('falls back for %s rather than rendering "undefined"', (_label, thrown) => {
    expect(errorMessage(thrown)).toBe('Something went wrong.')
  })

  it('accepts a caller-supplied fallback', () => {
    expect(errorMessage(null, 'Could not load playlists.')).toBe('Could not load playlists.')
  })
})
