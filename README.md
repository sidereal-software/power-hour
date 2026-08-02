# Power Hour

60 songs. 60 random timestamps. 60 minutes. A Spotify-powered power hour that runs
entirely in the browser — **no backend, no server, no database.** Host it on GitHub Pages.

Pick one of your Spotify playlists and the app shuffles it, drops into each song at a
random point, plays exactly one minute, rings a chime, and moves on. Do that sixty times
and you have passed the power hour.

---

## Why this works without a server

Two pieces make it possible:

| Need | Browser-only solution |
| --- | --- |
| Log in to Spotify without leaking a client secret | **Authorization Code + PKCE** — designed for public clients; no secret exists to protect |
| Play full tracks from a static page | **Web Playback SDK** — turns the tab into a real Spotify Connect device |
| Start a song mid-way through | `PUT /v1/me/player/play` with `position_ms` |
| Chime between songs | Web Audio API oscillators — synthesised, so there are no audio files to host |

The Client ID is a public identifier. Nothing secret is ever shipped, and no request
touches a server other than Spotify's own API.

## Requirements

- **Spotify Premium.** The Web Playback SDK refuses to stream on free accounts. This is a
  Spotify restriction with no workaround. (The 30-second `preview_url` fallback that older
  projects used is no longer populated for new apps.)
- **A desktop browser** — Chrome, Edge, Firefox, or Safari. The SDK does not support mobile
  browsers, so phones and tablets can't be the playback device. The app detects this and warns.
- The tab must stay open; it *is* the speaker. The app takes a screen wake lock where supported.

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

### 2. Wire up the Client ID

Either hard-code it in [`js/config.js`](js/config.js):

```js
export const CLIENT_ID = 'your_client_id_here';
```

…or leave it empty and paste it into the one-time setup form the site shows on first load
(it's kept in `localStorage`). Hard-coding is nicer if you're sharing the link.

### 3. Turn on GitHub Pages

**Settings → Pages → Source: Deploy from a branch → `main` / `(root)`.**

Give it a minute, then open the URL. That's the whole deployment.

### 4. Add your friends (important)

New Spotify apps start in **Development Mode**, which only allows **25 users you add by
hand**: Dashboard → your app → **Settings → User Management** → add each person's name and
the email on their Spotify account. Anyone not on that list gets an auth error.

Lifting that cap means applying for Extended Quota Mode. For a party this rarely matters —
audio comes out of one machine anyway, so usually only the host needs to log in.

---

## Local development

No build step, no dependencies. Serve the folder over HTTP:

```bash
python3 -m http.server 8080 --bind 127.0.0.1
# then open http://127.0.0.1:8080/
```

Add `http://127.0.0.1:8080/` as a second Redirect URI in the dashboard. Spotify requires
HTTPS for every redirect URI **except** loopback, and it must be the literal IP —
`http://localhost:8080/` is rejected.

Turn the round length down to 5 seconds in **Settings** when testing so you aren't waiting
a real hour to see the victory screen.

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
  before any song repeats.

### Controls

| Control | Effect |
| --- | --- |
| **Pause** / `Space` | Stops the music and the clock together |
| **Reroll song** | Swaps in a different track and restarts the current minute |
| **Skip minute** | Counts the round as done and advances |
| **Quit** | Stops playback, back to the playlist list |

### Settings

Round length (5–120s), number of rounds (5–100), chime voice (bell / ding / air horn /
arcade / silent), and whether short playlists may reuse tracks.

---

## Project layout

```
index.html        screens: setup, playlist picker, game, victory
styles.css        dark neon theme, blurred album-art backdrop
js/config.js      client ID + scopes + redirect URI normalisation
js/auth.js        PKCE flow, token storage, silent refresh
js/api.js         Web API client: 401 refresh, 429 backoff, pagination
js/player.js      Web Playback SDK wrapper
js/chime.js       synthesised chimes (Web Audio, no assets)
js/game.js        queue building, random start points, the round clock
js/main.js        UI wiring
```

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `INVALID_CLIENT: Invalid redirect URI` | The dashboard URI doesn't match byte-for-byte. Check the trailing slash. The setup screen prints the exact string to paste. |
| Auth succeeds, playback doesn't start | Account isn't Premium, or another device grabbed playback — press Resume. |
| `Timed out waiting for the Spotify player` | Browser blocked the DRM/EME module. Firefox needs DRM playback enabled in Settings. |
| Nothing happens for a friend | They're not in the app's User Management list (Development Mode's 25-user cap). |

## Notes

Tokens live in `localStorage` so a page refresh mid-hour doesn't kill the session. Nothing is
sent anywhere except `accounts.spotify.com` and `api.spotify.com`. **Log out** clears them.

Drink responsibly, or don't drink at all — the timer doesn't care what's in the glass.
