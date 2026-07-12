import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'node:crypto';
import { verifySignedResponse, publicKeyFromRawB64 } from '../src/verify.js';

// Sign exactly like the delivery Lambda's signResponseBody.
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const rawPubB64 = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64');
const pinned = publicKeyFromRawB64(rawPubB64);

function sign(ts: number, path: string, body: string): string {
  return crypto.sign(null, Buffer.from(`${ts}:${path}:${body}`, 'utf8'), privateKey).toString('base64url');
}

const NOW = 1_800_000_000;
const BODY = JSON.stringify({ config: { a: 1 }, matchedPattern: '*' });

test('valid signature within the window verifies', () => {
  const sig = sign(NOW, '/config', BODY);
  verifySignedResponse({ body: BODY, sig, ts: NOW, path: '/config' }, pinned, NOW + 10);
});

test('tampered body is rejected', () => {
  const sig = sign(NOW, '/config', BODY);
  const tampered = BODY.replace('"a":1', '"a":2');
  assert.throws(
    () => verifySignedResponse({ body: tampered, sig, ts: NOW, path: '/config' }, pinned, NOW),
    /signature verification failed/,
  );
});

test('a /config signature cannot be replayed against another path', () => {
  const sig = sign(NOW, '/config', BODY);
  assert.throws(
    () => verifySignedResponse({ body: BODY, sig, ts: NOW, path: '/user/data' }, pinned, NOW),
    /signature verification failed/,
  );
});

test('signatures outside the 5-minute replay window are rejected', () => {
  const sig = sign(NOW, '/config', BODY);
  assert.throws(
    () => verifySignedResponse({ body: BODY, sig, ts: NOW, path: '/config' }, pinned, NOW + 301),
    /replay window/,
  );
  // Just inside the window still verifies.
  verifySignedResponse({ body: BODY, sig, ts: NOW, path: '/config' }, pinned, NOW + 299);
});

test('missing signature headers are rejected, wrong key is rejected', () => {
  const sig = sign(NOW, '/config', BODY);
  assert.throws(
    () => verifySignedResponse({ body: BODY, sig: '', ts: NOW, path: '/config' }, pinned, NOW),
    /missing X-Kiskis-Sig/,
  );
  assert.throws(
    () => verifySignedResponse({ body: BODY, sig, ts: NaN, path: '/config' }, pinned, NOW),
    /missing X-Kiskis-Sig-Ts/,
  );
  const otherPub = publicKeyFromRawB64(
    crypto.generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64'),
  );
  assert.throws(
    () => verifySignedResponse({ body: BODY, sig, ts: NOW, path: '/config' }, otherPub, NOW),
    /signature verification failed/,
  );
});
