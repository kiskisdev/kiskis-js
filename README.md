# kiskis-js

JavaScript/TypeScript SDKs for [KisKis](https://kiskis.dev) — feature flags, remote config,
and secrets for the web. Monorepo (npm workspaces).

| Package | Runs in | Gives you |
|---|---|---|
| [`@kiskis/web`](packages/web) | the browser | feature flags + remote config (public, signature-verified) and web sessions. **Never raw secrets.** |
| [`@kiskis/node`](packages/node) | your server / serverless | config + Zero-Knowledge secrets via a read-only service token, with signed-response verification and caching |

For a secret a *browser app* must actually use (calling OpenAI from an SPA with no backend),
the **KisKis Proxy** injects the key server-side so it never reaches the page — see
[Secrets in the browser](#4-secrets-in-the-browser-the-proxy) below.

---

## 1. Set up your web app (once, in the dashboard)

Everything starts in the dashboard → **Web Apps** tab: [kiskis.dev/dashboard](https://kiskis.dev/dashboard).

1. **Register a web app.** You get an **`appId`** (e.g. `app_9f31…`, public — it appears in
   CDN URLs) and two **publishable keys**: `kk_pub_live_…` (production) and `kk_pub_test_…`
   (sandbox). Publishable keys are public identifiers — safe to ship in your bundle.
2. **Add your origins.** List the exact origins your site runs on (`https://app.example.com`),
   and map each to `production` or `sandbox`. Add `http://localhost:*` mapped to `sandbox`
   for local dev. **An unlisted origin is refused** — this is your allowlist.
3. **Verify your domain** (needed for the Proxy, and to upgrade to a paid plan). Click
   *Verify domain* on an origin and publish **one** proof:
   - a DNS `TXT` record `kiskis-verify=<token>`, or
   - a file at `https://yourdomain/.well-known/kiskis-verify-<token>` whose body is the token.
   Then click *Check*. localhost origins are dev-exempt and need no verification.
4. **Upload config** (Web Apps → your app → *Manage config*). Tick **Browser-safe** to
   publish a config key to the public CDN for `@kiskis/web`; leave it off for secrets the
   Proxy will inject.

You can do all of this from the CLI too — see [the CLI](#the-cli).

---

## 2. Read config & flags in the browser — `@kiskis/web`

```bash
npm install @kiskis/web
```

```ts
import { KiskisBrowser } from '@kiskis/web';

const kiskis = new KiskisBrowser({
  appId: 'app_9f31…',          // from the dashboard
  key: 'flags',                // which config key to read
  publishableKey: 'kk_pub_live_…', // optional — only needed for session()/proxy
});

// Fetch + verify (Ed25519) the current config.
const config = await kiskis.fetchConfig();
if (config.bool('features.dark_mode')) enableDarkMode();

// Live updates — the callback fires only when the config actually changes on the CDN.
kiskis.startPolling((config) => render(config.bool('features.beta_banner')));
```

- Reads **public, signature-verified** config straight from the CDN
  (`cfg.kiskis.dev/<appId>/<env>/<key>.json`) — no auth, no secret, no KisKis Lambda in the
  read path. Config changes go live in ~15s.
- Verification failure **throws** — the SDK never returns config it couldn't authenticate.
- Accessors: `config.bool(path, fallback)` / `.string(path)` / `.int(path)` / `.raw()`.

### Web sessions (for MAU + the Proxy)

```ts
const kiskis = new KiskisBrowser({ appId, key: 'flags', publishableKey: 'kk_pub_live_…' });
const session = await kiskis.session(); // { token, appId, env, expiresAt }, auto-renewed
```

The server checks that your page's Origin is a registered origin for the app and matches
the key's environment, then returns a signed session token (which the SDK verifies).

---

## 3. Read config & secrets on your server — `@kiskis/node`

```bash
npm install @kiskis/node
```

Create a **read-only service token** in the dashboard (Keys → Access → *Read-only*). It can
fetch config and nothing else — a leaked server token can't modify anything. Put it in your
server env; keep the full `kk_prod_` key in CI only.

```ts
import { KiskisNode } from '@kiskis/node';

const kiskis = new KiskisNode({ serviceToken: process.env.KISKIS_TOKEN }); // kk_read_…
const config = await kiskis.fetchConfig({ key: 'flags' });
config.string('api.base_url');
```

- Every response is Ed25519-signed and verified (path-bound, 5-minute replay window).
- **Zero-Knowledge config** (uploaded with `kiskis upload --encrypt`) decrypts locally when
  you pass `zk: { vaultPass, teamId, bundleId }`.
- Caching + staleness: `freshnessMs`, optional `cacheDir` (0600 on disk), and
  `staleness: 'failHard' | 'warnAndUse' | 'useSilently'`.

---

## 4. Secrets in the browser — the Proxy

The browser can never *hold* a secret, but it can *use* one through the KisKis Proxy: it
forwards a request to a fixed third-party URL with your secret injected server-side, and
streams the response back. The key never reaches the page.

**Configure** (dashboard → Web Apps → *Add proxy route*, or via the API):
- a **target URL** (e.g. `https://api.openai.com/v1/chat/completions`),
- the **config key + field** holding the secret (upload it as a *non*-browser-safe key),
- the **header + format** to inject (e.g. `Authorization: Bearer {secret}`).

You get a route URL: `https://proxy.kiskis.dev/r/<routeId>`.

**Call it from the browser** with your web session:

```ts
const { token } = await kiskis.session();
const res = await fetch('https://proxy.kiskis.dev/r/rt_1234…', {
  method: 'POST',
  headers: { 'X-Kiskis-Session': token, 'Content-Type': 'application/json' },
  body: JSON.stringify({ model: 'gpt-4o', messages: [...] }),
});
// res streams the upstream response; your OpenAI key was injected server-side.
```

The Proxy requires the origin to be **domain-verified** (localhost exempt) and rate-limits
per route.

---

## 5. How do I test it?

Use the **sandbox** environment while developing (the `kk_pub_test_…` key, an origin mapped
to `sandbox`, and `http://localhost:*`). Nothing you do in sandbox counts toward billing.

- **Config is reaching the CDN?** `curl` the object directly:
  ```bash
  curl https://cfg.kiskis.dev/<appId>/production/flags.json
  ```
  You should see `{ "payload": "…", "sig": "…", "alg": "ed25519", … }`. Re-upload and it
  updates within ~15s.
- **Flags render in the browser?** Point `@kiskis/web` at your `appId`/`key` and log
  `config.raw()`. The included **demo** is a working reference:
  ```bash
  npm install && npm run build
  python3 -m http.server 8099
  open http://localhost:8099/demo/index.html   # live signed config from cfg.kiskis.dev
  ```
- **Sessions work?** `await kiskis.session()` should resolve to a token; a wrong/unmapped
  origin or an env mismatch is a `403`.
- **The Proxy injects the secret?** Point a test route at an echo service
  (`https://postman-echo.com/post`) and confirm the response shows your injected header —
  proving the secret was added server-side and never left your page. Unverified origin →
  `403`; missing session → `401`.

---

## The CLI

Everything the dashboard does is scriptable:

```bash
brew tap kiskisdev/homebrew-cli && brew install kiskis

# publish browser-safe flags to the CDN (prints the live cfg.kiskis.dev URL)
kiskis upload --file flags.json --key flags --browser-safe

# upload a secret for a Proxy route (NOT browser-safe)
kiskis upload --file openai.json --key openai
```

---

## Contributing / local dev

```bash
npm install
npm run build      # build all packages
npm test           # test all packages (node:test)
npm run typecheck
```

`demo/generate-fixture.mjs` generates a locally-signed config fixture for fully-offline demo
work. The full design lives in `DESIGN-web-sdk.md` in the service repo.
