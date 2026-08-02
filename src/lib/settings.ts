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
