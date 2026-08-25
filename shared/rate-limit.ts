// In-memory sliding-window rate limiter (per process). Documented limitation:
// REST routes and the socket service each keep their own counters.

export interface RateCheckResult {
  allowed: boolean;
  retryAfterSec: number;
}

export class RateLimiter {
  private hits = new Map<string, number[]>();

  check(key: string, limit: number, windowMs: number): RateCheckResult {
    const now = Date.now();
    const windowStart = now - windowMs;
    const hits = (this.hits.get(key) ?? []).filter((t) => t > windowStart);

    if (hits.length >= limit) {
      const oldest = hits[0];
      const retryAfterMs = oldest + windowMs - now;
      this.hits.set(key, hits);
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
    }

    hits.push(now);
    this.hits.set(key, hits);

    // Opportunistic cleanup to bound memory.
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (v.every((t) => t <= windowStart)) this.hits.delete(k);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  reset(key: string): void {
    this.hits.delete(key);
  }
}

export const loginLimiter = new RateLimiter();
export const messageLimiter = new RateLimiter();
export const uploadLimiter = new RateLimiter();
