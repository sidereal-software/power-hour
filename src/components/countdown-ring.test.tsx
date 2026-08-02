import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CountdownRing } from '@/components/countdown-ring'
import { VictoryScreen } from '@/components/victory-screen'

const CIRCUMFERENCE = 2 * Math.PI * 54

const ringFill = (container: HTMLElement) => container.querySelectorAll('circle')[1]

describe('CountdownRing', () => {
  it('shows the seconds remaining', () => {
    render(<CountdownRing progress={0.5} secondsLeft={30} />)
    expect(screen.getByRole('timer')).toHaveTextContent('30')
  })

  it('draws a full ring at the start of a round', () => {
    const { container } = render(<CountdownRing progress={0} secondsLeft={60} />)
    expect(ringFill(container)).toHaveAttribute('stroke-dashoffset', '0')
  })

  it('empties the ring as the round elapses', () => {
    const { container } = render(<CountdownRing progress={1} secondsLeft={0} />)
    expect(Number(ringFill(container).getAttribute('stroke-dashoffset'))).toBeCloseTo(
      CIRCUMFERENCE,
      1,
    )
  })

  it('clamps out-of-range progress rather than overdrawing', () => {
    const { container: under } = render(<CountdownRing progress={-1} secondsLeft={60} />)
    expect(ringFill(under)).toHaveAttribute('stroke-dashoffset', '0')

    const { container: over } = render(<CountdownRing progress={5} secondsLeft={0} />)
    expect(Number(ringFill(over).getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE, 1)
  })

  it('turns the ring red when urgent', () => {
    const { container } = render(<CountdownRing progress={0.9} secondsLeft={5} urgent />)
    expect(ringFill(container)).toHaveClass('stroke-destructive')
  })

  it('stays on brand when not urgent', () => {
    const { container } = render(<CountdownRing progress={0.2} secondsLeft={48} />)
    expect(ringFill(container)).toHaveClass('stroke-primary')
  })
})

describe('VictoryScreen', () => {
  it('celebrates with the run summary', () => {
    render(<VictoryScreen rounds={60} roundMs={60_000} onAgain={() => {}} />)
    expect(screen.getByRole('heading', { name: /passed the power hour/i })).toBeInTheDocument()
    expect(screen.getByText(/60 songs · 60 random timestamps · 1:00:00/)).toBeInTheDocument()
  })

  it('reports a shortened run honestly', () => {
    render(<VictoryScreen rounds={5} roundMs={5000} onAgain={() => {}} />)
    expect(screen.getByText(/5 songs · 5 random timestamps · 0:25/)).toBeInTheDocument()
  })

  it('offers another run', () => {
    render(<VictoryScreen rounds={60} roundMs={60_000} onAgain={() => {}} />)
    expect(screen.getByRole('button', { name: /go again/i })).toBeInTheDocument()
  })
})
