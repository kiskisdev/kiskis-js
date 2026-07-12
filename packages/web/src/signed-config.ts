// The trust boundary of the browser SDK, kept pure and dependency-light so it's
// unit-testable and can't drift.
//
// A materialized config document is public (browserSafe config ships to every visitor
// anyway), so the read path needs no auth. What it DOES need is integrity: a CDN or
// bucket compromise must not be able to feed an app tampered config. So the document is
// Ed25519-signed at publish time over the EXACT payload bytes, and the SDK verifies
// those exact bytes before parsing — never re-serializing, which would risk a mismatch.
//
// Document shape (what the server materializes to cfg.kiskis.dev/{appId}/{env}/{key}.json):
//   { "payload": "<the config JSON, verbatim>", "sig": "<base64 Ed25519 over payload UTF-8>",
//     "alg": "ed25519", "signedAt": "<ISO8601>" }

import { verifyAsync } from '@noble/ed25519';

export interface SignedConfigDoc {
  payload: string;      // the config JSON, exactly as signed
  sig: string;          // base64 Ed25519 signature over the UTF-8 bytes of `payload`
  alg?: string;         // "ed25519"
  signedAt?: string;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Verify a materialized config document against the KisKis signing public key and return
 * the parsed config. Throws if the document is malformed, the algorithm is unexpected, the
 * signature does not verify, or the payload is not valid JSON — the SDK must never hand an
 * app config it could not authenticate.
 */
export async function verifyAndParse(
  rawDocument: string,
  publicKey: Uint8Array,
): Promise<Record<string, unknown>> {
  let doc: SignedConfigDoc;
  try {
    doc = JSON.parse(rawDocument);
  } catch {
    throw new Error('KisKis: config document is not valid JSON');
  }
  if (!doc || typeof doc.payload !== 'string' || typeof doc.sig !== 'string') {
    throw new Error('KisKis: config document missing payload/sig');
  }
  if (doc.alg && doc.alg !== 'ed25519') {
    throw new Error(`KisKis: unsupported signature algorithm "${doc.alg}"`);
  }

  const message = new TextEncoder().encode(doc.payload);
  let ok = false;
  try {
    ok = await verifyAsync(base64ToBytes(doc.sig), message, publicKey);
  } catch {
    ok = false; // malformed signature bytes verify as failure, never throw through
  }
  if (!ok) throw new Error('KisKis: config signature verification failed — refusing to use it');

  try {
    const parsed = JSON.parse(doc.payload);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error();
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('KisKis: signed payload is not a JSON object');
  }
}
