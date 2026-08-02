import * as React from 'react'
import { Heart, LogOut, Music2, Search, Smartphone, TriangleAlert } from 'lucide-react'

import { SettingsPanel } from '@/components/settings-panel'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { isMobileBrowser } from '@/lib/playback'
import type { GameSettings } from '@/lib/settings'
import type { PlaylistChoice, SpotifyUser } from '@/lib/spotify-types'

interface PlaylistPickerProps {
  user: SpotifyUser | null
  playlists: PlaylistChoice[]
  loading: boolean
  error: string | null
  settings: GameSettings
  onSettingsChange: (next: GameSettings) => void
  onPick: (choice: PlaylistChoice) => void
  onSignOut: () => void
}

export function PlaylistPicker({
  user,
  playlists,
  loading,
  error,
  settings,
  onSettingsChange,
  onPick,
  onSignOut,
}: PlaylistPickerProps) {
  const [query, setQuery] = React.useState('')

  const visible = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? playlists.filter((p) => p.name.toLowerCase().includes(q)) : playlists
  }, [playlists, query])

  const notPremium = user && user.product !== 'premium'

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 space-y-5 duration-500">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Choose your playlist</h2>
          <div className="text-muted-foreground mt-1 flex items-center gap-2 text-sm">
            {user?.display_name ?? user?.id}
            {notPremium && <Badge variant="destructive">Premium required</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="sm" onClick={onSignOut}>
          <LogOut /> Log out
        </Button>
      </header>

      {isMobileBrowser() && (
        <Alert variant="destructive">
          <Smartphone />
          <AlertTitle>Mobile browsers can't play</AlertTitle>
          <AlertDescription>
            Spotify's Web Playback SDK has no mobile browser support. Run the power hour from a
            desktop browser.
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter playlists…"
          className="pl-9"
          type="search"
        />
      </div>

      <ScrollArea className="bg-card/50 h-[46vh] min-h-72 rounded-xl border">
        {loading ? (
          <div className="space-y-1 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="size-12 rounded-md" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/5" />
                </div>
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            {query ? `No playlists match "${query}".` : 'No playlists found on this account.'}
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {visible.map((choice) => (
              <li key={`${choice.kind}:${choice.id}`}>
                <button
                  type="button"
                  onClick={() => onPick(choice)}
                  className="hover:bg-accent/50 focus-visible:ring-ring/50 flex w-full items-center gap-3 p-2.5 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-inset"
                >
                  {choice.image ? (
                    <img
                      src={choice.image}
                      alt=""
                      loading="lazy"
                      className="size-12 shrink-0 rounded-md object-cover"
                    />
                  ) : (
                    <div className="bg-muted text-muted-foreground grid size-12 shrink-0 place-items-center rounded-md">
                      {choice.kind === 'liked' ? (
                        <Heart className="fill-primary text-primary size-5" />
                      ) : (
                        <Music2 className="size-5" />
                      )}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{choice.name}</div>
                    <div className="text-muted-foreground truncate text-xs">{choice.subtitle}</div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>

      <SettingsPanel settings={settings} onChange={onSettingsChange} />
    </div>
  )
}
