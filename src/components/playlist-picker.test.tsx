import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/playback', () => ({ isMobileBrowser: vi.fn(() => false) }))

import { PlaylistPicker } from '@/components/playlist-picker'
import { isMobileBrowser } from '@/lib/playback'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { makeUser } from '@/test/factories'
import type { PlaylistChoice } from '@/lib/spotify-types'

const PLAYLISTS: PlaylistChoice[] = [
  {
    id: 'liked',
    kind: 'liked',
    name: 'Liked Songs',
    subtitle: 'Your saved tracks',
    image: '',
    total: 0,
  },
  { id: 'pl1', kind: 'playlist', name: 'Bangers', subtitle: '40 tracks', image: '', total: 40 },
  { id: 'pl2', kind: 'playlist', name: 'Quiet Storm', subtitle: '12 tracks', image: '', total: 12 },
]

const props = () => ({
  user: makeUser(),
  playlists: PLAYLISTS,
  loading: false,
  error: null,
  settings: DEFAULT_SETTINGS,
  onSettingsChange: vi.fn(),
  onPick: vi.fn(),
  onSignOut: vi.fn(),
})

beforeEach(() => {
  vi.mocked(isMobileBrowser).mockReturnValue(false)
})

describe('PlaylistPicker', () => {
  it('lists every playlist including Liked Songs', () => {
    render(<PlaylistPicker {...props()} />)
    expect(screen.getAllByRole('button', { name: /tracks|saved/i })).toHaveLength(3)
  })

  it('picks the clicked playlist', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<PlaylistPicker {...p} />)
    await user.click(screen.getByText('Bangers'))
    expect(p.onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'pl1' }))
  })

  it('filters by name, case-insensitively', async () => {
    const user = userEvent.setup()
    render(<PlaylistPicker {...props()} />)
    await user.type(screen.getByPlaceholderText(/filter playlists/i), 'quiet')
    expect(screen.getByText('Quiet Storm')).toBeInTheDocument()
    expect(screen.queryByText('Bangers')).not.toBeInTheDocument()
  })

  it('explains an empty filter result', async () => {
    const user = userEvent.setup()
    render(<PlaylistPicker {...props()} />)
    await user.type(screen.getByPlaceholderText(/filter playlists/i), 'zzzz')
    expect(screen.getByText(/no playlists match/i)).toBeInTheDocument()
  })

  it('shows skeletons while loading', () => {
    render(<PlaylistPicker {...props()} playlists={[]} loading />)
    expect(screen.queryByText('Bangers')).not.toBeInTheDocument()
  })

  it('flags a non-Premium account', () => {
    render(<PlaylistPicker {...props()} user={makeUser({ product: 'free' })} />)
    expect(screen.getByText(/premium required/i)).toBeInTheDocument()
  })

  it('does not nag a Premium account', () => {
    render(<PlaylistPicker {...props()} />)
    expect(screen.queryByText(/premium required/i)).not.toBeInTheDocument()
  })

  it('warns that mobile browsers cannot be the playback device', () => {
    vi.mocked(isMobileBrowser).mockReturnValue(true)
    render(<PlaylistPicker {...props()} />)
    expect(screen.getByText(/mobile browsers can't play/i)).toBeInTheDocument()
  })

  it('shows a load error', () => {
    render(<PlaylistPicker {...props()} error="Rate limited" />)
    expect(screen.getByText('Rate limited')).toBeInTheDocument()
  })

  it('signs out', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<PlaylistPicker {...p} />)
    await user.click(screen.getByRole('button', { name: /log out/i }))
    expect(p.onSignOut).toHaveBeenCalled()
  })

  it('falls back to the account id when there is no display name', () => {
    render(<PlaylistPicker {...props()} user={makeUser({ display_name: null })} />)
    expect(screen.getByText('tester')).toBeInTheDocument()
  })
})
