# kiskis-js

JavaScript/TypeScript SDKs for [KisKis](https://kiskis.dev). Monorepo (npm workspaces).

| Package | Runtime | Gets |
|---|---|---|
| [`@kiskis/web`](packages/web) | the browser | feature flags + remote config (public, signature-verified). **Never secrets.** |
| `@kiskis/node` *(planned)* | your trusted server / serverless | real secrets, ZK mode — full parity with the iOS SDK |

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
node demo/generate-fixture.mjs        # writes a locally-signed config fixture
python3 -m http.server 8099           # or any static server
open http://localhost:8099/demo/index.html
```

The demo reads a **signed** config document, verifies its Ed25519 signature in the browser,
and renders the flags — a local stand-in for `cfg.kiskis.dev/<appId>/<env>/<key>.json`.

## Status

Early. `@kiskis/web` reads and verifies signed config today; the CDN materialization that
publishes those documents (and the `@kiskis/node` package, sessions, and proxy) are the
next slices. See `DESIGN-web-sdk.md` in the service repo for the full plan.
