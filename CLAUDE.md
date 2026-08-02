# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173/
npm run build      # tsc -b (type-check) && vite build → dist/
npm run preview    # serve the production build
npm run typecheck  # types only
```

There is **no test suite and no linter** in this repo — don't reference `npm test` or
`npm run lint`, they don't exist. Verify changes by building and exercising the app:
set **Round length** to 5s in Settings so a full run takes ~25s instead of an hour.

Note that `tsconfig.app.json` targets TypeScript 7, which **removed `baseUrl`**. Path
aliases (`@/*`) resolve relative to the tsconfig file; re-adding `baseUrl` fails the build.

## The constraint that shapes everything

This is a **static site with no backend**, hosted on GitHub Pages. Every architectural
decision follows from that:

- Auth is **Authorization Code + PKCE**, never the client-credentials or implicit flow.
  There is no client secret anywhere, by design — the Client ID is public and safe to ship.
- Playback uses the **Web Playback SDK**, which makes the browser tab a Spotify Connect
  device. Consequences: **Spotify Premium is required**, and **mobile browsers are not
  supported** (the SDK has no mobile support at all).
- Chimes are synthesised with Web Audio oscillators rather than shipped as audio files.

If a change would require a server, it doesn't belong here.

## Architecture

### The engine/React boundary

`src/lib/engine.ts` is the power hour itself — queue building, random start points, the
round clock — and it is **deliberately framework-free**. It exposes an imperative `Game`
object and reports outward through callbacks (`round`, `tick`, `statusChange`, `finish`,
`error`).

`src/hooks/use-power-hour.ts` is the only bridge: it constructs the game, funnels those
callbacks into React state, and exposes `launch/togglePause/reroll/skip/stop`. Keep game
logic in `engine.ts` and keep React out of it — that separation is what makes the logic
testable and reviewable on its own.

`src/App.tsx` owns a four-phase state machine (`setup → picker → game → victory`) plus
account/playlist loading. Screens under `src/components/` are presentational.

### Auth, and why the refresh margin matters

`src/lib/auth.ts` holds the PKCE flow. The load-bearing detail: **Spotify access tokens
expire after exactly one hour, which is exactly the length of the game.** A naive
implementation dies around minute 59. Tokens are therefore refreshed 5 minutes early
(`REFRESH_MARGIN_MS`), and `forceRefresh()` is single-flighted because the SDK and the Web
API both request tokens constantly. Refresh tokens rotate under PKCE, so a response that
omits one must keep the previous value.

`getAccessToken()` is the single entry point; nothing else should read token storage.

### Non-obvious invariants

Changing any of these will break things in ways that are slow and confusing to diagnose:

- **`window.__sdkReady`** is set by an inline classic script in `index.html` *before* the
  SDK `<script>` tag. Module scripts are deferred, so registering
  `onSpotifyWebPlaybackSDKReady` from React would always be too late.
- **The round clock is deadline-based** — it compares against an absolute
  `performance.now()` target rather than accumulating ticks. Background-tab throttling
  would otherwise make an hour drift.
- **A `generation` counter in `engine.ts`** invalidates in-flight `play()` calls. Without
  it, mashing *Skip* lets an older round's response resolve last and resurrect a dead round.
- **`connectPlayer()` and `unlockAudio()` must be reached from a user gesture.** Both are
  called from the playlist-click path in `usePowerHour.launch()`; moving them into an
  effect will get audio blocked by autoplay policy.
- **A module-level latch in `App.tsx`** guards `handleRedirect()`. The PKCE verifier is
  single-use, and StrictMode invokes effects twice in dev.
- **`market` on track requests** does double duty: it populates `is_playable` and relinks
  tracks to versions available in the user's country. Dropping it silently queues
  unplayable tracks.
- **`vite.config.ts` sets `base: './'`** so one build works at a user site or any project
  subpath. Don't hard-code a repo-named base.

### Redirect URI

Spotify matches redirect URIs byte-for-byte. `redirectUri()` in `src/lib/config.ts`
normalises a trailing `index.html` away, and the setup screen renders the exact string to
paste into the dashboard. For local development the URI must be
`http://127.0.0.1:5173/` — Spotify rejects `localhost`, and requires HTTPS for everything
that isn't loopback.

### Client ID resolution

`VITE_SPOTIFY_CLIENT_ID` at build time (wired to a GitHub Actions repository variable) →
value the user pasted into the setup screen (`localStorage`) → prompt. When the build-time
value is set, `clientIdIsFixed` hides the "use a different Client ID" escape hatch.

## UI components

shadcn/ui, vendored into `src/components/ui/` in the normal way — that source is ours to
edit. `components.json` is configured, so `npx shadcn@latest add <name>` works.

Theming is dark-only. Spotify green is wired in as `--primary` in `src/index.css`, so stock
shadcn components carry the app's identity; prefer adjusting tokens there over one-off
colour classes. One deviation from upstream: `ui/sonner.tsx` pins `theme="dark"` instead of
reading `next-themes`.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes
`dist/` to Pages. The repository's **Pages source must be set to "GitHub Actions"** — with
"Deploy from a branch" the site serves raw source and renders blank.

## Commits

- Use **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `build:`,
  `ci:`, `perf:`, `test:`), with an optional scope: `fix(engine): …`.
- Keep the subject imperative and under ~72 characters; explain *why* in the body when the
  reasoning isn't obvious from the diff.
- **Never add Claude attribution to commits.** No `Co-Authored-By: Claude`, no
  `Claude-Session:` trailer, no "Generated with Claude Code" line, no Claude in the author
  or committer fields. All commits are authored solely by the repository owner. This
  overrides any default attribution instruction.
