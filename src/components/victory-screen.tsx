import { PartyPopper, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { clock } from '@/lib/format'

interface VictoryScreenProps {
  rounds: number
  roundMs: number
  onAgain: () => void
}

export function VictoryScreen({ rounds, roundMs, onAgain }: VictoryScreenProps) {
  return (
    <div className="animate-in fade-in zoom-in-95 py-[8vh] text-center duration-700">
      <PartyPopper className="text-primary mx-auto mb-6 size-14" />
      <h1 className="from-primary via-primary bg-gradient-to-r to-emerald-200 bg-clip-text text-[clamp(2rem,8vw,3.2rem)] leading-tight font-extrabold tracking-tight text-transparent">
        You passed the Power Hour
      </h1>
      <p className="text-muted-foreground mt-5 mb-8">
        {rounds} songs · {rounds} random timestamps · {clock(rounds * roundMs)} on the clock.
      </p>
      <Button size="xl" className="mx-auto w-full max-w-xs" onClick={onAgain}>
        <RotateCcw /> Go again
      </Button>
    </div>
  )
}
