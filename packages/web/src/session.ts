// Web sessions — POST /web/session with the app's publishable key. The server checks
// the request Origin against the app's allowlist and that the key's environment matches
// the origin's mapped environment, then returns a compact signed token (payload.sig,
// Ed25519 with the same key this SDK already pins for config).
//
// v1 purpose: MAU accounting. The token becomes the credential for the KisKis Proxy.

import { verifyAsync } from '@noble/ed25519';

const DEFAULT_API_BASE = 'https://api.kiskis.dev';
const CLIENT_ID_STORAGE_KEY = 'kiskis-client-id';

export interface WebSession {
  token: string;
  appId: string;
  env: 'production' | 'sandbox';
  /** Unix seconds. */
  expiresAt: number;
}

export interface StartSessionOptions {
  /** Publishable key (kk_pub_live_… / kk_pub_test_…) from the dashboard Web Apps panel. */
  publishableKey: string;
  /** API base (default https://api.kiskis.dev). */
  apiBase?: string;
  /** KisKis signing public key, 32 raw bytes. Defaults handled by the caller. */
  publicKey: Uint8Array;
}

function b64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Stable per-browser client id for MAU counting. Persisted in localStorage so the same
 * browser counts once per month; falls back to a per-page id where storage is blocked.
 */
export function getOrCreateClientId(storage: Pick<Storage, 'getItem' | 'setItem'> | null =
  typeof localStorage !== 'undefined' ? localStorage : null): string {
  const fresh = crypto.randomUUID();
  if (!storage) return fresh;
  try {
    const existing = storage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && /^[a-zA-Z0-9_-]{8,64}$/.test(existing)) return existing;
    storage.setItem(CLIENT_ID_STORAGE_KEY, fresh);
  } catch { /* storage blocked (private mode) — per-page id is fine */ }
  return fresh;
}

/** Mint a session. Verifies the returned token's signature before trusting it. */
export async function startSession(opts: StartSessionOptions): Promise<WebSession> {
  const base = (opts.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
  const res = await fetch(`${base}/web/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      publishableKey: opts.publishableKey,
      clientId: getOrCreateClientId(),
    }),
  });
  const body = await res.text();
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try { message = JSON.parse(body).error ?? message; } catch { /* not JSON */ }
    throw new Error(`KisKis: session request failed — ${message}`);
  }
  const parsed = JSON.parse(body);
  const token: string = parsed.token ?? '';
  const dot = token.indexOf('.');
  if (dot < 1) throw new Error('KisKis: malformed session token');
  const payloadBytes = b64urlToBytes(token.slice(0, dot));
  const sig = b64urlToBytes(token.slice(dot + 1));
  if (!(await verifyAsync(sig, payloadBytes, opts.publicKey))) {
    throw new Error('KisKis: session token signature verification failed');
  }
  const payload = JSON.parse(new TextDecoder().decode(payloadBytes));
  return { token, appId: payload.appId, env: payload.env, expiresAt: payload.exp };
}
