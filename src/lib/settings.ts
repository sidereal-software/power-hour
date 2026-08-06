import type { ChimeName } from './chime'

export interface GameSettings {
  roundSeconds: number
  rounds: number
  chime: ChimeName
  allowRepeats: boolean
}

export const DEFAULT_SETTINGS: GameSettings = {
  roundSeconds: 60,
  rounds: 60,
  chime: 'bell',
  allowRepeats: true,
}

export const SETTINGS_KEY = 'ph.settings'

/**
 * Above this many tracks the loader samples random pages rather than reading a
 * playlist front to back. A thousand candidates is far more than sixty rounds
 * need, and it turns a fifty-request wait into a handful.
 */
export const MAX_POOL_TRACKS = 1000
