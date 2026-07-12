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

// The KisKis config-signing Ed25519 public key (32 raw bytes, base64). Placeholder until
// the CDN materialization ships — wired to the real /kiskis/prod/response-signing-key
// public half in the next slice. Callers can override via `publicKey` for testing.
const DEFAULT_PUBLIC_KEY_B64 = '';

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
  private etag: string | null = null;
  private current: KiskisConfig | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: KiskisBrowserOptions) {
    if (!opts.appId) throw new Error('KisKis: appId is required');
    const key = opts.key ?? 'default';
    const env = opts.env ?? 'production';
    const base = (opts.cdnBase ?? DEFAULT_CDN_BASE).replace(/\/+$/, '');
    this.url = `${base}/${encodeURIComponent(opts.appId)}/${env}/${encodeURIComponent(key)}.json`;
    this.publicKey = opts.publicKey ?? base64ToBytes(DEFAULT_PUBLIC_KEY_B64 || 'AA==');
    this.pollMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  }

  /** The most recently fetched config, or null before the first fetch. */
  get config(): KiskisConfig | null {
    return this.current;
  }

  /**
   * Fetch and verify the latest config. Sends If-None-Match so an unchanged config is a
   * cheap 304 from the CDN edge (no origin hit). Returns the current config on 304.
   */
  async fetchConfig(): Promise<KiskisConfig> {
    const headers: Record<string, string> = {};
    if (this.etag) headers['If-None-Match'] = this.etag;

    const res = await fetch(this.url, { headers, cache: 'no-cache' });
    if (res.status === 304 && this.current) return this.current;
    if (!res.ok) throw new Error(`KisKis: config fetch failed (HTTP ${res.status})`);

    const raw = await res.text();
    const data = await verifyAndParse(raw, this.publicKey);
    this.etag = res.headers.get('ETag');
    this.current = new KiskisConfig(data);
    return this.current;
  }

  /**
   * Start polling. Calls `onChange` with a fresh config only when the ETag changes.
   * Returns a stop function.
   */
  startPolling(onChange: (config: KiskisConfig) => void, onError?: (err: unknown) => void): () => void {
    const tick = async () => {
      const before = this.etag;
      try {
        const cfg = await this.fetchConfig();
        if (this.etag !== before) onChange(cfg);
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
