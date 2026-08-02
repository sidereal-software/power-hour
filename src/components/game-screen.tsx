import * as React from 'react'
import { Dices, LogOut, Pause, Play, SkipForward, TriangleAlert, Volume1, Volume2 } from 'lucide-react'

import { CountdownRing } from '@/components/countdown-ring'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { artistsOf, artOf, clock } from '@/lib/format'
import * as playback from '@/lib/playback'
import type { PowerHourState } from '@/hooks/use-power-hour'

interface GameScreenProps extends PowerHourState {
  onTogglePause: () => void
  onReroll: () => void
  onSkip: () => void
  onQuit: () => void
}

export function GameScreen({
  status,
  round,
  tick,
  loading,
  error,
  onTogglePause,
  onReroll,
  onSkip,
  onQuit,
}: GameScreenProps) {
  const [volume, setVolume] = React.useState(80)

  const roundMs = round?.roundMs ?? 60000
  const totalRounds = round?.total ?? 60
  // Before the first tick, show a full round rather than a stale value.
  const remainingMs = tick?.remainingMs ?? roundMs
  const elapsedTotalMs = tick?.elapsedTotalMs ?? (round?.index ?? 0) * roundMs
  const totalMs = roundMs * totalRounds

  const secondsLeft = Math.max(0, Math.ceil(remainingMs / 1000))
  const paused = status === 'paused'
  // 10s on a full-length round, but never more than a quarter of a short one —
  // otherwise a 5-second test round is red end to end.
  const urgentBelow = Math.max(1, Math.min(10, Math.floor(roundMs / 4000)))

  // Space toggles pause, unless focus is inside a control.
  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      const tag = (document.activeElement as HTMLElement | null)?.tagName
      if (tag && ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(tag)) return
      event.preventDefault()
      onTogglePause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onTogglePause])

  if (error) {
    return (
      <div className="animate-in fade-in space-y-4 duration-500">
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Can't start this run</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" onClick={onQuit}>
          Back to playlists
        </Button>
      </div>
    )
  }

  if (loading || !round) {
    return (
      <div className="animate-in fade-in space-y-6 pt-10 duration-500">
        <div className="flex items-center gap-4">
          <Skeleton className="size-24 rounded-lg" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="mx-auto aspect-square w-[min(17rem,62vw)] rounded-full" />
        <p className="text-muted-foreground text-center text-sm">{loading ?? 'Getting ready…'}</p>
      </div>
    )
  }

  const art = artOf(round.track)

  return (
    <div className="animate-in fade-in duration-500">
      <div className="mb-6 flex items-center gap-5">
        <div className="tabular shrink-0">
          <span className="text-4xl font-extrabold tracking-tighter">{round.index + 1}</span>
          <span className="text-muted-foreground ml-1 text-base">/ {totalRounds}</span>
        </div>
        <div className="flex-1 space-y-1.5">
          <Progress value={(elapsedTotalMs / totalMs) * 100} />
          <p className="text-muted-foreground tabular text-xs">
            {clock(totalMs - elapsedTotalMs)} left · round {round.index + 1} of {totalRounds}
          </p>
        </div>
      </div>

      <div className="mb-7 flex items-center gap-4 max-sm:flex-col max-sm:text-center">
        {art ? (
          <img
            src={art}
            alt=""
            className="size-24 shrink-0 rounded-lg object-cover shadow-2xl shadow-black/60"
          />
        ) : (
          <div className="bg-muted size-24 shrink-0 rounded-lg" />
        )}
        <div className="min-w-0">
          <h2 className="truncate text-xl font-bold tracking-tight">{round.track.name}</h2>
          <p className="text-muted-foreground truncate">{artistsOf(round.track)}</p>
          <p className="text-muted-foreground/80 tabular mt-1 text-xs">
            dropping in at {clock(round.positionMs)} of {clock(round.track.duration_ms)}
          </p>
        </div>
      </div>

      <CountdownRing
        progress={1 - remainingMs / roundMs}
        secondsLeft={secondsLeft}
        urgent={secondsLeft <= urgentBelow && !paused}
        className="mb-7"
      />

      <div className="mb-5 flex flex-wrap justify-center gap-2">
        <Button variant={paused ? 'default' : 'secondary'} onClick={onTogglePause}>
          {paused ? <Play /> : <Pause />}
          {paused ? 'Resume' : 'Pause'}
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" onClick={onReroll}>
              <Dices /> Reroll song
            </Button>
          </TooltipTrigger>
          <TooltipContent>New song, same minute</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="secondary" onClick={onSkip}>
              <SkipForward /> Skip minute
            </Button>
          </TooltipTrigger>
          <TooltipContent>Counts this round as done</TooltipContent>
        </Tooltip>

        <Button variant="ghost" onClick={onQuit}>
          <LogOut /> Quit
        </Button>
      </div>

      <div className="text-muted-foreground mx-auto flex max-w-64 items-center gap-3">
        <Volume1 className="size-4 shrink-0" />
        <Slider
          min={0}
          max={100}
          value={[volume]}
          aria-label="Volume"
          onValueChange={([v]) => {
            setVolume(v)
            void playback.setVolume(v / 100)
          }}
        />
        <Volume2 className="size-4 shrink-0" />
      </div>
    </div>
  )
}
