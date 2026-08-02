import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CHIME_OPTIONS, playChime, playTick, unlockAudio } from '@/lib/chime'
import { audioLog } from '@/test/setup'

beforeEach(() => {
  vi.resetModules()
})

describe('unlockAudio', () => {
  it('reuses a single AudioContext across calls', async () => {
    const chime = await import('@/lib/chime')
    chime.unlockAudio()
    chime.unlockAudio()
    chime.unlockAudio()
    expect(audioLog.contexts).toBe(1)
  })

  it('resumes a context suspended by autoplay policy', () => {
    const ctx = unlockAudio()
    ;(ctx as unknown as { state: string }).state = 'suspended'
    expect(unlockAudio().state).toBe('running')
  })
})

describe('playChime', () => {
  it.each(CHIME_OPTIONS.filter((c) => c.value !== 'none').map((c) => c.value))(
    'schedules oscillators for the %s voice',
    (voice) => {
      playChime(voice)
      expect(audioLog.oscillators.length).toBeGreaterThan(0)
      for (const osc of audioLog.oscillators) {
        expect(osc.started).not.toBeNull()
        expect(osc.stopped).not.toBeNull()
        expect(osc.stopped!).toBeGreaterThan(osc.started!)
      }
    },
  )

  it('makes no sound for the silent voice', () => {
    playChime('none')
    expect(audioLog.oscillators).toHaveLength(0)
  })

  it('layers inharmonic partials for the bell', () => {
    playChime('bell')
    const freqs = audioLog.oscillators.map((o) => o.frequency.value)
    expect(new Set(freqs).size).toBeGreaterThan(2)
  })

  it('rises in pitch for the arcade voice', () => {
    playChime('arcade')
    const freqs = audioLog.oscillators.map((o) => o.frequency.value)
    expect(freqs).toEqual([...freqs].sort((a, b) => a - b))
  })

  it('falls back to the bell for an unknown voice', () => {
    playChime('nonsense' as never)
    expect(audioLog.oscillators.length).toBeGreaterThan(0)
  })

  it('never throws when Web Audio is unavailable', () => {
    const original = globalThis.AudioContext
    // @ts-expect-error deliberately breaking the constructor
    globalThis.AudioContext = undefined
    vi.resetModules()
    expect(() => playChime('bell')).not.toThrow()
    globalThis.AudioContext = original
  })
})

describe('playTick', () => {
  it('plays a short blip', () => {
    playTick()
    expect(audioLog.oscillators).toHaveLength(1)
    const osc = audioLog.oscillators[0]
    expect(osc.stopped! - osc.started!).toBeLessThan(0.3)
  })

  it('uses a higher pitch for the final second', () => {
    playTick(false)
    const normal = audioLog.oscillators[0].frequency.value
    audioLog.oscillators.length = 0
    playTick(true)
    expect(audioLog.oscillators[0].frequency.value).toBeGreaterThan(normal)
  })
})
