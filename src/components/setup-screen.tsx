import * as React from 'react'
import { ExternalLink, Copy, Check, Music4, TriangleAlert } from 'lucide-react'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { clientIdIsFixed, redirectUri } from '@/lib/config'

interface SetupScreenProps {
  hasClientId: boolean
  error: string | null
  onSaveClientId: (id: string) => void
  onChangeClientId: () => void
  onConnect: () => void
}

export function SetupScreen({
  hasClientId,
  error,
  onSaveClientId,
  onChangeClientId,
  onConnect,
}: SetupScreenProps) {
  const [draft, setDraft] = React.useState('')
  const [copied, setCopied] = React.useState(false)
  const uri = redirectUri()

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(uri)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* clipboard blocked — the URI is selectable on screen anyway */
    }
  }

  return (
    <div className="animate-in fade-in slide-in-from-bottom-3 duration-500">
      <header className="mt-[6vh] mb-8 text-center">
        <h1 className="text-[clamp(2.6rem,11vw,4.4rem)] leading-none font-extrabold tracking-tighter">
          Power<span className="text-primary">Hour</span>
        </h1>
        <p className="text-muted-foreground mt-3 text-xs tracking-[0.18em] uppercase">
          60 songs · 60 random timestamps · 60 minutes
        </p>
      </header>

      <Card>
        {hasClientId ? (
          <>
            <CardHeader>
              <CardTitle>Ready when you are</CardTitle>
              <CardDescription>
                You'll sign in on Spotify's own page — this site never sees your password, and it
                plays from your own account and playlists.
              </CardDescription>
              <CardDescription>
                Requires Spotify Premium and a desktop browser. Playback happens in this tab.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button size="xl" className="w-full" onClick={onConnect}>
                <Music4 /> Connect Spotify
              </Button>
              {!clientIdIsFixed && (
                <Button variant="link" size="sm" className="w-full" onClick={onChangeClientId}>
                  Use a different Client ID
                </Button>
              )}
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>One-time setup</CardTitle>
              <CardDescription>
                This site has no backend, so it needs your own Spotify app's Client ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <ol className="text-muted-foreground list-decimal space-y-2 pl-5 text-sm">
                <li>
                  Open the{' '}
                  <a
                    className="text-primary inline-flex items-center gap-1 underline underline-offset-4"
                    href="https://developer.spotify.com/dashboard"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Spotify Developer Dashboard <ExternalLink className="size-3" />
                  </a>{' '}
                  and create an app.
                </li>
                <li>
                  Tick <strong className="text-foreground">Web API</strong> and{' '}
                  <strong className="text-foreground">Web Playback SDK</strong>.
                </li>
                <li>Add this exact Redirect URI:</li>
              </ol>

              <div className="flex items-center gap-2">
                <code className="bg-input/40 text-primary min-w-0 flex-1 truncate rounded-md border px-3 py-2 text-xs">
                  {uri}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void copy()}
                  aria-label="Copy redirect URI"
                >
                  {copied ? <Check className="text-primary" /> : <Copy />}
                </Button>
              </div>

              <Separator />

              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault()
                  onSaveClientId(draft)
                }}
              >
                <Label htmlFor="client-id">Client ID</Label>
                <Input
                  id="client-id"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="e.g. 4f2a9c1b8e7d4a6f9c3b2e1d0a5f8c7b"
                  autoComplete="off"
                  spellCheck={false}
                />
                <Button type="submit" className="w-full" disabled={!draft.trim()}>
                  Save Client ID
                </Button>
              </form>
            </CardContent>
          </>
        )}
      </Card>

      {error && (
        <Alert variant="destructive" className="mt-4">
          <TriangleAlert />
          <AlertTitle>Couldn't connect</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="text-muted-foreground mt-8 space-y-2 text-sm">
        <p className="text-foreground font-medium">How it works</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Pick a playlist. We shuffle it and draw 60 tracks.</li>
          <li>Each track starts at a random point in the song.</li>
          <li>After 60 seconds a chime rings and the next song takes over.</li>
          <li>Survive all 60 rounds and you have passed the power hour.</li>
        </ol>
        <p className="pt-2 text-xs">
          Drink responsibly, or don't drink at all — the timer doesn't care what's in the glass.
        </p>
      </div>
    </div>
  )
}
