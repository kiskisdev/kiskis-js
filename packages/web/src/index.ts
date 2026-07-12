// @kiskis/web — browser SDK for KisKis feature flags and remote config.
//
// Reads PUBLIC, signature-verified config from the KisKis CDN. There is no auth on this
// path by design: browserSafe config is public (it ships to every visitor). The SDK never
// receives a secret — secrets stay server-side (@kiskis/node) or behind the proxy.
//
// Transport (per the design's CDN contract): plain HTTP polling with ETag/304, served
// from CloudFront in front of a materialized S3 object — no KisKis Lambda in the read
// path at any scale.

import { verifyAndParse } from './signed-config.js';
import { KiskisConfig } from './config.js';

export { KiskisConfig } from './config.js';
export { verifyAndParse } from './signed-config.js';

// The KisKis config-signing Ed25519 public key (32 raw bytes, base64). This is the public
// half of /kiskis/prod/response-signing-key — the same key the iOS SDK pins and the
// management Lambda signs materialized config with. Callers can override via `publicKey`
// for testing against a locally-generated keypair.
const DEFAULT_PUBLIC_KEY_B64 = 'LNhWnM1urrQcPFe4Xu/woTDu8O3sAmhtq4vEl+a6da8=';

const DEFAULT_CDN_BASE = 'https://cfg.kiskis.dev';
const DEFAULT_POLL_MS = 45_000;

export interface KiskisBrowserOptions {
  /** The KisKis app id (e.g. "app_9f31…"). */
  appId: string;
  /** Config key to read (default "default"). */
  key?: string;
  /** Environment (default "production"). */
  env?: 'production' | 'sandbox';
  /** CDN base URL (default https://cfg.kiskis.dev). */
  cdnBase?: string;
  /** KisKis signing public key, 32 raw bytes. Defaults to the bundled key. */
  publicKey?: Uint8Array;
  /** Poll interval in ms (default 45000). */
  pollIntervalMs?: number;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class KiskisBrowser {
  private readonly url: string;
  private readonly publicKey: Uint8Array;
  private readonly pollMs: number;
  private lastRaw: string | null = null;
  private current: KiskisConfig | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: KiskisBrowserOptions) {
    if (!opts.appId) throw new Error('KisKis: appId is required');
    const key = opts.key ?? 'default';
    const env = opts.env ?? 'production';
    const base = (opts.cdnBase ?? DEFAULT_CDN_BASE).replace(/\/+$/, '');
    this.url = `${base}/${encodeURIComponent(opts.appId)}/${env}/${encodeURIComponent(key)}.json`;
    this.publicKey = opts.publicKey ?? base64ToBytes(DEFAULT_PUBLIC_KEY_B64);
    this.pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  /** The most recently fetched config, or null before the first fetch. */
  get config(): KiskisConfig | null {
    return this.current;
  }

  /**
   * Fetch and verify the latest config.
   * Why no manual If-None-Match: a hand-set conditional header is not CORS-safelisted, so
   * it forces an OPTIONS preflight the CDN rejects (GET/HEAD only) — and ETag isn't in
   * Access-Control-Expose-Headers anyway. `cache: 'no-cache'` makes the BROWSER revalidate
   * with its own internal conditional (no preflight), so the wire still gets 304s; change
   * detection compares document bytes instead. Skips re-verifying an unchanged document.
   */
  async fetchConfig(): Promise<KiskisConfig> {
    const res = await fetch(this.url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`KisKis: config fetch failed (HTTP ${res.status})`);

    const raw = await res.text();
    if (raw === this.lastRaw && this.current) return this.current;
    const data = await verifyAndParse(raw, this.publicKey);
    this.lastRaw = raw;
    this.current = new KiskisConfig(data);
    return this.current;
  }

  /**
   * Start polling. Calls `onChange` with a fresh config only when the document changes.
   * Returns a stop function.
   */
  startPolling(onChange: (config: KiskisConfig) => void, onError?: (err: unknown) => void): () => void {
    const tick = async () => {
      const before = this.lastRaw;
      try {
        const cfg = await this.fetchConfig();
        if (this.lastRaw !== before) onChange(cfg);
      } catch (err) {
        onError?.(err);
      }
    };
    void tick();
    this.timer = setInterval(tick, this.pollMs);
    return () => this.stop();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
