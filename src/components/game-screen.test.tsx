import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/playback', () => ({ setVolume: vi.fn().mockResolvedValue(undefined) }))

import { GameScreen } from '@/components/game-screen'
import { TooltipProvider } from '@/components/ui/tooltip'
import * as playback from '@/lib/playback'
import { makeTrack } from '@/test/factories'
import type { PowerHourState } from '@/hooks/use-power-hour'

const ROUND = 60_000

const state = (overrides: Partial<PowerHourState> = {}): PowerHourState => ({
  status: 'playing',
  round: {
    index: 0,
    total: 60,
    track: makeTrack({ name: 'Blinding Lights', artists: [{ name: 'The Weeknd' }] }),
    positionMs: 90_000,
    roundMs: ROUND,
  },
  tick: {
    remainingMs: 45_000,
    roundMs: ROUND,
    index: 0,
    totalRounds: 60,
    elapsedTotalMs: 15_000,
  },
  loading: null,
  progress: null,
  error: null,
  trackCount: 40,
  ...overrides,
})

const handlers = () => ({
  onTogglePause: vi.fn(),
  onReroll: vi.fn(),
  onSkip: vi.fn(),
  onQuit: vi.fn(),
  onCancelLoad: vi.fn(),
})

const renderScreen = (s = state(), h = handlers()) => {
  const result = render(
    <TooltipProvider>
      <GameScreen {...s} {...h} />
    </TooltipProvider>,
  )
  return { ...result, handlers: h }
}

describe('GameScreen — now playing', () => {
  it('shows the track, artist, and where it dropped in', () => {
    renderScreen()
    expect(screen.getByRole('heading', { name: 'Blinding Lights' })).toBeInTheDocument()
    expect(screen.getByText('The Weeknd')).toBeInTheDocument()
    expect(screen.getByText(/dropping in at 1:30 of 3:30/)).toBeInTheDocument()
  })

  it('counts rounds from one, not zero', () => {
    renderScreen()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('/ 60')).toBeInTheDocument()
  })

  it('shows the seconds remaining in the round', () => {
    renderScreen()
    expect(screen.getByRole('timer')).toHaveTextContent('45')
  })

  it('shows how much of the hour is left', () => {
    renderScreen()
    expect(screen.getByText(/59:45 left · round 1 of 60/)).toBeInTheDocument()
  })

  it('shows a full round before the first tick arrives', () => {
    renderScreen(state({ tick: null }))
    expect(screen.getByRole('timer')).toHaveTextContent('60')
  })
})

describe('GameScreen — controls', () => {
  it('pauses', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen()
    await user.click(screen.getByRole('button', { name: /pause/i }))
    expect(h.onTogglePause).toHaveBeenCalled()
  })

  it('shows Resume while paused', () => {
    renderScreen(state({ status: 'paused' }))
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument()
  })

  it('rerolls and skips through distinct controls', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen()
    await user.click(screen.getByRole('button', { name: /reroll song/i }))
    await user.click(screen.getByRole('button', { name: /skip minute/i }))
    expect(h.onReroll).toHaveBeenCalledTimes(1)
    expect(h.onSkip).toHaveBeenCalledTimes(1)
  })

  it('quits', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen()
    await user.click(screen.getByRole('button', { name: /quit/i }))
    expect(h.onQuit).toHaveBeenCalled()
  })

  it('toggles pause on the space bar', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen()
    document.body.focus()
    await user.keyboard(' ')
    expect(h.onTogglePause).toHaveBeenCalled()
  })

  it('leaves the space bar alone while a control has focus', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen()
    screen.getByRole('button', { name: /quit/i }).focus()
    await user.keyboard(' ')
    // The button's own click fires, but the global shortcut must not double-fire.
    expect(h.onTogglePause).not.toHaveBeenCalled()
  })

  it('pushes volume changes to the SDK', async () => {
    const user = userEvent.setup()
    renderScreen()
    const slider = screen.getByRole('slider', { name: /volume/i })
    slider.focus()
    await user.keyboard('{ArrowLeft}')
    expect(playback.setVolume).toHaveBeenCalled()
  })
})

describe('GameScreen — states', () => {
  it('shows a loading message before the first round', () => {
    renderScreen(state({ round: null, loading: 'Loading tracks…' }))
    expect(screen.getByText(/Loading tracks…/)).toBeInTheDocument()
  })

  it('reports how many tracks have loaded, and out of how many', () => {
    renderScreen(
      state({ round: null, loading: 'Loading tracks…', progress: { loaded: 1200, total: 5000 } }),
    )
    expect(screen.getByText('1,200 of 5,000')).toBeInTheDocument()
  })

  it('still reports progress when the playlist size is unknown', () => {
    renderScreen(state({ round: null, loading: 'Loading tracks…', progress: { loaded: 300 } }))
    expect(screen.getByText('300')).toBeInTheDocument()
    expect(screen.queryByText(/ of /)).not.toBeInTheDocument()
  })

  it('offers a way out of a long load', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen(
      state({ round: null, loading: 'Loading tracks…', progress: { loaded: 900, total: 9000 } }),
    )
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(h.onCancelLoad).toHaveBeenCalled()
  })

  it('shows an error with a way back', async () => {
    const user = userEvent.setup()
    const { handlers: h } = renderScreen(state({ error: 'No playable tracks', round: null }))
    expect(screen.getByRole('alert')).toHaveTextContent('No playable tracks')
    await user.click(screen.getByRole('button', { name: /back to playlists/i }))
    expect(h.onQuit).toHaveBeenCalled()
  })

  it('marks the final seconds as urgent', () => {
    renderScreen(state({ tick: { ...state().tick!, remainingMs: 5000 } }))
    expect(screen.getByRole('timer')).toHaveClass('text-destructive')
  })

  it('is not urgent mid-round', () => {
    renderScreen()
    expect(screen.getByRole('timer')).not.toHaveClass('text-destructive')
  })

  it('scales urgency to short rounds instead of glowing red throughout', () => {
    // A 5s round must not be urgent at 4s left — 10s would cover the whole round.
    renderScreen(
      state({
        round: { ...state().round!, roundMs: 5000 },
        tick: { ...state().tick!, roundMs: 5000, remainingMs: 4000 },
      }),
    )
    expect(screen.getByRole('timer')).not.toHaveClass('text-destructive')
  })

  it('is never urgent while paused', () => {
    renderScreen(state({ status: 'paused', tick: { ...state().tick!, remainingMs: 3000 } }))
    expect(screen.getByRole('timer')).not.toHaveClass('text-destructive')
  })
})
