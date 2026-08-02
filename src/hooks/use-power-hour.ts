import * as React from 'react'
import { toast } from 'sonner'

import * as api from '@/lib/api'
import * as playback from '@/lib/playback'
import { unlockAudio } from '@/lib/chime'
import { errorMessage } from '@/lib/errors'
import {
  createGame,
  playableTracks,
  type Game,
  type GameStatus,
  type RoundInfo,
  type TickInfo,
} from '@/lib/engine'
import type { GameSettings } from '@/lib/settings'
import type { PlaylistChoice } from '@/lib/spotify-types'

interface LaunchArgs {
  choice: PlaylistChoice
  settings: GameSettings
  market?: string
}

export interface PowerHourState {
  status: GameStatus
  round: RoundInfo | null
  tick: TickInfo | null
  /** Non-null while connecting the player or paging through tracks. */
  loading: string | null
  error: string | null
  trackCount: number
}

const INITIAL: PowerHourState = {
  status: 'idle',
  round: null,
  tick: null,
  loading: null,
  error: null,
  trackCount: 0,
}

export function usePowerHour({ onFinish }: { onFinish: () => void }) {
  const [state, setState] = React.useState<PowerHourState>(INITIAL)
  const gameRef = React.useRef<Game | null>(null)
  // Callbacks are handed to the imperative engine once; a ref keeps the latest
  // onFinish reachable without tearing down and rebuilding the game. Assigned in
  // an effect rather than during render — a render-phase write is not safe under
  // concurrent rendering, which React can discard and replay.
  const finishRef = React.useRef(onFinish)
  React.useEffect(() => {
    finishRef.current = onFinish
  }, [onFinish])

  const patch = React.useCallback(
    (next: Partial<PowerHourState>) => setState((prev) => ({ ...prev, ...next })),
    [],
  )

  const launch = React.useCallback(
    async ({ choice, settings, market }: LaunchArgs) => {
      // Called from a click handler — the gesture browsers require before any
      // audio (ours or the SDK's) is allowed to start.
      unlockAudio()
      setState({ ...INITIAL, loading: 'Starting the Spotify player…' })

      try {
        await playback.connectPlayer({
          onError: (message) => toast.error('Playback', { description: message }),
        })

        patch({ loading: 'Loading tracks…' })
        const onProgress = (n: number) => patch({ loading: `Loading tracks… ${n}` })
        const raw =
          choice.kind === 'liked'
            ? await api.getLikedTracks(market, onProgress)
            : await api.getPlaylistTracks(choice.id, market, onProgress)

        const tracks = playableTracks(raw)
        if (tracks.length === 0) {
          patch({
            loading: null,
            error:
              'No playable tracks in that playlist. Local files and tracks unavailable in your country are skipped.',
          })
          return false
        }

        if (tracks.length < settings.rounds && !settings.allowRepeats) {
          toast.info(`Only ${tracks.length} playable tracks — this run will be shorter.`)
        }

        gameRef.current = createGame({
          tracks,
          roundMs: settings.roundSeconds * 1000,
          totalRounds: settings.rounds,
          chime: settings.chime,
          allowRepeats: settings.allowRepeats,
          on: {
            round: (round) => patch({ round }),
            tick: (tick) => patch({ tick }),
            statusChange: (status) => patch({ status }),
            error: (message) => toast.error('Playback', { description: message }),
            finish: () => finishRef.current(),
          },
        })

        patch({ loading: null, trackCount: tracks.length })
        await gameRef.current.start()
        return true
      } catch (err) {
        patch({ loading: null, error: errorMessage(err) })
        return false
      }
    },
    [patch],
  )

  const togglePause = React.useCallback(async () => {
    const game = gameRef.current
    if (!game) return
    if (game.status === 'playing') await game.pause()
    else if (game.status === 'paused') await game.resume()
  }, [])

  const reroll = React.useCallback(() => void gameRef.current?.reroll(), [])
  const skip = React.useCallback(() => gameRef.current?.skip(), [])

  const stop = React.useCallback(async () => {
    await gameRef.current?.stop()
    gameRef.current = null
    setState(INITIAL)
  }, [])

  // Guard against a reload/close mid-run losing the hour.
  React.useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      const status = gameRef.current?.status
      if (status === 'playing' || status === 'paused') event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return { ...state, launch, togglePause, reroll, skip, stop }
}
