// @kiskis/node — KisKis server SDK.
//
// Runs where credentials can live: your server, serverless functions, CI. Full parity
// with the iOS SDK's config path: signed-response verification, ZK decryption, caching
// with staleness policies. Auth is a service token (kk_read_… from the dashboard Keys
// panel — read-only by construction; the server rejects it for every write endpoint).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { KiskisConfig } from './config.js';
import { verifySignedResponse, publicKeyFromRawB64 } from './verify.js';
import { zkDecrypt, type ZkIdentity } from './zk.js';
import { decideOnFetchFailure, cacheIsFresh, type StalenessPolicy } from './staleness.js';

export { KiskisConfig } from './config.js';
export { verifySignedResponse, publicKeyFromRawB64, SIGNATURE_MAX_AGE_SECONDS } from './verify.js';
export { zkDecrypt, zkEncrypt, type ZkIdentity } from './zk.js';
export { decideOnFetchFailure, cacheIsFresh, type StalenessPolicy } from './staleness.js';

// Public half of the KisKis response-signing key — same pin as the iOS SDK and @kiskis/web.
const DEFAULT_PUBLIC_KEY_B64 = 'LNhWnM1urrQcPFe4Xu/woTDu8O3sAmhtq4vEl+a6da8=';
const DEFAULT_API_BASE = 'https://api.kiskis.dev';

export interface KiskisNodeOptions {
  /** Service token from the dashboard Keys panel (kk_read_… recommended for servers). */
  serviceToken: string;
  /** Environment (default "production"). */
  env?: 'production' | 'sandbox';
  /** App version for version-targeted config (default "1.0"). */
  version?: string;
  /** API base URL (default https://api.kiskis.dev). */
  apiBase?: string;
  /** Override the pinned signing public key (raw 32 bytes, base64) — tests only. */
  publicKeyB64?: string;
  /** What to do when a fetch fails but a cached config exists (default "warnAndUse"). */
  staleness?: StalenessPolicy;
  /** Serve from cache without a network round-trip when younger than this. */
  freshnessMs?: number;
  /** Directory for the optional disk cache (survives process restarts). */
  cacheDir?: string;
  /** Zero-Knowledge identity; when set, string config payloads are decrypted locally. */
  zk?: ZkIdentity;
}

export interface FetchConfigOptions {
  /** Config key (default "default"). */
  key?: string;
  /** Skip the freshness window and force a network fetch. */
  forceRefresh?: boolean;
}

interface CacheEntry {
  fetchedAtMs: number;
  // Why raw (string ciphertext for ZK, object otherwise), not decrypted data: the disk
  // cache must never hold ZK plaintext — that would defeat Zero-Knowledge at rest.
  // Decryption happens at access time, like the iOS SDK's encrypted ConfigCache.
  raw: unknown;
}

export class KiskisNode {
  private readonly opts: Required<Pick<KiskisNodeOptions, 'env' | 'version' | 'apiBase' | 'staleness'>> & KiskisNodeOptions;
  private readonly publicKey;
  private readonly memory = new Map<string, CacheEntry>();

  constructor(options: KiskisNodeOptions) {
    if (!options.serviceToken?.startsWith('kk_')) {
      throw new Error('KisKis: serviceToken is required (a kk_… credential from the dashboard)');
    }
    this.opts = {
      env: 'production',
      version: '1.0',
      apiBase: DEFAULT_API_BASE,
      staleness: 'warnAndUse',
      ...options,
    };
    this.publicKey = publicKeyFromRawB64(options.publicKeyB64 ?? DEFAULT_PUBLIC_KEY_B64);
  }

  /**
   * Fetch, verify, and return config. Within `freshnessMs` the cached copy is returned
   * with no network round-trip. On fetch/verification failure the staleness policy
   * decides: failHard throws, warnAndUse/useSilently fall back to cache when one exists.
   */
  async fetchConfig(fetchOpts: FetchConfigOptions = {}): Promise<KiskisConfig> {
    const key = fetchOpts.key ?? 'default';
    const cached = this.memory.get(key) ?? this.readDiskCache(key);

    if (!fetchOpts.forceRefresh && cached
        && cacheIsFresh(cached.fetchedAtMs, this.opts.freshnessMs, Date.now())) {
      return new KiskisConfig(this.resolveConfig(cached.raw));
    }

    try {
      const raw = await this.fetchAndVerify(key);
      const resolved = this.resolveConfig(raw); // resolve BEFORE caching a bad payload
      const entry: CacheEntry = { fetchedAtMs: Date.now(), raw };
      this.memory.set(key, entry);
      this.writeDiskCache(key, entry);
      return new KiskisConfig(resolved);
    } catch (err) {
      const decision = decideOnFetchFailure(this.opts.staleness, Boolean(cached));
      if (decision.action === 'throw') throw err;
      if (decision.warn) {
        console.warn(`KisKis: fetch failed, serving cached config for "${key}":`, (err as Error).message);
      }
      return new KiskisConfig(this.resolveConfig(cached!.raw));
    }
  }

  /** ZK config arrives (and is cached) as an opaque base64 string; decrypt at access time. */
  private resolveConfig(raw: unknown): Record<string, unknown> {
    let config = raw;
    if (typeof config === 'string') {
      if (!this.opts.zk) {
        throw new Error('KisKis: config is Zero-Knowledge encrypted — pass `zk: { vaultPass, teamId, bundleId }`');
      }
      config = JSON.parse(zkDecrypt(config, this.opts.zk).toString('utf8'));
    }
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      throw new Error('KisKis: response did not contain a config object');
    }
    return config as Record<string, unknown>;
  }

  private async fetchAndVerify(key: string): Promise<unknown> {
    const requestPath = '/config';
    const url = `${this.opts.apiBase}${requestPath}?version=${encodeURIComponent(this.opts.version)}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.opts.serviceToken}`,
        'X-Environment': this.opts.env,
      },
    });
    const body = await res.text();
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try { message = JSON.parse(body).error ?? message; } catch { /* not JSON */ }
      throw new Error(`KisKis: config fetch failed — ${message}`);
    }

    // Verify the EXACT bytes the server signed before trusting anything in them.
    verifySignedResponse({
      body,
      sig: res.headers.get('X-Kiskis-Sig') ?? '',
      ts: parseInt(res.headers.get('X-Kiskis-Sig-Ts') ?? '', 10),
      path: requestPath,
    }, this.publicKey);

    return JSON.parse(body).config;
  }

  // ── Disk cache (optional): {cacheDir}/{env}-{key}.json, owner-only. ──

  private diskPath(key: string): string | null {
    if (!this.opts.cacheDir) return null;
    // key is validated server-side to [a-zA-Z0-9_.-]; sanitize anyway for path safety.
    const safe = key.replace(/[^a-zA-Z0-9_.\-]/g, '_');
    return path.join(this.opts.cacheDir, `${this.opts.env}-${safe}.json`);
  }

  private readDiskCache(key: string): CacheEntry | undefined {
    const p = this.diskPath(key);
    if (!p) return undefined;
    try {
      const entry = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (typeof entry.fetchedAtMs === 'number' && entry.data && typeof entry.data === 'object') {
        return entry;
      }
    } catch { /* missing or corrupt cache is the same as no cache */ }
    return undefined;
  }

  private writeDiskCache(key: string, entry: CacheEntry): void {
    const p = this.diskPath(key);
    if (!p) return;
    try {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      // Why mode 0600: decrypted/plain config on a shared host is for this process only.
      fs.writeFileSync(p, JSON.stringify(entry), { mode: 0o600 });
    } catch (err) {
      console.warn('KisKis: disk cache write failed:', (err as Error).message);
    }
  }
}
