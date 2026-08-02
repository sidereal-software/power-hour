import { act, renderHook } from '@testing-library/react'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ArtBackdrop } from '@/components/art-backdrop'
import { useLocalStorage } from '@/hooks/use-local-storage'
import { DEFAULT_SETTINGS } from '@/lib/settings'

describe('useLocalStorage', () => {
  it('starts from the initial value when storage is empty', () => {
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates', () => {
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    act(() => result.current[1]({ ...DEFAULT_SETTINGS, rounds: 12 }))
    expect(JSON.parse(localStorage.getItem('k')!)).toMatchObject({ rounds: 12 })
  })

  it('rehydrates a previous session', () => {
    localStorage.setItem('k', JSON.stringify({ rounds: 7 }))
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    expect(result.current[0].rounds).toBe(7)
  })

  it('merges over the defaults, so a new setting is not undefined', () => {
    // A build that adds a setting must not read `undefined` from older storage.
    localStorage.setItem('k', JSON.stringify({ rounds: 7 }))
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    expect(result.current[0].chime).toBe(DEFAULT_SETTINGS.chime)
    expect(result.current[0].roundSeconds).toBe(DEFAULT_SETTINGS.roundSeconds)
  })

  it('falls back to defaults when storage holds junk', () => {
    localStorage.setItem('k', 'not json{')
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    expect(result.current[0]).toEqual(DEFAULT_SETTINGS)
  })

  it('survives a write failure such as private mode or a full quota', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const { result } = renderHook(() => useLocalStorage('k', DEFAULT_SETTINGS))
    expect(() => act(() => result.current[1]({ ...DEFAULT_SETTINGS, rounds: 3 }))).not.toThrow()
    expect(result.current[0].rounds).toBe(3)
    setItem.mockRestore()
  })
})

describe('ArtBackdrop', () => {
  it('is hidden from assistive tech', () => {
    const { container } = render(<ArtBackdrop url="" />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
  })

  it('stays transparent with no artwork', () => {
    const { container } = render(<ArtBackdrop url="" />)
    expect(container.querySelector('[data-on="false"]')).toBeInTheDocument()
  })

  it('fades in the album art when a track is playing', () => {
    const { container } = render(<ArtBackdrop url="https://img.test/cover.jpg" />)
    const layer = container.querySelector<HTMLElement>('[data-on="true"]')
    expect(layer).toBeInTheDocument()
    expect(layer!.style.backgroundImage).toContain('https://img.test/cover.jpg')
  })

  it('renders no interactive content', () => {
    render(<ArtBackdrop url="https://img.test/cover.jpg" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})
