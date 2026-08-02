/** UI wiring: screens, playlist picker, and the live game view. */
import { getClientId, setClientId, clearClientId, redirectUri } from './config.js';
import * as auth from './auth.js';
import * as api from './api.js';
import * as playback from './player.js';
import { unlockAudio, playChime } from './chime.js';
import { createGame, playableTracks } from './game.js';

const $ = (id) => document.getElementById(id);
const RING_CIRCUMFERENCE = 2 * Math.PI * 54;

const state = {
  me: null,
  playlists: [],
  game: null,
  playerReady: false,
};

/* ── Small helpers ─────────────────────────────────────────────────── */

function showScreen(name) {
  for (const section of document.querySelectorAll('.screen')) {
    section.classList.toggle('hidden', section.id !== `screen-${name}`);
  }
  window.scrollTo(0, 0);
}

function showError(id, message) {
  const el = $(id);
  el.textContent = message;
  el.classList.toggle('hidden', !message);
}

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function setBackdrop(url) {
  const el = $('art-backdrop');
  if (url) {
    el.style.backgroundImage = `url("${url}")`;
    el.classList.add('on');
  } else {
    el.classList.remove('on');
  }
}

const artOf = (track) => track?.album?.images?.[0]?.url || '';
const artistsOf = (track) => (track?.artists || []).map((a) => a.name).join(', ');

/* ── Setup screen ──────────────────────────────────────────────────── */

function renderSetup() {
  const hasClientId = Boolean(getClientId());
  $('redirect-uri-display').textContent = redirectUri();
  $('setup-clientid').classList.toggle('hidden', hasClientId);
  $('setup-connect').classList.toggle('hidden', !hasClientId);
  $('change-client-id').classList.toggle('hidden', !hasClientId);
  showScreen('setup');
}

$('save-client-id').addEventListener('click', () => {
  const value = $('client-id-input').value.trim();
  if (!value) return showError('setup-error', 'Paste the Client ID from your Spotify dashboard.');
  setClientId(value);
  showError('setup-error', '');
  renderSetup();
});

$('change-client-id').addEventListener('click', () => {
  clearClientId();
  auth.logout();
  renderSetup();
});

$('login-btn').addEventListener('click', async () => {
  try {
    await auth.login();
  } catch (err) {
    showError('setup-error', err.message);
  }
});

$('logout-btn').addEventListener('click', () => {
  auth.logout();
  playback.disconnect();
  renderSetup();
});

/* ── Playlist picker ───────────────────────────────────────────────── */

function playlistButton({ id, name, sub, image, kind }) {
  const button = document.createElement('button');
  button.className = 'playlist';
  button.setAttribute('role', 'listitem');
  button.dataset.search = name.toLowerCase();

  const art = image
    ? Object.assign(document.createElement('img'), { src: image, alt: '', loading: 'lazy' })
    : Object.assign(document.createElement('div'), { className: 'noart', textContent: '♪' });

  const text = document.createElement('div');
  text.className = 'playlist-text';
  const title = document.createElement('div');
  title.className = 'playlist-name';
  title.textContent = name;
  const subtitle = document.createElement('div');
  subtitle.className = 'playlist-sub';
  subtitle.textContent = sub;
  text.append(title, subtitle);

  button.append(art, text);
  button.addEventListener('click', () => launch({ id, name, kind }));
  return button;
}

async function loadPicker() {
  showScreen('picker');
  showError('picker-error', '');

  try {
    state.me = await api.getMe();
  } catch (err) {
    showError('picker-error', `Could not load your Spotify profile: ${err.message}`);
    return;
  }

  $('user-line').textContent =
    `${state.me.display_name || state.me.id}` +
    (state.me.product === 'premium' ? '' : ' · ⚠️ Premium required for playback');

  if (playback.isMobileBrowser()) {
    showError('picker-error',
      'Heads up: Spotify\'s Web Playback SDK does not support mobile browsers. ' +
      'Run the power hour from a desktop browser.');
  }

  const list = $('playlist-list');
  list.replaceChildren(Object.assign(document.createElement('div'), {
    className: 'loading',
    textContent: 'Loading your playlists…',
  }));

  try {
    state.playlists = await api.getMyPlaylists();
  } catch (err) {
    list.replaceChildren();
    showError('picker-error', `Could not load playlists: ${err.message}`);
    return;
  }

  const entries = [
    playlistButton({
      id: 'liked',
      kind: 'liked',
      name: 'Liked Songs',
      sub: 'Your saved tracks',
      image: '',
    }),
    ...state.playlists.map((p) => playlistButton({
      id: p.id,
      kind: 'playlist',
      name: p.name || 'Untitled playlist',
      sub: `${p.tracks?.total ?? '?'} tracks · ${p.owner?.display_name || ''}`.trim(),
      image: p.images?.[0]?.url || '',
    })),
  ];

  list.replaceChildren(...entries);
}

$('playlist-filter').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase();
  for (const node of $('playlist-list').querySelectorAll('.playlist')) {
    node.classList.toggle('hidden', Boolean(query) && !node.dataset.search.includes(query));
  }
});

/* ── Settings ──────────────────────────────────────────────────────── */

const settings = {
  get roundMs() { return Number($('round-length').value) * 1000; },
  get totalRounds() { return Number($('round-count').value); },
  get chime() { return $('chime-select').value; },
  get allowRepeats() { return $('allow-repeats').checked; },
};

function renderSettings() {
  $('round-out').textContent = `${$('round-length').value}s`;
  $('rounds-out').textContent = $('round-count').value;
  const totalMs = settings.roundMs * settings.totalRounds;
  $('duration-note').textContent = `Total run time: ${clock(totalMs)}`;
}

$('round-length').addEventListener('input', renderSettings);
$('round-count').addEventListener('input', renderSettings);
$('test-chime').addEventListener('click', () => { unlockAudio(); playChime(settings.chime); });

/* ── Launching a run ───────────────────────────────────────────────── */

async function launch({ id, name, kind }) {
  // This runs inside a click handler, which is the gesture browsers require
  // before any audio (ours or the SDK's) is allowed to start.
  unlockAudio();

  showScreen('game');
  showError('game-error', '');
  $('game-status').textContent = 'Starting the Spotify player…';
  $('track-name').textContent = name;
  $('track-artist').textContent = '';
  $('track-position').textContent = '';
  $('round-total').textContent = `/ ${settings.totalRounds}`;

  try {
    if (!state.playerReady) {
      await playback.connectPlayer({
        volume: Number($('volume').value) / 100,
        onError: (message) => showError('game-error', message),
      });
      state.playerReady = true;
    }

    $('game-status').textContent = 'Loading tracks…';
    const market = state.me?.country;
    const onProgress = (n) => { $('game-status').textContent = `Loading tracks… ${n}`; };
    const raw = kind === 'liked'
      ? await api.getLikedTracks(market, onProgress)
      : await api.getPlaylistTracks(id, market, onProgress);

    const tracks = playableTracks(raw);
    if (tracks.length === 0) {
      showError('game-error', 'No playable tracks in that playlist. Local files and unavailable tracks are skipped.');
      $('game-status').textContent = '';
      return backToPicker();
    }
    if (tracks.length < settings.totalRounds && !settings.allowRepeats) {
      $('game-status').textContent = `Only ${tracks.length} playable tracks — the run will be shorter.`;
    }

    state.game = createGame({
      tracks,
      roundMs: settings.roundMs,
      totalRounds: settings.totalRounds,
      chime: settings.chime,
      allowRepeats: settings.allowRepeats,
      on: { round: onRound, tick: onTick, finish: onFinish, error: (m) => showError('game-error', m) },
    });

    $('round-total').textContent = `/ ${state.game.totalRounds}`;
    $('game-status').textContent = '';
    await state.game.start();
  } catch (err) {
    showError('game-error', err.message);
    $('game-status').textContent = '';
  }
}

/* ── Live game view ────────────────────────────────────────────────── */

function onRound({ index, total, track, positionMs, roundMs }) {
  $('round-now').textContent = index + 1;
  $('round-total').textContent = `/ ${total}`;

  // Seed the clock now rather than showing a stale value until the first tick.
  $('seconds-left').textContent = Math.round(roundMs / 1000);
  $('ring-fill').style.strokeDashoffset = '0';
  $('timer').classList.remove('urgent');
  $('track-name').textContent = track.name;
  $('track-artist').textContent = artistsOf(track);
  $('track-position').textContent = `dropping in at ${clock(positionMs)} of ${clock(track.duration_ms)}`;

  const art = artOf(track);
  $('track-art').src = art || 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  $('track-art').alt = `${track.album?.name || ''} cover`;
  setBackdrop(art);

  $('pause-btn').textContent = 'Pause';
}

function onTick({ remainingMs, roundMs, index, totalRounds, elapsedTotalMs }) {
  const secondsLeft = Math.ceil(remainingMs / 1000);
  $('seconds-left').textContent = secondsLeft;
  $('timer').classList.toggle('urgent', secondsLeft <= 10);

  const roundProgress = 1 - remainingMs / roundMs;
  $('ring-fill').style.strokeDashoffset = String(RING_CIRCUMFERENCE * roundProgress);

  const totalMs = roundMs * totalRounds;
  $('hour-fill').style.width = `${(elapsedTotalMs / totalMs) * 100}%`;
  $('hour-remaining').textContent = `${clock(totalMs - elapsedTotalMs)} left · round ${index + 1} of ${totalRounds}`;
}

function onFinish({ rounds, roundMs }) {
  setBackdrop('');
  $('victory-stats').textContent =
    `${rounds} songs · ${rounds} random timestamps · ${clock(rounds * roundMs)} on the clock.`;
  playChime('arcade');
  showScreen('victory');
}

$('pause-btn').addEventListener('click', async () => {
  const game = state.game;
  if (!game) return;
  if (game.status === 'playing') {
    await game.pause();
    $('pause-btn').textContent = 'Resume';
  } else if (game.status === 'paused') {
    $('pause-btn').textContent = 'Pause';
    await game.resume();
  }
});

$('reroll-btn').addEventListener('click', () => state.game?.reroll());
$('skip-btn').addEventListener('click', () => state.game?.skip());
$('quit-btn').addEventListener('click', backToPicker);
$('again-btn').addEventListener('click', backToPicker);
$('home-btn').addEventListener('click', backToPicker);

$('volume').addEventListener('input', (event) => {
  playback.setVolume(Number(event.target.value) / 100);
});

async function backToPicker() {
  await state.game?.stop();
  state.game = null;
  setBackdrop('');
  showError('game-error', '');
  showScreen('picker');
}

// Space toggles pause during a run.
document.addEventListener('keydown', (event) => {
  if (event.code !== 'Space' || $('screen-game').classList.contains('hidden')) return;
  if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement?.tagName)) return;
  event.preventDefault();
  $('pause-btn').click();
});

window.addEventListener('beforeunload', (event) => {
  if (state.game && state.game.status !== 'finished') {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* ── Boot ──────────────────────────────────────────────────────────── */

(async function boot() {
  renderSettings();

  if (!getClientId()) return renderSetup();

  try {
    const result = await auth.handleRedirect();
    if (result === 'denied') {
      renderSetup();
      return showError('setup-error', 'Spotify authorisation was cancelled.');
    }
  } catch (err) {
    renderSetup();
    return showError('setup-error', err.message);
  }

  if (auth.isLoggedIn()) {
    await loadPicker();
  } else {
    renderSetup();
  }
})();
