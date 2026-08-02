import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SetupScreen } from '@/components/setup-screen'

const props = () => ({
  hasClientId: false,
  error: null,
  onSaveClientId: vi.fn(),
  onChangeClientId: vi.fn(),
  onConnect: vi.fn(),
})

describe('SetupScreen — first run', () => {
  it('asks for a Client ID and explains why', () => {
    render(<SetupScreen {...props()} />)
    expect(screen.getByText('One-time setup')).toBeInTheDocument()
    expect(screen.getByText(/no backend/i)).toBeInTheDocument()
  })

  it('shows the exact redirect URI to paste into the dashboard', () => {
    render(<SetupScreen {...props()} />)
    // Byte-for-byte matching means the displayed value must be the real one.
    expect(screen.getByText(window.location.origin + '/')).toBeInTheDocument()
  })

  it('disables save until something is typed', async () => {
    const user = userEvent.setup()
    render(<SetupScreen {...props()} />)
    const save = screen.getByRole('button', { name: /save client id/i })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText(/client id/i), 'abc123')
    expect(save).toBeEnabled()
  })

  it('submits the typed Client ID', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<SetupScreen {...p} />)
    await user.type(screen.getByLabelText(/client id/i), 'my-client-id')
    await user.click(screen.getByRole('button', { name: /save client id/i }))
    expect(p.onSaveClientId).toHaveBeenCalledWith('my-client-id')
  })

  it('ignores a whitespace-only Client ID', async () => {
    const user = userEvent.setup()
    const p = props()
    render(<SetupScreen {...p} />)
    await user.type(screen.getByLabelText(/client id/i), '   ')
    expect(screen.getByRole('button', { name: /save client id/i })).toBeDisabled()
  })

  it('copies the redirect URI to the clipboard', async () => {
    const user = userEvent.setup()
    // userEvent.setup() installs its own clipboard stub, so ours must come after.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    render(<SetupScreen {...props()} />)
    await user.click(screen.getByRole('button', { name: /copy redirect uri/i }))
    expect(writeText).toHaveBeenCalledWith(window.location.origin + '/')
  })

  it('survives a blocked clipboard without crashing', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    render(<SetupScreen {...props()} />)
    await user.click(screen.getByRole('button', { name: /copy redirect uri/i }))
    expect(screen.getByText('One-time setup')).toBeInTheDocument()
  })

  it('links to the Spotify dashboard in a new tab, safely', () => {
    render(<SetupScreen {...props()} />)
    const link = screen.getByRole('link', { name: /spotify developer dashboard/i })
    expect(link).toHaveAttribute('href', 'https://developer.spotify.com/dashboard')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })
})

describe('SetupScreen — configured', () => {
  it('offers to connect', async () => {
    const user = userEvent.setup()
    const p = { ...props(), hasClientId: true }
    render(<SetupScreen {...p} />)
    await user.click(screen.getByRole('button', { name: /connect spotify/i }))
    expect(p.onConnect).toHaveBeenCalled()
  })

  it('states the Premium and desktop requirements up front', () => {
    render(<SetupScreen {...props()} hasClientId />)
    expect(screen.getByText(/premium/i)).toBeInTheDocument()
    expect(screen.getByText(/desktop browser/i)).toBeInTheDocument()
  })

  it('offers an escape hatch back to the Client ID form', async () => {
    const user = userEvent.setup()
    const p = { ...props(), hasClientId: true }
    render(<SetupScreen {...p} />)
    await user.click(screen.getByRole('button', { name: /different client id/i }))
    expect(p.onChangeClientId).toHaveBeenCalled()
  })

  it('shows an auth error when one is passed', () => {
    render(<SetupScreen {...props()} hasClientId error="Authorisation was cancelled." />)
    expect(screen.getByRole('alert')).toHaveTextContent('Authorisation was cancelled.')
  })

  it('shows no alert when there is no error', () => {
    render(<SetupScreen {...props()} hasClientId />)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
