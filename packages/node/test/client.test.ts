import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { KiskisNode, zkEncrypt } from '../src/index.js';

// A fake KisKis delivery server: signs responses exactly like the real Lambda.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const rawPubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');

function signedResponse(config: unknown): Response {
  const body = JSON.stringify({ config, matchedPattern: '*' });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.sign(null, Buffer.from(`${ts}:/config:${body}`, 'utf8'), privateKey).toString('base64url');
  return new Response(body, {
    status: 200,
    headers: { 'X-Kiskis-Sig': sig, 'X-Kiskis-Sig-Ts': String(ts) },
  });
}

function makeClient(extra: Record<string, unknown> = {}) {
  return new KiskisNode({ serviceToken: 'kk_read_test', publicKeyB64: rawPubB64, ...extra });
}

const realFetch = globalThis.fetch;

test('fetchConfig verifies and returns typed config', async () => {
  globalThis.fetch = async () => signedResponse({ features: { dark: true }, limit: 5 });
  try {
    const cfg = await makeClient({ staleness: 'failHard' }).fetchConfig();
    assert.equal(cfg.bool('features.dark'), true);
    assert.equal(cfg.int('limit'), 5);
  } finally { globalThis.fetch = realFetch; }
});

test('a tampered response throws with failHard (never returns unauthenticated data)', async () => {
  globalThis.fetch = async () => {
    const res = signedResponse({ a: 1 });
    // Re-body the response with different bytes than were signed.
    return new Response(JSON.stringify({ config: { a: 2 }, matchedPattern: '*' }), {
      status: 200, headers: res.headers,
    });
  };
  try {
    await assert.rejects(
      makeClient({ staleness: 'failHard' }).fetchConfig(),
      /signature verification failed/,
    );
  } finally { globalThis.fetch = realFetch; }
});

test('staleness fallback: network failure serves the cached copy under warnAndUse', async () => {
  const client = makeClient({ staleness: 'useSilently' });
  globalThis.fetch = async () => signedResponse({ v: 'first' });
  try {
    await client.fetchConfig();
    globalThis.fetch = async () => { throw new Error('network down'); };
    const cfg = await client.fetchConfig();
    assert.equal(cfg.string('v'), 'first');
  } finally { globalThis.fetch = realFetch; }
});

test('failHard does NOT fall back to cache', async () => {
  const client = makeClient({ staleness: 'failHard' });
  globalThis.fetch = async () => signedResponse({ v: 'first' });
  try {
    await client.fetchConfig();
    globalThis.fetch = async () => { throw new Error('network down'); };
    await assert.rejects(client.fetchConfig(), /network down/);
  } finally { globalThis.fetch = realFetch; }
});

test('freshness window serves from cache with zero network calls', async () => {
  let calls = 0;
  const client = makeClient({ freshnessMs: 60_000 });
  globalThis.fetch = async () => { calls++; return signedResponse({ v: 1 }); };
  try {
    await client.fetchConfig();
    await client.fetchConfig();
    await client.fetchConfig();
    assert.equal(calls, 1);
    await client.fetchConfig({ forceRefresh: true });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = realFetch; }
});

test('ZK config decrypts locally; without zk options it fails with a clear error', async () => {
  const zk = { vaultPass: 'pw', teamId: 'T1', bundleId: 'com.x.y' };
  const blob = zkEncrypt(Buffer.from(JSON.stringify({ secret: 'v' })), zk);
  globalThis.fetch = async () => signedResponse(blob); // ZK arrives as an opaque string
  try {
    const cfg = await makeClient({ zk, staleness: 'failHard' }).fetchConfig();
    assert.equal(cfg.string('secret'), 'v');
    await assert.rejects(
      makeClient({ staleness: 'failHard' }).fetchConfig(),
      /Zero-Knowledge encrypted/,
    );
  } finally { globalThis.fetch = realFetch; }
});

test('rejects a non-kk_ service token at construction', () => {
  assert.throws(() => new KiskisNode({ serviceToken: 'whatever' }), /serviceToken/);
});
