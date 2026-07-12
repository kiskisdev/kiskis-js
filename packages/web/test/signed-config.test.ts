import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { verifyAndParse } from '../src/signed-config.ts';
import { KiskisConfig } from '../src/config.ts';

// Build a materialized document exactly as the server will: sign the EXACT payload bytes.
async function makeDoc(config: object, privateKey: Uint8Array): Promise<string> {
  const payload = JSON.stringify(config);
  const sig = await signAsync(new TextEncoder().encode(payload), privateKey);
  return JSON.stringify({ payload, sig: Buffer.from(sig).toString('base64'), alg: 'ed25519', signedAt: '2026-07-11T00:00:00Z' });
}

// A fixed 32-byte private key so the test is deterministic (Date/Math.random-free).
const privateKey = new Uint8Array(32).map((_, i) => (i * 7 + 3) & 0xff);

test('a genuine signed document verifies and parses', async () => {
  const publicKey = await getPublicKeyAsync(privateKey);
  const doc = await makeDoc({ flags: { dark_mode: true }, api: { timeout: 30 } }, privateKey);

  const parsed = await verifyAndParse(doc, publicKey);
  const cfg = new KiskisConfig(parsed);
  assert.equal(cfg.bool('flags.dark_mode'), true);
  assert.equal(cfg.int('api.timeout'), 30);
  assert.equal(cfg.bool('flags.missing'), false);      // fallback
  assert.equal(cfg.string('api.timeout'), undefined);  // wrong type → undefined
});

// The whole reason the document is signed: a tampered CDN/bucket must be rejected.
test('a tampered payload is rejected', async () => {
  const publicKey = await getPublicKeyAsync(privateKey);
  const doc = JSON.parse(await makeDoc({ flags: { dark_mode: false } }, privateKey));
  doc.payload = doc.payload.replace('false', 'true'); // flip the flag, keep the old sig
  await assert.rejects(() => verifyAndParse(JSON.stringify(doc), publicKey), /signature verification failed/);
});

test('a document signed by a DIFFERENT key is rejected', async () => {
  const wrongKey = await getPublicKeyAsync(new Uint8Array(32).fill(9));
  const doc = await makeDoc({ flags: { x: 1 } }, privateKey);
  await assert.rejects(() => verifyAndParse(doc, wrongKey), /signature verification failed/);
});

test('malformed documents throw, never silently pass', async () => {
  const publicKey = await getPublicKeyAsync(privateKey);
  await assert.rejects(() => verifyAndParse('not json', publicKey), /not valid JSON/);
  await assert.rejects(() => verifyAndParse('{"payload":"{}"}', publicKey), /missing payload\/sig/);
  await assert.rejects(() => verifyAndParse(JSON.stringify({ payload: '{}', sig: 'x', alg: 'rsa' }), publicKey), /unsupported signature/);
});
