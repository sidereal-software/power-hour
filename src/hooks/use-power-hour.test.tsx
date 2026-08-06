import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeTracks } from '@/test/factories'
import type { PlaylistChoice } from '@/lib/spotify-types'

vi.mock('@/lib/api', () => ({
  getPlaylistTracks: vi.fn(),
  getLikedTracks: vi.fn(),
  play: vi.fn().mockResolvedValue(null),
  pause: vi.fn().mockResolvedValue(null),
  transferPlayback: vi.fn().mockResolvedValue(null),
  ApiError: class extends Error {},
}))

vi.mock('@/lib/playback', () => ({
  connectPlayer: vi.fn().mockResolvedValue('device-1'),
  getDeviceId: vi.fn(() => 'device-1'),
  pause: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn().mockResolvedValue(undefined),
  setVolume: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
  isMobileBrowser: vi.fn(() => false),
}))

const toastError = vi.fn()
const toastInfo = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    info: (...args: unknown[]) => toastInfo(...args),
  },
}))

import * as api from '@/lib/api'
import * as playback from '@/lib/playback'
import { usePowerHour } from '@/hooks/use-power-hour'

const CHOICE: PlaylistChoice = {
  id: 'pl1',
  kind: 'playlist',
  name: 'Bangers',
  subtitle: '',
  image: '',
  total: 40,
}

const SETTINGS = { roundSeconds: 60, rounds: 3, chime: 'none' as const, allowRepeats: true }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(api.getPlaylistTracks).mockResolvedValue(makeTracks(40))
  vi.mocked(playback.connectPlayer).mockResolvedValue('device-1')
  vi.mocked(playback.getDeviceId).mockReturnValue('device-1')
})

const setup = () => renderHook(() => usePowerHour({ onFinish: vi.fn() }))

describe('usePowerHour', () => {
  it('starts idle with nothing loaded', () => {
    const { result } = setup()
    expect(result.current.status).toBe('idle')
    expect(result.current.round).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('connects the player before requesting tracks', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS, market: 'US' })
    })
    expect(playback.connectPlayer).toHaveBeenCalled()
    const connectOrder = vi.mocked(playback.connectPlayer).mock.invocationCallOrder[0]
    const tracksOrder = vi.mocked(api.getPlaylistTracks).mock.invocationCallOrder[0]
    expect(connectOrder).toBeLessThan(tracksOrder)
  })

  it('passes the account market through to the track request', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS, market: 'GB' })
    })
    expect(api.getPlaylistTracks).toHaveBeenCalledWith(
      'pl1',
      'GB',
      expect.any(Function),
      expect.any(AbortSignal),
    )
  })

  it('reads Liked Songs from the saved-tracks endpoint instead', async () => {
    vi.mocked(api.getLikedTracks).mockResolvedValue(makeTracks(40))
    const { result } = setup()
    await act(async () => {
      await result.current.launch({
        choice: { ...CHOICE, kind: 'liked', id: 'liked' },
        settings: SETTINGS,
        market: 'US',
      })
    })
    expect(api.getLikedTracks).toHaveBeenCalled()
    expect(api.getPlaylistTracks).not.toHaveBeenCalled()
  })

  it('reaches a playing round', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await waitFor(() => expect(result.current.status).toBe('playing'))
    expect(result.current.round?.index).toBe(0)
    expect(result.current.round?.track).toBeDefined()
    expect(result.current.loading).toBeNull()
  })

  it('reports an empty playlist as an error rather than starting', async () => {
    vi.mocked(api.getPlaylistTracks).mockResolvedValue([])
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    expect(result.current.error).toMatch(/No playable tracks/)
    expect(api.play).not.toHaveBeenCalled()
  })

  it('surfaces a connect failure as an error', async () => {
    vi.mocked(playback.connectPlayer).mockRejectedValue(new Error('Timed out'))
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    expect(result.current.error).toBe('Timed out')
  })

  it('warns when a short playlist cannot fill the round count', async () => {
    vi.mocked(api.getPlaylistTracks).mockResolvedValue(makeTracks(2))
    const { result } = setup()
    await act(async () => {
      await result.current.launch({
        choice: CHOICE,
        settings: { ...SETTINGS, rounds: 60, allowRepeats: false },
      })
    })
    expect(toastInfo).toHaveBeenCalledWith(expect.stringContaining('shorter'))
  })

  it('routes engine playback errors to a toast, not a dead screen', async () => {
    vi.mocked(playback.getDeviceId).mockReturnValue(null)
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    expect(result.current.error).toBeNull()
  })

  it('toggles pause and resume', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await waitFor(() => expect(result.current.status).toBe('playing'))

    await act(async () => {
      await result.current.togglePause()
    })
    expect(result.current.status).toBe('paused')

    await act(async () => {
      await result.current.togglePause()
    })
    expect(result.current.status).toBe('playing')
  })

  it('skips to the next round', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await waitFor(() => expect(result.current.round?.index).toBe(0))
    await act(async () => {
      result.current.skip()
      await Promise.resolve()
    })
    await waitFor(() => expect(result.current.round?.index).toBe(1))
  })

  it('calls onFinish when the last round completes', async () => {
    const onFinish = vi.fn()
    const { result } = renderHook(() => usePowerHour({ onFinish }))
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: { ...SETTINGS, rounds: 1 } })
    })
    await act(async () => {
      result.current.skip()
      await Promise.resolve()
    })
    await waitFor(() => expect(onFinish).toHaveBeenCalled())
  })

  it('resets to idle on stop', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await act(async () => {
      await result.current.stop()
    })
    expect(result.current.status).toBe('idle')
    expect(result.current.round).toBeNull()
  })

  it('warns before unload while a run is live', async () => {
    const { result } = setup()
    await act(async () => {
      await result.current.launch({ choice: CHOICE, settings: SETTINGS })
    })
    await waitFor(() => expect(result.current.status).toBe('playing'))

    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('does not warn before unload when idle', () => {
    setup()
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })

  it('removes the unload listener on unmount', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = setup()
    unmount()
    expect(remove).toHaveBeenCalledWith('beforeunload', expect.any(Function))
  })
})
