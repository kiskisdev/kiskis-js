import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { startSession, getOrCreateClientId } from '../src/session.js';

// Fake session server signing exactly like the delivery Lambda's mintWebSessionToken.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const rawPub = new Uint8Array(publicKey.export({ type: 'spki', format: 'der' }).subarray(-32));

function mintToken(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const sig = crypto.sign(null, body, privateKey);
  return `${body.toString('base64url')}.${sig.toString('base64url')}`;
}

const NOW = Math.floor(Date.now() / 1000);
const realFetch = globalThis.fetch;

test('startSession verifies the token and returns the session', async () => {
  const token = mintToken({ appId: 'app_x', env: 'production', iat: NOW, exp: NOW + 3600 });
  globalThis.fetch = async () => new Response(
    JSON.stringify({ token, appId: 'app_x', env: 'production', expiresAt: NOW + 3600 }), { status: 200 });
  try {
    const s = await startSession({ publishableKey: 'kk_pub_live_x', publicKey: rawPub });
    assert.equal(s.appId, 'app_x');
    assert.equal(s.env, 'production');
    assert.equal(s.expiresAt, NOW + 3600);
  } finally { globalThis.fetch = realFetch; }
});

test('a forged token is rejected even on HTTP 200', async () => {
  const good = mintToken({ appId: 'app_x', env: 'production', iat: NOW, exp: NOW + 3600 });
  const sig = good.split('.')[1];
  const forgedBody = Buffer.from(JSON.stringify({ appId: 'app_evil', env: 'production', iat: NOW, exp: NOW + 9e9 })).toString('base64url');
  globalThis.fetch = async () => new Response(JSON.stringify({ token: `${forgedBody}.${sig}` }), { status: 200 });
  try {
    await assert.rejects(
      startSession({ publishableKey: 'kk_pub_live_x', publicKey: rawPub }),
      /signature verification failed/,
    );
  } finally { globalThis.fetch = realFetch; }
});

test('server refusals surface their error message', async () => {
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: 'Origin is not registered for this app' }), { status: 403 });
  try {
    await assert.rejects(
      startSession({ publishableKey: 'kk_pub_live_x', publicKey: rawPub }),
      /Origin is not registered/,
    );
  } finally { globalThis.fetch = realFetch; }
});

test('client id is stable across calls with the same storage, valid format', () => {
  const store = new Map<string, string>();
  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
  const a = getOrCreateClientId(storage);
  const b = getOrCreateClientId(storage);
  assert.equal(a, b);
  assert.match(a, /^[a-zA-Z0-9_-]{8,64}$/);
  // No storage → still returns a usable id.
  assert.match(getOrCreateClientId(null), /^[a-zA-Z0-9_-]{8,64}$/);
});
