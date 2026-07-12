# kiskis-js

JavaScript/TypeScript SDKs for [KisKis](https://kiskis.dev). Monorepo (npm workspaces).

| Package | Runtime | Gets |
|---|---|---|
| [`@kiskis/web`](packages/web) | the browser | feature flags + remote config (public, signature-verified). **Never secrets.** |
| [`@kiskis/node`](packages/node) | your trusted server / serverless | config + ZK decryption via a read-only service token, signed-response verification, cache + staleness policies |

## Why two packages

The browser is an untrusted runtime: anything you ship to it is readable by anyone, so
`@kiskis/web` only ever reads **public** `browserSafe` config. Secrets belong on a trusted
runtime you control — that's `@kiskis/node` (which can be a long-running server *or* your
own serverless functions). Neither package is KisKis's backend; both are client libraries
that call the KisKis API, exactly like the iOS SDK is a client of the same service.

For secrets that a *browser app* needs to use (e.g. calling OpenAI from an SPA with no
backend), the KisKis Proxy injects the key server-side so it never reaches the browser —
see the design doc.

## Dev

```bash
npm install
npm run build      # build all packages
npm test           # test all packages
npm run typecheck
```

### Browser demo

```bash
npm run build
python3 -m http.server 8099           # or any static server
open http://localhost:8099/demo/index.html
```

The demo reads the KisKis demo app's **live** signed config from
`cfg.kiskis.dev/<appId>/production/flags.json`, verifies its Ed25519 signature in the
browser, and renders the flags — then polls, re-rendering when the config changes on the
CDN (publish with `kiskis upload --browser-safe`; changes go live in ~15s).
`demo/generate-fixture.mjs` still generates a locally-signed fixture for offline work.

## Status

Early. `@kiskis/web` reads and verifies live signed config from the production CDN;
`@kiskis/node` fetches config (plain or Zero-Knowledge) from the production API with a
read-only service token. Sessions and the proxy are the next slices. See
`DESIGN-web-sdk.md` in the service repo for the full plan.
