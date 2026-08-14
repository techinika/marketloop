/**
 * Tiny best-effort TTL cache for idempotent GET payloads.
 *
 * Backed by the Workers Cache API (`caches.default`) when it exists; no-ops
 * everywhere else (local dev, Node-based tests) where `caches` is undefined,
 * so the test suites exercise the real Firestore path every time.
 *
 * Entries are JSON blobs carrying an absolute expiry so the TTL is independent
 * of the CDN's eviction policy. Every failure mode falls through to the caller
 * — this layer must never make a request fail.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

function cacheBackend(): Cache | null {
  if (typeof caches !== "undefined" && caches.default) return caches.default;
  return null;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  const cache = cacheBackend();
  if (!cache) return null;
  try {
    const res = await cache.match(key);
    if (!res) return null;
    const entry = (await res.json()) as CacheEntry<T>;
    if (entry.expiresAt <= Date.now()) {
      await cache.delete(key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export async function cachePut<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
  const cache = cacheBackend();
  if (!cache) return;
  try {
    const entry: CacheEntry<T> = { data: value, expiresAt: Date.now() + ttlSeconds * 1000 };
    const res = new Response(JSON.stringify(entry), {
      headers: { "Cache-Control": `max-age=${Math.max(0, Math.floor(ttlSeconds))}` },
    });
    await cache.put(key, res);
  } catch {
    // best-effort: never let caching fail the request
  }
}
