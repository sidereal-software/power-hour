# Power Hour

60 songs. 60 random timestamps. 60 minutes. A Spotify-powered power hour that runs
entirely in the browser — **no backend, no server, no database.** Hosted on GitHub Pages.

Pick one of your Spotify playlists and the app shuffles it, drops into each song at a
random point, plays exactly one minute, rings a chime, and moves on. Do that sixty times
and you have passed the power hour.

Built with **React 19**, **TypeScript 7**, **Vite**, **Tailwind v4**, and **shadcn/ui**.
276 tests (Vitest + Playwright), type-aware linting via **oxlint**, formatting via
**oxfmt**, and CI on every push.

---

## Why this works without a server

| Need                                              | Browser-only solution                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Log in to Spotify without leaking a client secret | **Authorization Code + PKCE** — designed for public clients; no secret exists to protect |
| Play full tracks from a static page               | **Web Playback SDK** — turns the tab into a real Spotify Connect device                  |
| Start a song mid-way through                      | `PUT /v1/me/player/play` with `position_ms`                                              |
| Chime between songs                               | Web Audio API oscillators — synthesised, so there are no audio files to host             |

The Client ID is a public identifier. Nothing secret is ever shipped, and no request
touches a server other than Spotify's own API.

## Requirements

- **Spotify Premium.** The Web Playback SDK refuses to stream on free accounts. This is a
  Spotify restriction with no workaround. (The 30-second `preview_url` fallback that older
  projects used is no longer populated for new apps.)
- **A desktop browser** — Chrome, Edge, Firefox, or Safari. The SDK does not support mobile
  browsers, so phones and tablets can't be the playback device. The app detects this and warns.
- The tab must stay open; it _is_ the speaker. The app takes a screen wake lock where supported.

---

## Setup

### 1. Create a Spotify app

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → **Create app**.
2. Name it anything.
3. Under **Redirect URIs**, add your Pages URL with a trailing slash, exactly:

   ```
   https://<your-username>.github.io/power-hour/
   ```

4. Under **APIs used**, tick **Web API** and **Web Playback SDK**.
5. Save, then copy the **Client ID**.

### 2. Turn on GitHub Pages

**Settings → Pages → Source: GitHub Actions.**

Pushing to `main` then runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds with Vite and publishes `dist/`.

### 3. Wire up the Client ID

Either set a repository variable — **Settings → Secrets and variables → Actions →
Variables** → `VITE_SPOTIFY_CLIENT_ID` — and the workflow bakes it into the build, or skip
it entirely and the site shows a one-time form asking visitors for their own (kept in
`localStorage`). The repository variable is nicer if you're sharing the link.

### 4. Add your friends (important)

New Spotify apps start in **Development Mode**, which only allows **25 users you add by
hand**: Dashboard → your app → **Settings → User Management** → add each person's name and
the email on their Spotify account. Anyone not on that list gets an auth error.

Lifting that cap means applying for Extended Quota Mode. For a party this rarely matters —
audio comes out of one machine anyway, so usually only the host needs to log in.

---

## Local development

```bash
npm install
npm run dev     # http://localhost:5173/
```

Add `http://127.0.0.1:5173/` as a second Redirect URI in the dashboard, and open the app at
that address rather than `localhost`. Spotify requires HTTPS for every redirect URI
**except** loopback, and it must be the literal IP — `http://localhost:5173/` is rejected.

Turn the round length down to 5 seconds in **Settings** when testing so you aren't waiting
a real hour to see the victory screen.

| Script                  | Does                                        |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                    |
| `npm run build`         | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview`       | Serve the production build locally          |
| `npm run typecheck`     | Types only, no build                        |
| `npm run lint`          | ESLint, type-aware                          |
| `npm run format`        | Prettier, write                             |
| `npm test`              | Vitest unit + component suite               |
| `npm run test:coverage` | Vitest with v8 coverage and thresholds      |
| `npm run test:e2e`      | Playwright against the production build     |
| `npm run verify`        | Everything CI runs, in order                |

---

## Testing

| Layer            | Tool                             | What it covers                                                                    |
| ---------------- | -------------------------------- | --------------------------------------------------------------------------------- |
| Unit + component | Vitest + Testing Library (jsdom) | 251 tests: the engine, PKCE auth, the API client, chimes, hooks, and every screen |
| End-to-end       | Playwright (Chromium)            | 25 tests driving the real production bundle against a stubbed Spotify             |

Run a single file or a single case:

```bash
npx vitest run src/lib/engine.test.ts
npx vitest run -t 'never places the same track back to back'
npx playwright test -g 'reroll'
```

The e2e fixture ([`e2e/fixtures/spotify.ts`](e2e/fixtures/spotify.ts)) stubs **only** the
Web Playback SDK script and `api.spotify.com`. Everything below that line — token storage,
the round clock, the UI — is the real application. A full run is exercised end to end on
the clock, not by clicking _Skip_, so the timing logic is genuinely covered.

Coverage thresholds are ratcheted just under what the suite achieves (96% statements,
98% lines), so a regression fails CI instead of sliding quietly.

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs type-check, lint, format
check, unit tests with coverage, and the Playwright suite on every push and pull request.

### Why oxlint instead of ESLint

Type-aware lint rules need a type checker. `typescript-eslint` gets one from TypeScript's
_JavaScript_ API — which **TypeScript 7, the native Go compiler, does not expose**. It
refuses to load on TS 7 with a hard runtime guard, and because `typescript` is a _peer_
dependency there, npm hoists a single copy and no `overrides` trick can hand the linter its
own TypeScript 6.

[oxlint](https://oxc.rs) is written in Rust, and its `--type-aware` mode drives
`oxlint-tsgolint`, which is built on the native compiler and versioned against it. So the
project gets TypeScript 7 _and_ keeps the rules that matter — `no-floating-promises`,
`no-misused-promises`, `no-misused-spread`, `await-thenable`. It is also considerably
faster.

`npm run lint` must keep the `--type-aware` flag; without it those rules silently do not
run. Rule configuration lives in [`.oxlintrc.json`](.oxlintrc.json).

Formatting comes from the same toolchain: **oxfmt** replaces Prettier and covers TS/TSX,
CSS, HTML, JSON, YAML and Markdown. It was migrated with `oxfmt --migrate=prettier`, and
because its output matched Prettier's byte for byte on all 74 files, the switch caused no
reformatting churn. Config lives in [`.oxfmtrc.json`](.oxfmtrc.json); `npm run format:check`
is the gate.

---

## How a round works

```
pick track ──▶ random position_ms ──▶ PUT /me/player/play ──▶ 60s clock
                                                                 │
                        chime ◀── round++ ◀───────────────────────┘
```

- **Random start point** is drawn from `[8% of the song … duration − 65s]`, so a round never
  runs off the end of a track into silence, and never opens on a cold intro.
- **The clock is deadline-based**, comparing against an absolute `performance.now()` target
  rather than accumulating ticks, so background-tab throttling can't make the hour drift.
- **Token refresh is proactive** — access tokens expire after exactly one hour, which is
  precisely the length of the game, so the app refreshes five minutes early rather than
  discovering the problem at minute 59.
- **Short playlists** are handled by reshuffling whole passes, so every song plays once
  before any song repeats, and never twice in a row across the seam.
- **Reroll** guarantees a different, preferably not-yet-played track.
- **A generation counter** drops stale `play()` responses, so mashing _Skip_ can't let an
  older round's request win the race and resurrect a dead round.

### Controls

| Control             | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| **Pause** / `Space` | Stops the music and the clock together                     |
| **Reroll song**     | Swaps in a different track and restarts the current minute |
| **Skip minute**     | Counts the round as done and advances                      |
| **Quit**            | Stops playback, back to the playlist list                  |

### Settings

Round length (5–120s), number of rounds (5–100), chime voice (bell / ding / air horn /
arcade / silent), and whether short playlists may reuse tracks. Settings persist in
`localStorage` between runs.

---

## Project layout

```
index.html                   loads the Spotify SDK, mounts React
src/
  App.tsx                    phase machine: setup → picker → game → victory
  main.tsx
  index.css                  Tailwind v4 + shadcn tokens (Spotify green as --primary)
  components/
    ui/                      shadcn/ui components
    setup-screen.tsx         Client ID + connect
    playlist-picker.tsx      playlist list, filter, premium/mobile warnings
    settings-panel.tsx       round length, count, chime, repeats
    game-screen.tsx          now playing, controls, volume
    victory-screen.tsx
    countdown-ring.tsx       SVG progress ring
    art-backdrop.tsx         blurred album-art wash
  hooks/
    use-power-hour.ts        wraps the engine, exposes React state
    use-local-storage.ts
  test/                      Vitest setup + data factories
  lib/
    config.ts                client ID + scopes + redirect URI normalisation
    auth.ts                  PKCE flow, token storage, silent refresh
    api.ts                   Web API client: 401 refresh, 429 backoff, pagination
    playback.ts              Web Playback SDK wrapper
    chime.ts                 synthesised chimes (Web Audio, no assets)
    engine.ts                queue building, random start points, the round clock
    errors.ts                safe `unknown` → message narrowing for caught errors
    format.ts, settings.ts, spotify-types.ts
  **/*.test.ts(x)            unit + component tests, colocated
e2e/
  fixtures/spotify.ts        Web Playback SDK + Web API stub
  auth.spec.ts               setup, PKCE authorize request, session
  power-hour.spec.ts         picker, a full run, controls, failure handling
```

`src/lib/engine.ts` is deliberately framework-free — React only subscribes to its
callbacks, so the game logic stays testable on its own.

### About the shadcn components

They were vendored in the normal shadcn way (source lives in `src/components/ui/`, yours to
edit). [`components.json`](components.json) is configured, so adding more works as usual:

```bash
npx shadcn@latest add dialog
```

One deviation from upstream: `ui/sonner.tsx` pins `theme="dark"` instead of reading
`next-themes`, since this app is dark-only and doesn't need the extra dependency.

---

## Troubleshooting

| Symptom                                    | Cause                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `INVALID_CLIENT: Invalid redirect URI`     | The dashboard URI doesn't match byte-for-byte. Check the trailing slash. The setup screen prints the exact string to paste. |
| Auth succeeds, playback doesn't start      | Account isn't Premium, or another device grabbed playback — press Resume.                                                   |
| `Timed out waiting for the Spotify player` | Browser blocked the DRM/EME module. Firefox needs DRM playback enabled in Settings.                                         |
| Nothing happens for a friend               | They're not in the app's User Management list (Development Mode's 25-user cap).                                             |
| Blank page after deploy                    | Pages source is still "Deploy from a branch" — switch it to "GitHub Actions".                                               |

## Notes

Tokens live in `localStorage` so a page refresh mid-hour doesn't kill the session. Nothing is
sent anywhere except `accounts.spotify.com` and `api.spotify.com`. **Log out** clears them.

Drink responsibly, or don't drink at all — the timer doesn't care what's in the glass.
