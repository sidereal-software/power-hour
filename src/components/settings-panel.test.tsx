import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from '@/components/settings-panel'
import { DEFAULT_SETTINGS } from '@/lib/settings'
import { audioLog } from '@/test/setup'

const renderPanel = (settings = DEFAULT_SETTINGS) => {
  const onChange = vi.fn()
  render(<SettingsPanel settings={settings} onChange={onChange} />)
  return { onChange }
}

describe('SettingsPanel', () => {
  it('shows the current round length and count', () => {
    renderPanel()
    expect(screen.getByText('60s')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
  })

  it('computes the total run time', () => {
    renderPanel()
    expect(screen.getByText('1:00:00')).toBeInTheDocument()
  })

  it('recomputes the total for a short test run', () => {
    renderPanel({ ...DEFAULT_SETTINGS, roundSeconds: 5, rounds: 5 })
    expect(screen.getByText('0:25')).toBeInTheDocument()
  })

  it('changes round length in 5-second steps', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPanel()
    const slider = screen.getAllByRole('slider')[0]
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roundSeconds: 65 }))
  })

  it('changes the round count in single steps', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPanel()
    const slider = screen.getAllByRole('slider')[1]
    slider.focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ rounds: 61 }))
  })

  it('clamps the round length to its minimum', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPanel()
    screen.getAllByRole('slider')[0].focus()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ roundSeconds: 5 }))
  })

  it('toggles track reuse', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPanel()
    await user.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ allowRepeats: false }))
  })

  it('previews the selected chime', async () => {
    const user = userEvent.setup()
    renderPanel()
    await user.click(screen.getByRole('button', { name: /test chime/i }))
    expect(audioLog.oscillators.length).toBeGreaterThan(0)
  })

  it('makes no sound when previewing the silent option', async () => {
    const user = userEvent.setup()
    renderPanel({ ...DEFAULT_SETTINGS, chime: 'none' })
    await user.click(screen.getByRole('button', { name: /test chime/i }))
    expect(audioLog.oscillators).toHaveLength(0)
  })

  it('shows the selected chime name', () => {
    renderPanel({ ...DEFAULT_SETTINGS, chime: 'airhorn' })
    expect(screen.getByText('Air horn')).toBeInTheDocument()
  })
})
