/**
 * Static config. There is no server here — the Spotify Client ID is a public
 * identifier and is safe to ship in the bundle. The PKCE flow never uses a
 * client secret, which is exactly why this can live on GitHub Pages.
 *
 * Set CLIENT_ID below to hard-code your app, or leave it empty and the site
 * will prompt for one on first load (stored in localStorage).
 */
export const CLIENT_ID = '';

export const SCOPES = [
  'streaming',                      // Web Playback SDK
  'user-read-email',                // required alongside `streaming`
  'user-read-private',              // account country + Premium check
  'playlist-read-private',
  'playlist-read-collaborative',
  'user-library-read',              // Liked Songs as a pseudo-playlist
  'user-read-playback-state',
  'user-modify-playback-state',
].join(' ');

/** Spotify demands an exact redirect-URI match, so normalise `/index.html` away. */
export function redirectUri() {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

const CLIENT_ID_KEY = 'ph.clientId';

export function getClientId() {
  return CLIENT_ID || localStorage.getItem(CLIENT_ID_KEY) || '';
}

export function setClientId(id) {
  localStorage.setItem(CLIENT_ID_KEY, id.trim());
}

export function clearClientId() {
  localStorage.removeItem(CLIENT_ID_KEY);
}
