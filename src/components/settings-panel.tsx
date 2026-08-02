import { Volume2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { CHIME_OPTIONS, playChime, unlockAudio, type ChimeName } from '@/lib/chime'
import { clock } from '@/lib/format'
import type { GameSettings } from '@/lib/settings'

interface SettingsPanelProps {
  settings: GameSettings
  onChange: (next: GameSettings) => void
}

export function SettingsPanel({ settings, onChange }: SettingsPanelProps) {
  const set = <K extends keyof GameSettings>(key: K, value: GameSettings[K]) =>
    onChange({ ...settings, [key]: value })

  const totalMs = settings.roundSeconds * settings.rounds * 1000

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="round-length">Round length</Label>
            <span className="text-muted-foreground tabular text-sm">
              {settings.roundSeconds}s
            </span>
          </div>
          <Slider
            id="round-length"
            min={5}
            max={120}
            step={5}
            value={[settings.roundSeconds]}
            onValueChange={([v]) => set('roundSeconds', v)}
          />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label htmlFor="round-count">Number of rounds</Label>
            <span className="text-muted-foreground tabular text-sm">{settings.rounds}</span>
          </div>
          <Slider
            id="round-count"
            min={5}
            max={100}
            step={1}
            value={[settings.rounds]}
            onValueChange={([v]) => set('rounds', v)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="chime">Chime</Label>
          <div className="flex items-center gap-2">
            <Select
              value={settings.chime}
              onValueChange={(v) => set('chime', v as ChimeName)}
            >
              <SelectTrigger id="chime" size="sm" className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHIME_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Test chime"
              onClick={() => {
                unlockAudio()
                playChime(settings.chime)
              }}
            >
              <Volume2 />
            </Button>
          </div>
        </div>

        <div className="flex items-start justify-between gap-4">
          <Label htmlFor="allow-repeats" className="flex-1 leading-snug font-normal">
            <span>
              Reuse tracks
              <span className="text-muted-foreground block text-xs">
                When the playlist is shorter than the round count
              </span>
            </span>
          </Label>
          <Switch
            id="allow-repeats"
            checked={settings.allowRepeats}
            onCheckedChange={(v) => set('allowRepeats', v)}
          />
        </div>

        <p className="text-muted-foreground border-t pt-4 text-sm">
          Total run time: <span className="text-foreground tabular font-medium">{clock(totalMs)}</span>
        </p>
      </CardContent>
    </Card>
  )
}
