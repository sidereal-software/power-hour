/**
 * Synthesised chimes via Web Audio — no audio files to host, and it mixes
 * over the Spotify SDK's own output instead of interrupting it.
 */
let ctx: AudioContext | null = null

/** Create/resume the context. Must be reached from a user gesture at least once. */
export function unlockAudio(): AudioContext {
  ctx ??= new AudioContext()
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

interface ToneOptions {
  type?: OscillatorType
  freq: number
  start: number
  attack: number
  decay: number
  peak: number
}

function tone({ type = 'sine', freq, start, attack, decay, peak }: ToneOptions): void {
  const audio = ctx!
  const osc = audio.createOscillator()
  const gain = audio.createGain()

  osc.type = type
  osc.frequency.setValueAtTime(freq, start)

  gain.gain.setValueAtTime(0.0001, start)
  gain.gain.exponentialRampToValueAtTime(peak, start + attack)
  gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + decay)

  osc.connect(gain).connect(audio.destination)
  osc.start(start)
  osc.stop(start + attack + decay + 0.05)
}

export const CHIMES = {
  /** Struck bell: fundamental plus inharmonic partials, long tail. */
  bell: (now: number) => {
    const partials = [
      { freq: 880, peak: 0.34, decay: 1.9 },
      { freq: 1320, peak: 0.18, decay: 1.4 },
      { freq: 2640, peak: 0.07, decay: 0.9 },
      { freq: 1760, peak: 0.05, decay: 2.4 },
    ]
    for (const p of partials) tone({ ...p, start: now, attack: 0.005 })
  },

  ding: (now: number) => {
    tone({ freq: 1568, peak: 0.32, start: now, attack: 0.004, decay: 0.55 })
    tone({ freq: 3136, peak: 0.09, start: now, attack: 0.004, decay: 0.35 })
  },

  /** Two detuned saw stacks with a short blat, roughly stadium-shaped. */
  airhorn: (now: number) => {
    ;[233, 293, 349].forEach((freq, i) => {
      tone({ type: 'sawtooth', freq, peak: 0.16, start: now + i * 0.004, attack: 0.03, decay: 0.9 })
      tone({ type: 'sawtooth', freq: freq * 1.01, peak: 0.12, start: now, attack: 0.04, decay: 0.9 })
    })
  },

  /** Rising square arpeggio — coin-collect energy. */
  arcade: (now: number) => {
    ;[523, 659, 784, 1047].forEach((freq, i) =>
      tone({ type: 'square', freq, peak: 0.18, start: now + i * 0.075, attack: 0.005, decay: 0.16 }),
    )
  },

  none: () => {},
}

export type ChimeName = keyof typeof CHIMES

export const CHIME_OPTIONS: { value: ChimeName; label: string }[] = [
  { value: 'bell', label: 'Bell' },
  { value: 'ding', label: 'Ding' },
  { value: 'airhorn', label: 'Air horn' },
  { value: 'arcade', label: 'Arcade' },
  { value: 'none', label: 'Silent' },
]

export function playChime(name: ChimeName = 'bell'): void {
  if (name === 'none') return
  try {
    unlockAudio()
    ;(CHIMES[name] ?? CHIMES.bell)(ctx!.currentTime + 0.01)
  } catch {
    /* audio is a nicety; never let it break the timer */
  }
}

/** Short blip for the final-seconds countdown. */
export function playTick(last = false): void {
  try {
    unlockAudio()
    tone({
      type: 'sine',
      freq: last ? 1200 : 800,
      peak: last ? 0.16 : 0.1,
      start: ctx!.currentTime + 0.01,
      attack: 0.004,
      decay: 0.09,
    })
  } catch {
    /* ignore */
  }
}
