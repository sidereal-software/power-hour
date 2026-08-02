/**
 * Web Playback SDK wrapper — turns this browser tab into a Spotify device.
 * Premium-only, and desktop browsers only (the SDK has no mobile support).
 */
import { getAccessToken, forceRefresh } from './auth.js';

let player = null;
let deviceId = null;

export function getDeviceId() {
  return deviceId;
}

export function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
}

/**
 * Connect the SDK. Call this from a user gesture — browsers gate audio
 * playback on one, and the SDK opens its audio context on connect.
 * Resolves once Spotify hands us a device_id.
 */
export async function connectPlayer({ onError, onStateChange, volume = 0.8 } = {}) {
  if (player && deviceId) return deviceId;

  await window.__sdkReady;

  player = new window.Spotify.Player({
    name: 'Power Hour',
    volume,
    getOAuthToken: (cb) => {
      getAccessToken()
        .then(cb)
        // A failed refresh here surfaces as an authentication_error below.
        .catch(() => forceRefresh().then((t) => cb(t.access_token)).catch(() => {}));
    },
  });

  player.addListener('initialization_error', ({ message }) =>
    onError?.(`Playback could not start in this browser. ${message}`));
  player.addListener('authentication_error', ({ message }) =>
    onError?.(`Spotify rejected the session. ${message}`));
  player.addListener('account_error', () =>
    onError?.('Spotify Premium is required for in-browser playback.'));
  player.addListener('playback_error', ({ message }) =>
    onError?.(`Playback error: ${message}`));
  player.addListener('autoplay_failed', () =>
    onError?.('The browser blocked autoplay. Press play again to continue.'));

  if (onStateChange) player.addListener('player_state_changed', onStateChange);

  const ready = new Promise((resolve, reject) => {
    player.addListener('ready', ({ device_id }) => {
      deviceId = device_id;
      resolve(device_id);
    });
    setTimeout(() => reject(new Error('Timed out waiting for the Spotify player to start.')), 20000);
  });

  player.addListener('not_ready', () => { deviceId = null; });

  const connected = await player.connect();
  if (!connected) throw new Error('Could not connect to Spotify playback.');

  return ready;
}

export const resume = () => player?.resume();
export const pause = () => player?.pause();
export const setVolume = (value) => player?.setVolume(Math.min(1, Math.max(0, value)));
export const getState = () => player?.getCurrentState();

export function disconnect() {
  player?.disconnect();
  player = null;
  deviceId = null;
}
