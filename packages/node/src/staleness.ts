// Staleness policy — what to do when a fetch fails and a cached config exists.
// Pure decision function so the policy table is unit-testable. Mirrors the iOS SDK.

export type StalenessPolicy = 'failHard' | 'warnAndUse' | 'useSilently';

export type StalenessDecision =
  | { action: 'throw' }
  | { action: 'use-cache'; warn: boolean };

export function decideOnFetchFailure(
  policy: StalenessPolicy,
  hasCache: boolean,
): StalenessDecision {
  if (!hasCache) return { action: 'throw' };            // nothing to fall back to
  switch (policy) {
    case 'failHard':    return { action: 'throw' };
    case 'warnAndUse':  return { action: 'use-cache', warn: true };
    case 'useSilently': return { action: 'use-cache', warn: false };
  }
}

/** Is a cache entry fresh enough to skip the network entirely? */
export function cacheIsFresh(fetchedAtMs: number, maxAgeMs: number | undefined, nowMs: number): boolean {
  if (maxAgeMs === undefined) return false; // no freshness window → always revalidate
  return nowMs - fetchedAtMs <= maxAgeMs;
}
