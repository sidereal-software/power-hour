/** Thin Spotify Web API client: auth header, 401 refresh, 429 backoff. */
import { getAccessToken, forceRefresh } from './auth.js';

const BASE = 'https://api.spotify.com/v1';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(path, options = {}, allowRetry = true) {
  const token = await getAccessToken();
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && allowRetry) {
    await forceRefresh();
    return request(path, options, false);
  }

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get('Retry-After') || 2);
    await sleep((retryAfter + 1) * 1000);
    return request(path, options, allowRetry);
  }

  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json())?.error?.message || '';
    } catch { /* empty or non-JSON body */ }
    throw new ApiError(res.status, detail || res.statusText || `HTTP ${res.status}`);
  }

  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/* ── Account ───────────────────────────────────────────────────────── */

export const getMe = () => request('/me');

/* ── Playlists ─────────────────────────────────────────────────────── */

export async function getMyPlaylists() {
  const playlists = [];
  let url = '/me/playlists?limit=50';
  while (url) {
    const page = await request(url);
    playlists.push(...(page.items || []).filter(Boolean));
    url = page.next ? page.next.replace(BASE, '') : null;
  }
  return playlists;
}

const TRACK_FIELDS =
  'next,items(is_local,track(uri,id,name,duration_ms,is_playable,is_local,type,' +
  'artists(name),album(name,images)))';

/**
 * Every playable track in a playlist, paginated.
 * `market` matters twice: it populates `is_playable` and it relinks tracks to
 * versions actually available in the user's country.
 */
export async function getPlaylistTracks(playlistId, market, onProgress) {
  const items = [];
  const params = new URLSearchParams({ limit: '100', fields: TRACK_FIELDS });
  if (market) params.set('market', market);
  let url = `/playlists/${playlistId}/tracks?${params}`;

  while (url) {
    const page = await request(url);
    items.push(...(page.items || []));
    onProgress?.(items.length);
    url = page.next ? page.next.replace(BASE, '') : null;
  }
  return items.map((item) => item?.track).filter(Boolean);
}

export async function getLikedTracks(market, onProgress) {
  const tracks = [];
  const params = new URLSearchParams({ limit: '50' });
  if (market) params.set('market', market);
  let url = `/me/tracks?${params}`;

  while (url) {
    const page = await request(url);
    tracks.push(...(page.items || []).map((item) => item?.track).filter(Boolean));
    onProgress?.(tracks.length);
    url = page.next ? page.next.replace(BASE, '') : null;
  }
  return tracks;
}

/* ── Playback ──────────────────────────────────────────────────────── */

export function play(deviceId, uri, positionMs) {
  return request(`/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: 'PUT',
    body: JSON.stringify({ uris: [uri], position_ms: Math.max(0, Math.floor(positionMs)) }),
  });
}

export function pause(deviceId) {
  return request(`/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, { method: 'PUT' });
}

export function transferPlayback(deviceId, play = false) {
  return request('/me/player', {
    method: 'PUT',
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}
