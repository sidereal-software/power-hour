/**
 * Spotify Authorization Code flow with PKCE — the browser-only variant.
 * No client secret, no token-exchange server, so the whole thing works from
 * a static host like GitHub Pages.
 *
 * Access tokens live 1 hour and a power hour is *exactly* 1 hour, so silent
 * refresh isn't optional here — it's load-bearing.
 */
import { getClientId, redirectUri, SCOPES } from './config.js';

const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';

const TOKENS_KEY = 'ph.tokens';
const VERIFIER_KEY = 'ph.verifier';
const STATE_KEY = 'ph.state';

/** Refresh this far ahead of actual expiry so a request never races the clock. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

let refreshInFlight = null;

/* ── PKCE helpers ──────────────────────────────────────────────────── */

function randomString(length) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

function base64UrlEncode(buffer) {
  let binary = '';
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64UrlEncode(digest);
}

/* ── Token storage ─────────────────────────────────────────────────── */

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(TOKENS_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeTokens(payload, existing) {
  const tokens = {
    access_token: payload.access_token,
    // PKCE rotates refresh tokens; a response may still omit one, so keep the old.
    refresh_token: payload.refresh_token || existing?.refresh_token,
    expires_at: Date.now() + payload.expires_in * 1000,
  };
  localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
  return tokens;
}

export function isLoggedIn() {
  const tokens = readTokens();
  return Boolean(tokens?.refresh_token || (tokens?.access_token && tokens.expires_at > Date.now()));
}

export function logout() {
  localStorage.removeItem(TOKENS_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
}

/* ── Flow ──────────────────────────────────────────────────────────── */

export async function login() {
  const clientId = getClientId();
  if (!clientId) throw new Error('No Spotify Client ID configured.');

  const verifier = randomString(96);
  const state = randomString(24);
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri(),
    code_challenge_method: 'S256',
    code_challenge: await challengeFor(verifier),
    state,
    scope: SCOPES,
  });

  window.location.assign(`${AUTHORIZE_URL}?${params}`);
}

async function postToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || `Token request failed (${res.status})`);
  }
  return data;
}

/**
 * Consume `?code=…` if we just came back from Spotify.
 * Returns 'signed-in' | 'denied' | null and always leaves a clean URL behind.
 */
export async function handleRedirect() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const error = params.get('error');
  const state = params.get('state');
  if (!code && !error) return null;

  const cleanUrl = redirectUri();
  const expectedState = sessionStorage.getItem(STATE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);
  window.history.replaceState({}, '', cleanUrl);

  if (error) return 'denied';
  if (!state || state !== expectedState) throw new Error('Auth state mismatch — please try connecting again.');
  if (!verifier) throw new Error('Missing PKCE verifier — please try connecting again.');

  const payload = await postToken({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cleanUrl,
    client_id: getClientId(),
    code_verifier: verifier,
  });
  writeTokens(payload, null);
  return 'signed-in';
}

async function refresh() {
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error('Session expired. Please connect Spotify again.');

  const payload = await postToken({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: getClientId(),
  });
  return writeTokens(payload, tokens);
}

/** Single-flight refresh: the SDK and the Web API both ask for tokens constantly. */
export function forceRefresh() {
  if (!refreshInFlight) {
    refreshInFlight = refresh().finally(() => { refreshInFlight = null; });
  }
  return refreshInFlight;
}

/** The one function everything else calls. Always resolves to a usable token. */
export async function getAccessToken() {
  const tokens = readTokens();
  if (!tokens) throw new Error('Not signed in.');
  if (tokens.access_token && Date.now() < tokens.expires_at - REFRESH_MARGIN_MS) {
    return tokens.access_token;
  }
  const fresh = await forceRefresh();
  return fresh.access_token;
}
