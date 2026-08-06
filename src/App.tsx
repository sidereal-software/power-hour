import * as React from 'react'
import { toast } from 'sonner'

import { ArtBackdrop } from '@/components/art-backdrop'
import { GameScreen } from '@/components/game-screen'
import { PlaylistPicker } from '@/components/playlist-picker'
import { SetupScreen } from '@/components/setup-screen'
import { VictoryScreen } from '@/components/victory-screen'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePowerHour } from '@/hooks/use-power-hour'
import { useLocalStorage } from '@/hooks/use-local-storage'
import * as api from '@/lib/api'
import * as auth from '@/lib/auth'
import { clearClientId, getClientId, setClientId } from '@/lib/config'
import { errorMessage } from '@/lib/errors'
import { artOf } from '@/lib/format'
import * as playback from '@/lib/playback'
import { DEFAULT_SETTINGS, SETTINGS_KEY, type GameSettings } from '@/lib/settings'
import { playChime } from '@/lib/chime'
import type { PlaylistChoice, SpotifyUser } from '@/lib/spotify-types'

type Phase = 'booting' | 'setup' | 'picker' | 'game' | 'victory'

/**
 * The redirect can only be consumed once — the PKCE verifier is single-use.
 * A module-level latch keeps StrictMode's double-effect from racing itself.
 */
let redirectHandled: Promise<auth.RedirectResult> | null = null

export default function App() {
  const [phase, setPhase] = React.useState<Phase>('booting')
  const [hasClientId, setHasClientId] = React.useState(() => Boolean(getClientId()))
  const [authError, setAuthError] = React.useState<string | null>(null)

  const [user, setUser] = React.useState<SpotifyUser | null>(null)
  const [playlists, setPlaylists] = React.useState<PlaylistChoice[]>([])
  const [playlistsLoading, setPlaylistsLoading] = React.useState(false)
  const [pickerError, setPickerError] = React.useState<string | null>(null)

  const [settings, setSettings] = useLocalStorage<GameSettings>(SETTINGS_KEY, DEFAULT_SETTINGS)
  const [lastRun, setLastRun] = React.useState({ rounds: 60, roundMs: 60000 })

  const game = usePowerHour({
    onFinish: () => {
      playChime('arcade')
      setPhase('victory')
    },
  })

  /* ── Load the account + playlists ────────────────────────────────── */

  const loadLibrary = React.useCallback(async () => {
    setPlaylistsLoading(true)
    setPickerError(null)
    try {
      const me = await api.getMe()
      setUser(me)

      const raw = await api.getMyPlaylists()
      setPlaylists([
        {
          id: 'liked',
          kind: 'liked',
          name: 'Liked Songs',
          subtitle: 'Your saved tracks',
          image: '',
          total: 0,
        },
        ...raw.map<PlaylistChoice>((p) => ({
          id: p.id,
          kind: 'playlist',
          name: p.name || 'Untitled playlist',
          // Only claim a size when the API actually reported one — "? tracks"
          // is noise, and the real count shows on the loading screen anyway.
          subtitle: [
            typeof p.tracks?.total === 'number'
              ? `${p.tracks.total.toLocaleString()} tracks`
              : null,
            p.owner?.display_name,
          ]
            .filter(Boolean)
            .join(' · '),
          image: p.images?.[0]?.url ?? '',
          total: p.tracks?.total ?? 0,
        })),
      ])
    } catch (err) {
      setPickerError(errorMessage(err))
    } finally {
      setPlaylistsLoading(false)
    }
  }, [])

  /* ── Boot ────────────────────────────────────────────────────────── */

  React.useEffect(() => {
    let cancelled = false

    async function boot() {
      if (!getClientId()) {
        if (!cancelled) setPhase('setup')
        return
      }
      try {
        redirectHandled ??= auth.handleRedirect()
        const result = await redirectHandled
        if (cancelled) return
        if (result === 'denied') {
          setAuthError('Spotify authorisation was cancelled.')
          setPhase('setup')
          return
        }
      } catch (err) {
        if (cancelled) return
        setAuthError(errorMessage(err))
        setPhase('setup')
        return
      }

      if (auth.isLoggedIn()) {
        setPhase('picker')
        void loadLibrary()
      } else {
        setPhase('setup')
      }
    }

    void boot()
    return () => {
      cancelled = true
    }
  }, [loadLibrary])

  /* ── Actions ─────────────────────────────────────────────────────── */

  const handleSaveClientId = (id: string) => {
    setClientId(id)
    setHasClientId(true)
    setAuthError(null)
  }

  const handleChangeClientId = () => {
    clearClientId()
    auth.logout()
    setHasClientId(false)
    setAuthError(null)
  }

  const handleConnect = async () => {
    try {
      await auth.login()
    } catch (err) {
      setAuthError(errorMessage(err))
    }
  }

  const handleSignOut = () => {
    auth.logout()
    playback.disconnect()
    setUser(null)
    setPlaylists([])
    setPhase('setup')
  }

  const handlePick = async (choice: PlaylistChoice) => {
    if (user && user.product !== 'premium') {
      toast.error('Spotify Premium required', {
        description: 'The Web Playback SDK will not stream on a free account.',
      })
      return
    }
    setLastRun({ rounds: settings.rounds, roundMs: settings.roundSeconds * 1000 })
    setPhase('game')
    await game.launch({ choice, settings, market: user?.country })
  }

  const handleQuit = async () => {
    await game.stop()
    setPhase('picker')
  }

  /* ── Render ──────────────────────────────────────────────────────── */

  return (
    <TooltipProvider>
      <ArtBackdrop url={phase === 'game' ? artOf(game.round?.track) : ''} />

      <div className="flex min-h-dvh flex-col">
        <main className="mx-auto w-full max-w-2xl flex-1 px-5 pt-8 pb-4">
          {phase === 'booting' && null}

          {phase === 'setup' && (
            <SetupScreen
              hasClientId={hasClientId}
              error={authError}
              onSaveClientId={handleSaveClientId}
              onChangeClientId={handleChangeClientId}
              onConnect={() => void handleConnect()}
            />
          )}

          {phase === 'picker' && (
            <PlaylistPicker
              user={user}
              playlists={playlists}
              loading={playlistsLoading}
              error={pickerError}
              settings={settings}
              onSettingsChange={setSettings}
              onPick={(choice) => void handlePick(choice)}
              onSignOut={handleSignOut}
            />
          )}

          {phase === 'game' && (
            <GameScreen
              {...game}
              onTogglePause={() => void game.togglePause()}
              onReroll={game.reroll}
              onSkip={game.skip}
              onQuit={() => void handleQuit()}
              onCancelLoad={() => {
                game.cancelLoad()
                void handleQuit()
              }}
            />
          )}

          {phase === 'victory' && (
            <VictoryScreen
              rounds={lastRun.rounds}
              roundMs={lastRun.roundMs}
              onAgain={() => void handleQuit()}
            />
          )}
        </main>

        <footer className="text-muted-foreground/60 p-4 text-center text-xs">
          Runs entirely in your browser · no server, no data collected
        </footer>
      </div>

      <Toaster position="top-center" richColors />
    </TooltipProvider>
  )
}
