// Regenerates the demo's signed config fixture and prints the matching public key.
// Stands in for the server's publish-time materialization until the CDN slice lands.
//   node demo/generate-fixture.mjs
import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { mkdirSync, writeFileSync } from 'node:fs';

// Fixed demo private key so the fixture + public key are stable across runs.
const privateKey = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);
const publicKey = await getPublicKeyAsync(privateKey);

const config = {
  flags: { dark_mode: true, beta_banner: false },
  copy: { headline: 'Shipped from KisKis — no rebuild, no redeploy.' },
};

const payload = JSON.stringify(config);
const sig = await signAsync(new TextEncoder().encode(payload), privateKey);
const doc = { payload, sig: Buffer.from(sig).toString('base64'), alg: 'ed25519', signedAt: new Date(0).toISOString() };

// Matches the SDK's URL shape: {cdnBase}/{appId}/{env}/{key}.json
const dir = 'demo/public/demo/production';
mkdirSync(dir, { recursive: true });
writeFileSync(`${dir}/default.json`, JSON.stringify(doc, null, 2));

console.log('Wrote', `${dir}/default.json`);
console.log('Demo public key (base64):', Buffer.from(publicKey).toString('base64'));
