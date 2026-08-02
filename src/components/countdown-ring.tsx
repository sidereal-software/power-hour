import { cn } from '@/lib/utils'

const RADIUS = 54
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

interface CountdownRingProps {
  /** 0 → 1, how much of the round has elapsed. */
  progress: number
  secondsLeft: number
  urgent?: boolean
  className?: string
}

export function CountdownRing({ progress, secondsLeft, urgent, className }: CountdownRingProps) {
  return (
    <div className={cn('relative mx-auto w-[min(17rem,62vw)]', className)}>
      <svg viewBox="0 0 120 120" className="h-auto w-full -rotate-90" aria-hidden="true">
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          className="stroke-primary/15"
        />
        <circle
          cx="60"
          cy="60"
          r={RADIUS}
          fill="none"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * Math.min(1, Math.max(0, progress))}
          className={cn(
            'transition-[stroke-dashoffset,stroke] duration-200 ease-linear',
            urgent ? 'stroke-destructive' : 'stroke-primary',
          )}
        />
      </svg>
      <div
        role="timer"
        aria-live="off"
        className={cn(
          'tabular absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[clamp(3rem,15vw,4.5rem)] leading-none font-extrabold tracking-tighter',
          urgent && 'text-destructive animate-pulse',
        )}
      >
        {secondsLeft}
      </div>
    </div>
  )
}
