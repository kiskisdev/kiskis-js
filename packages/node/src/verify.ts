// Ed25519 verification of KisKis delivery responses (X-Kiskis-Sig / X-Kiskis-Sig-Ts).
// Signed payload: `${ts}:${path}:${body}` — matches the delivery Lambda's
// signResponseBody and the iOS SDK's verifier. Node runtime → node:crypto, no deps.

import * as crypto from 'node:crypto';

/** Base64url signature over `${ts}:${path}:${body}`; ts bounds the replay window. */
export interface SignedResponse {
  body: string;      // exact raw response body bytes as a UTF-8 string
  sig: string;       // X-Kiskis-Sig (base64url)
  ts: number;        // X-Kiskis-Sig-Ts (unix seconds)
  path: string;      // request path the client actually called, e.g. '/config'
}

// Same replay window the iOS SDK enforces.
export const SIGNATURE_MAX_AGE_SECONDS = 300;

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

export function publicKeyFromRawB64(rawB64: string): crypto.KeyObject {
  const raw = Buffer.from(rawB64, 'base64');
  if (raw.length !== 32) throw new Error('KisKis: public key must be 32 raw bytes (base64)');
  return crypto.createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki',
  });
}

/**
 * Verify a signed delivery response. Throws on any failure — the SDK never returns
 * data it could not authenticate. `nowSeconds` is injectable for tests.
 */
export function verifySignedResponse(
  res: SignedResponse,
  publicKey: crypto.KeyObject,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): void {
  if (!res.sig) throw new Error('KisKis: response is missing X-Kiskis-Sig');
  if (!Number.isFinite(res.ts)) throw new Error('KisKis: response is missing X-Kiskis-Sig-Ts');
  if (Math.abs(nowSeconds - res.ts) > SIGNATURE_MAX_AGE_SECONDS) {
    throw new Error('KisKis: response signature is outside the replay window');
  }
  const payload = Buffer.from(`${res.ts}:${res.path}:${res.body}`, 'utf8');
  const sig = Buffer.from(res.sig, 'base64url');
  if (!crypto.verify(null, payload, publicKey, sig)) {
    throw new Error('KisKis: response signature verification failed');
  }
}
