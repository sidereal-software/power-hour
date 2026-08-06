# Power Hour

60 songs. 60 random timestamps. 60 minutes.

Pick one of your Spotify playlists and the app shuffles it, drops into each song at a
random point, plays exactly one minute, rings a chime, and moves on. Do that sixty times
and you have passed the power hour.

It runs **entirely in your browser** — no backend, no server, no database — and is hosted
free on GitHub Pages.

> **You need Spotify Premium and a desktop browser.** Both are hard requirements; see
> [Before you start](#before-you-start).

---

- [For users](#for-users) — get it running and play
- [For developers](#for-developers) — work on the code

---

# For users

## Before you start

| Requirement            | Why                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| **Spotify Premium**    | The Web Playback SDK refuses to stream on free accounts. Spotify restriction, no workaround.                                                |
| **A desktop browser**  | Chrome, Edge, Firefox or Safari. The SDK has no mobile support, so phones and tablets can't be the speaker. The app detects this and warns. |
| **The tab stays open** | The browser tab _is_ the speaker. The app takes a screen wake lock where supported.                                                         |

## Set it up

You only do this once.

### 1. Create a Spotify app

1. Open the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard) → **Create app**.
2. Name it anything.
3. Under **Redirect URIs**, add the address the site is actually served from — trailing
   slash included:

   | Hosted at               | Redirect URI                       |
   | ----------------------- | ---------------------------------- |
   | A custom domain         | `https://your-domain/`             |
   | GitHub Pages, org repo  | `https://<org>.github.io/<repo>/`  |
   | GitHub Pages, user repo | `https://<user>.github.io/<repo>/` |

   If you set a custom domain, that is the one Spotify needs — the `github.io` address is
   not what the browser will be at. For an org-owned repo the host is the **org** name, not
   your username.

4. Under **APIs used**, tick **Web API** and **Web Playback SDK**.
5. Save, then copy the **Client ID**.

Spotify matches redirect URIs **byte-for-byte**, so the trailing slash matters, and `https`
is required for anything that isn't loopback.

Rather than assembling the URL by hand, open the deployed site: its setup screen prints the
exact string with a copy button, computed from the real browser location by the same code
that sends it to Spotify. Copy from there and a mismatch is impossible.

> **Using a custom domain?** Set it in **Settings → Pages**, and keep
> [`public/CNAME`](public/CNAME) in step with it. Vite copies `public/` into the build
> verbatim, so the domain travels with the deploy rather than living only in repository
> settings. The build uses relative asset paths, so the same output works at a domain root
> or a `/repo/` subpath with no config change.

### 2. Turn on GitHub Pages

**Settings → Pages → Source: GitHub Actions.**

This is the step people miss — with the default "Deploy from a branch" the site serves raw
source and renders blank. Pushing to `main` then runs
[`deploy.yml`](.github/workflows/deploy.yml), which builds and publishes the site.

### 3. Add the Client ID

Either is fine:

- **Bake it in** — **Settings → Secrets and variables → Actions → Variables** →
  `VITE_SPOTIFY_CLIENT_ID`. Nicer if you're sharing the link, since visitors see nothing.
- **Skip it** — the site shows a one-time form asking each visitor for their own, saved in
  their browser.

The Client ID is a public identifier and safe to publish. There is no client secret
anywhere: login uses Authorization Code + PKCE, which is designed for exactly this.

### 4. Add anyone else who will log in

New Spotify apps start in **Development Mode**, capped at **25 users you add by hand**:
Dashboard → your app → **Settings → User Management** → add each person's name and the
email on their Spotify account. Anyone not listed gets an auth error.

In practice this rarely bites — audio comes out of one machine, so usually only the host
logs in. Lifting the cap means applying for Extended Quota Mode.

## Play

Open the site, connect Spotify, pick a playlist. That's it.

| Control             | Effect                                                     |
| ------------------- | ---------------------------------------------------------- |
| **Pause** / `Space` | Stops the music and the clock together                     |
| **Reroll song**     | Swaps in a different track and restarts the current minute |
| **Skip minute**     | Counts the round as done and advances                      |
| **Quit**            | Stops playback, back to the playlist list                  |

**Settings** covers round length (5–120s), number of rounds (5–100), chime voice (bell /
ding / air horn / arcade / silent), and whether short playlists may reuse tracks. Your
choices are remembered between runs.

Testing it out? Drop the round length to 5 seconds so a full run takes 25 seconds instead
of an hour.

## When something goes wrong

| Symptom                                    | Cause                                                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| Blank page after deploying                 | Pages source is still "Deploy from a branch" — switch it to "GitHub Actions".           |
| `INVALID_CLIENT: Invalid redirect URI`     | The dashboard URI doesn't match byte-for-byte. Check the trailing slash.                |
| Login works, music doesn't start           | The account isn't Premium, or another device grabbed playback — press Resume.           |
| `Timed out waiting for the Spotify player` | The browser blocked the DRM module. Firefox needs DRM playback enabled in its settings. |
| A friend can't log in                      | They're not in the app's User Management list (the 25-user cap).                        |
| Nothing works on a phone                   | Expected. Spotify's Web Playback SDK does not support mobile browsers at all.           |

## Your data

Nothing is collected, because there is nowhere to collect it — the site has no backend.
Your login token is kept in your own browser so a refresh mid-hour doesn't end the session,
and **Log out** clears it. The only servers contacted are `accounts.spotify.com` and
`api.spotify.com`.

Drink responsibly, or don't drink at all — the timer doesn't care what's in the glass.

---

# For developers

## Get running

```bash
npm install
npm run dev     # http://127.0.0.1:5173/
```

Add `http://127.0.0.1:5173/` as a second Redirect URI in the Spotify dashboard, and open
that address rather than `localhost`. Spotify requires HTTPS for every redirect URI
**except** loopback, and it must be the literal IP — `http://localhost:5173/` is rejected.

## Scripts

| Script                  | Does                                        |
| ----------------------- | ------------------------------------------- |
| `npm run dev`           | Vite dev server with HMR                    |
| `npm run build`         | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview`       | Serve the production build locally          |
| `npm run typecheck`     | Types only, no build                        |
| `npm run lint`          | oxlint, type-aware                          |
| `npm run format`        | oxfmt, write                                |
| `npm run format:check`  | oxfmt, verify only                          |
| `npm test`              | Vitest unit + component suite               |
| `npm run test:coverage` | Vitest with v8 coverage and thresholds      |
| `npm run test:e2e`      | Playwright against the production build     |
| `npm run verify`        | Everything CI runs, in order                |

`npm run verify` is the gate — match it before pushing.
[`ci.yml`](.github/workflows/ci.yml) runs the same steps on every push and pull request.

## The constraint that shapes everything

Static site, no backend. Every architectural decision follows from it:

| Need                                              | Browser-only solution                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Log in to Spotify without leaking a client secret | **Authorization Code + PKCE** — designed for public clients; no secret exists to protect |
| Play full tracks from a static page               | **Web Playback SDK** — turns the tab into a real Spotify Connect device                  |
| Start a song mid-way through                      | `PUT /v1/me/player/play` with `position_ms`                                              |
| Chime between songs                               | Web Audio oscillators — synthesised, so there are no audio files to host                 |

If a change would require a server, it doesn't belong here.

## How a round works

```
pick track ──▶ random position_ms ──▶ PUT /me/player/play ──▶ 60s clock
                                                                 │
                        chime ◀── round++ ◀───────────────────────┘
```

The details that are load-bearing:

- **Random start point** is drawn from `[8% of the song … duration − 65s]`, so a round
  never runs off the end of a track into silence, and never opens on a cold intro.
- **The clock is deadline-based**, comparing against an absolute `performance.now()` target
  rather than accumulating ticks, so background-tab throttling can't make the hour drift.
- **Token refresh is proactive.** Access tokens expire after exactly one hour — precisely
  the length of the game — so the app refreshes five minutes early rather than discovering
  the problem at minute 59.
- **Short playlists** reshuffle whole passes, so every song plays once before any repeats,
  and never twice in a row across the seam.
- **Reroll** guarantees a different, preferably not-yet-played track.
- **A generation counter** drops stale `play()` responses, so mashing _Skip_ can't let an
  older round's request win the race and resurrect a dead round.

## Layout

```
index.html                   loads the Spotify SDK, mounts React
src/
  App.tsx                    phase machine: setup → picker → game → victory
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
  lib/
    config.ts                client ID + scopes + redirect URI normalisation
    auth.ts                  PKCE flow, token storage, silent refresh
    api.ts                   Web API client: 401 refresh, 429 backoff, pagination
    playback.ts              Web Playback SDK wrapper
    chime.ts                 synthesised chimes (Web Audio, no assets)
    engine.ts                queue building, random start points, the round clock
    errors.ts                safe `unknown` → message narrowing for caught errors
    format.ts, settings.ts, spotify-types.ts
  test/                      Vitest setup + data factories
  **/*.test.ts(x)            unit + component tests, colocated
e2e/
  fixtures/spotify.ts        Web Playback SDK + Web API stub
  auth.spec.ts               setup, PKCE authorize request, session
  power-hour.spec.ts         picker, a full run, controls, failure handling
```

`src/lib/engine.ts` is the power hour itself and is **deliberately framework-free** — it
exposes an imperative object and reports outward through callbacks.
`src/hooks/use-power-hour.ts` is the only bridge into React. Keep game logic in the engine
and React out of it; that separation is what makes the logic testable on its own.

## Testing

| Layer            | Tool                             | Count | Covers                                                             |
| ---------------- | -------------------------------- | ----- | ------------------------------------------------------------------ |
| Unit + component | Vitest + Testing Library (jsdom) | 251   | the engine, PKCE auth, the API client, chimes, hooks, every screen |
| End-to-end       | Playwright (Chromium)            | 25    | the real production bundle driven against a stubbed Spotify        |

```bash
npx vitest run src/lib/engine.test.ts
npx vitest run -t 'never places the same track back to back'
npx playwright test -g 'reroll'
```

The e2e fixture ([`e2e/fixtures/spotify.ts`](e2e/fixtures/spotify.ts)) stubs **only** the
Web Playback SDK script and `api.spotify.com`. Everything below that line — token storage,
the round clock, the UI — is the real application. A full run is exercised on the clock
rather than by clicking _Skip_, so the timing logic is genuinely covered.

Coverage thresholds are ratcheted just under what the suite achieves (96% statements, 98%
lines), so a regression fails CI instead of sliding quietly.

## Toolchain

**TypeScript 7 + oxlint + oxfmt**, and the three are connected.

Type-aware lint rules need a type checker. `typescript-eslint` gets one from TypeScript's
_JavaScript_ API — which TypeScript 7, the native Go compiler, does not expose. It refuses
to load on TS 7 with a hard runtime guard, and because `typescript` is a _peer_ dependency
there, npm hoists a single copy and no `overrides` trick can hand the linter its own
TypeScript 6.

[oxlint](https://oxc.rs) is written in Rust, and its `--type-aware` mode drives
`oxlint-tsgolint`, which is built on the native compiler and versioned against it. So the
project runs TypeScript 7 _and_ keeps the rules that carry their weight here —
`no-floating-promises`, `no-misused-promises`, `no-misused-spread`, `await-thenable`.

> `npm run lint` must keep the `--type-aware` flag. Without it those rules silently do not
> run and the command still exits 0.

**oxfmt** replaces Prettier and covers TS/TSX, CSS, HTML, JSON, YAML and Markdown. It was
migrated with `oxfmt --migrate=prettier`, and its output matched Prettier's byte for byte
across the repo, so the switch reformatted nothing.

Config lives in [`.oxlintrc.json`](.oxlintrc.json) and [`.oxfmtrc.json`](.oxfmtrc.json).
Prefer a scoped `overrides` entry with a comment over switching a rule off globally.

## UI components

shadcn/ui, vendored the normal way — the source in `src/components/ui/` is yours to edit.
[`components.json`](components.json) is configured, so `npx shadcn@latest add dialog`
works.

Two deliberate deviations from upstream; preserve them if you re-add a component:

- `ui/sonner.tsx` pins `theme="dark"` instead of reading `next-themes`. The app is
  dark-only and doesn't need the extra dependency.
- `ui/slider.tsx` forwards `aria-label`/`aria-labelledby` to the **thumb**. Radix puts
  `role="slider"` on the thumb but leaves the label on the root, so without this the
  control is unnamed for screen readers.

Theming is dark-only, with Spotify green wired in as `--primary` in `src/index.css`.
Prefer adjusting tokens there over one-off colour classes.
