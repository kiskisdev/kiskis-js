// Zero-Knowledge decryption — byte-compatible with the KisKis CLI's `encrypt` and the
// iOS SDK's ZeroKnowledgeCrypto. AES-256-GCM, HKDF-SHA256 key derivation.
// Wire format: nonce (12 bytes) || ciphertext || tag (16 bytes), transported base64.

import * as crypto from 'node:crypto';

function deriveKey(password: string, teamId: string, bundleId: string): Buffer {
  // Why: per-customer salt — the same vault password in two different apps produces
  // different keys. Matches CLI crypto.ts and iOS ZeroKnowledgeCrypto (v2 salt).
  const salt = Buffer.from(`kiskis-zk-v2:${teamId}:${bundleId}`, 'utf8');
  const info = Buffer.from('kiskis-zk-v1', 'utf8');
  return Buffer.from(crypto.hkdfSync('sha256', Buffer.from(password, 'utf8'), salt, info, 32));
}

export interface ZkIdentity {
  vaultPass: string;
  teamId: string;
  bundleId: string;
}

export function zkDecrypt(dataB64: string, id: ZkIdentity): Buffer {
  const data = Buffer.from(dataB64, 'base64');
  if (data.length < 12 + 16) throw new Error('KisKis: ZK payload too short to be valid');
  const key = deriveKey(id.vaultPass, id.teamId, id.bundleId);
  const nonce = data.subarray(0, 12);
  const ciphertext = data.subarray(12, data.length - 16);
  const tag = data.subarray(data.length - 16);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Test/tooling helper — same algorithm the CLI uses to encrypt before upload. */
export function zkEncrypt(data: Buffer, id: ZkIdentity): string {
  const key = deriveKey(id.vaultPass, id.teamId, id.bundleId);
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}
