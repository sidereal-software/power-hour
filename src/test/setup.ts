import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, vi } from 'vitest'

/* ── Browser APIs jsdom doesn't implement ──────────────────────────── */

// Radix primitives probe these during layout.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })
}

Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= function hasPointerCapture() {
  return false
}
Element.prototype.setPointerCapture ??= function setPointerCapture() {}
Element.prototype.releasePointerCapture ??= function releasePointerCapture() {}

/* ── Web Audio ─────────────────────────────────────────────────────── */

/** Records every oscillator so chime tests can assert on what was scheduled. */
export interface FakeOscillator {
  type: string
  frequency: { value: number; setValueAtTime: (v: number, t: number) => void }
  started: number | null
  stopped: number | null
  connect: (n: unknown) => unknown
  start: (t: number) => void
  stop: (t: number) => void
}

export const audioLog: { oscillators: FakeOscillator[]; contexts: number } = {
  oscillators: [],
  contexts: 0,
}

class FakeAudioContext {
  state: 'running' | 'suspended' = 'running'
  currentTime = 0
  destination = { name: 'destination' }

  constructor() {
    audioLog.contexts += 1
  }

  resume() {
    this.state = 'running'
    return Promise.resolve()
  }

  createOscillator(): FakeOscillator {
    const osc: FakeOscillator = {
      type: 'sine',
      frequency: {
        value: 0,
        setValueAtTime(v: number) {
          osc.frequency.value = v
        },
      },
      started: null,
      stopped: null,
      connect: (node: unknown) => node,
      start(t: number) {
        osc.started = t
      },
      stop(t: number) {
        osc.stopped = t
      },
    }
    audioLog.oscillators.push(osc)
    return osc
  }

  createGain() {
    return {
      gain: {
        setValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: (node: unknown) => node,
    }
  }
}

globalThis.AudioContext = FakeAudioContext as unknown as typeof AudioContext

/* ── Wake Lock ─────────────────────────────────────────────────────── */

export const wakeLockLog = { requests: 0, releases: 0 }

Object.defineProperty(navigator, 'wakeLock', {
  configurable: true,
  value: {
    request: () => {
      wakeLockLog.requests += 1
      return Promise.resolve({
        release: () => {
          wakeLockLog.releases += 1
          return Promise.resolve()
        },
      })
    },
  },
})

/* ── Per-test hygiene ──────────────────────────────────────────────── */

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  audioLog.oscillators.length = 0
  audioLog.contexts = 0
  wakeLockLog.requests = 0
  wakeLockLog.releases = 0
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
