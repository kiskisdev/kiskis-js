# @kiskis/node

Config and secrets for Node runtimes, from [KisKis](https://kiskis.dev) — servers,
serverless functions, CI. Full parity with the iOS SDK's config path.

```ts
import { KiskisNode } from '@kiskis/node';

const kiskis = new KiskisNode({
  serviceToken: process.env.KISKIS_TOKEN, // kk_read_… from the dashboard Keys panel
});

const config = await kiskis.fetchConfig({ key: 'flags' });
if (config.bool('features.dark_mode')) enableDarkMode();
```

## Auth: read-only by construction

Create a **read-only** key (`kk_read_…`) in the dashboard Keys panel and put it in your
server env. It can fetch config and nothing else — the KisKis server rejects it on every
write endpoint, so a leaked server credential cannot modify config, send pushes, or
revoke keys. Keep the full `kk_prod_` key in CI only.

## Integrity

Every response is Ed25519-signed by the KisKis backend; the SDK verifies the exact
signed bytes (path-bound, 5-minute replay window) with a pinned public key before
returning anything. Verification failure throws.

## Zero-Knowledge config

Config uploaded with `kiskis upload --encrypt` never exists in plaintext on KisKis
servers. Pass your vault identity and the SDK decrypts locally:

```ts
const kiskis = new KiskisNode({
  serviceToken: process.env.KISKIS_TOKEN,
  zk: { vaultPass: process.env.VAULT_PASS, teamId: 'TEAM123456', bundleId: 'com.my.app' },
});
```

The disk cache stores ZK config as ciphertext — plaintext never touches disk.

## Caching and staleness

```ts
new KiskisNode({
  serviceToken,
  freshnessMs: 60_000,        // serve from cache without a network call when younger
  cacheDir: '/var/tmp/kiskis', // optional disk cache — survives restarts (0600 files)
  staleness: 'warnAndUse',     // on fetch failure with a cache: warnAndUse (default),
                               // useSilently, or failHard
});
```

- `fetchConfig({ key, forceRefresh })` — fetch + verify; freshness-window aware.
- `config.bool(path, fallback)` / `.string(path)` / `.int(path)` / `.raw()`
