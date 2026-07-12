# @kiskis/web

Feature flags and remote config for the browser, from [KisKis](https://kiskis.dev).

Reads **public, signature-verified** config from the KisKis CDN — no auth, no secret, and
no KisKis Lambda in the read path (config is a materialized, Ed25519-signed static object
behind CloudFront). Your keys never ship to the browser; for secret-backed calls from a
browser app, use the KisKis Proxy.

```ts
import { KiskisBrowser } from '@kiskis/web';

const kiskis = new KiskisBrowser({ appId: 'app_9f31…', key: 'flags' });

const config = await kiskis.fetchConfig();
if (config.bool('features.dark_mode')) enableDarkMode();

// Live updates — the callback fires only when the config actually changes.
kiskis.startPolling((config) => {
  render(config.bool('features.beta_banner'));
});
```

## API

- `new KiskisBrowser({ appId, key?, env?, cdnBase?, publicKey?, pollIntervalMs? })`
- `fetchConfig(): Promise<KiskisConfig>` — fetch + verify (revalidates via the browser cache, so unchanged config is a cheap 304 on the wire).
- `startPolling(onChange, onError?): () => void` — poll; fires `onChange` only on change.
- `config.bool(path, fallback=false)` / `.string(path)` / `.int(path)` / `.raw()`

## Integrity

Every config document is Ed25519-signed at publish time; the SDK verifies the exact signed
bytes before use, so a compromised CDN or bucket cannot feed your app tampered config.
Verification failure throws — the SDK never returns config it could not authenticate.

## Not for secrets

`@kiskis/web` reads only config a developer explicitly marked `browserSafe` — public by
definition. It cannot fetch secrets. Use `@kiskis/node` on a trusted runtime, or the KisKis
Proxy for browser apps that must *use* a secret without holding it.
