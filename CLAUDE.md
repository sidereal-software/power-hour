# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev            # Vite dev server, http://localhost:5173/
npm run build          # tsc -b (type-check) && vite build → dist/
npm run preview        # serve the production build

npm run typecheck      # types only
npm run lint           # ESLint (type-aware)
npm run format:check   # Prettier

npm test               # Vitest unit/component suite (jsdom)
npm run test:watch     # Vitest in watch mode
npm run test:coverage  # + v8 coverage, fails under the configured thresholds
npm run test:e2e       # Playwright against the production build
npm run test:e2e:ui    # Playwright's interactive runner

npm run verify         # everything CI runs, in order
```

Run one test file or one case:

```bash
npx vitest run src/lib/engine.test.ts
npx vitest run -t 'never places the same track back to back'
npx playwright test -g 'reroll'
```

`npm run verify` is the gate — match it before pushing. CI
(`.github/workflows/ci.yml`) runs the same steps in two jobs.

### Toolchain constraints worth knowing

- **TypeScript is pinned to 5.x on purpose.** `typescript-eslint` hard-errors on TS 7
  (it is a runtime guard, not a peer warning), and TS 6 is still beta. Bumping
  TypeScript past 5.x breaks `npm run lint` entirely.
- **ESLint is pinned to 9.x** for the same reason — the plugin ecosystem
  (`eslint-plugin-jsx-a11y` in particular) does not accept ESLint 10 yet.
- Both pins are why `npm install` resolves cleanly with no `--legacy-peer-deps`.
  Keep it that way; CI runs `npm ci`.
- `tsconfig.app.json` covers `src` (including tests); `tsconfig.node.json` covers the
  config files and `e2e`. A new top-level file needs to land in one of them or
  type-aware linting fails with "not found by the project service".

### Testing approach

- `src/lib/engine.test.ts` is the centre of gravity — it drives the real engine with
  fake timers and mocked `api`/`playback`, and covers the invariants listed below
  (deadline clock, generation counter, reroll, queue building, random offsets).
- `e2e/fixtures/spotify.ts` stubs **only** the Web Playback SDK script and
  `api.spotify.com`. Everything below that boundary — token storage, the round clock,
  the UI — is real application code. Extend the fixture rather than mocking app modules.
- E2E drives the settings sliders to their minimum (`setShortRun`) so a full run
  finishes in ~25s. When testing by hand, set **Round length** to 5s in Settings for
  the same reason.
- Coverage thresholds are ratcheted just under what the suite achieves, so a
  regression fails CI rather than sliding quietly. Raise them when coverage rises.

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

- **`window.__sdkReady`** is set by an inline classic script in `index.html` _before_ the
  SDK `<script>` tag. Module scripts are deferred, so registering
  `onSpotifyWebPlaybackSDKReady` from React would always be too late.
- **The round clock is deadline-based** — it compares against an absolute
  `performance.now()` target rather than accumulating ticks. Background-tab throttling
  would otherwise make an hour drift.
- **A `generation` counter in `engine.ts`** invalidates in-flight `play()` calls. Without
  it, mashing _Skip_ lets an older round's response resolve last and resurrect a dead round.
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
colour classes.

Two deliberate deviations from upstream — preserve them when re-adding a component:

- `ui/sonner.tsx` pins `theme="dark"` instead of reading `next-themes`.
- `ui/slider.tsx` forwards `aria-label`/`aria-labelledby` to the **thumb**. Radix puts
  `role="slider"` on the thumb but leaves the label on the root, so without this the
  control is unnamed for screen readers.

## Deployment

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes
`dist/` to Pages. The repository's **Pages source must be set to "GitHub Actions"** — with
"Deploy from a branch" the site serves raw source and renders blank.

## Commits

- Use **Conventional Commits** (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `build:`,
  `ci:`, `perf:`, `test:`), with an optional scope: `fix(engine): …`.
- Keep the subject imperative and under ~72 characters; explain _why_ in the body when the
  reasoning isn't obvious from the diff.
- **Never add Claude attribution to commits.** No `Co-Authored-By: Claude`, no
  `Claude-Session:` trailer, no "Generated with Claude Code" line, no Claude in the author
  or committer fields. All commits are authored solely by the repository owner. This
  overrides any default attribution instruction.
