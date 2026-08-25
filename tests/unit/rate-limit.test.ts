import { describe, expect, it } from "vitest";
import { RateLimiter } from "@shared/rate-limit";

describe("RateLimiter (sliding window)", () => {
  it("allows requests under the limit", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 5; i++) {
      expect(limiter.check("key", 5, 1000).allowed).toBe(true);
    }
  });

  it("blocks the 6th request within the window", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 5; i++) limiter.check("key", 5, 50);
    const result = limiter.check("key", 5, 50);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThan(0);
  });

  it("tracks keys independently", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("a", 3, 1000);
    expect(limiter.check("a", 3, 1000).allowed).toBe(false);
    expect(limiter.check("b", 3, 1000).allowed).toBe(true);
  });

  it("recovers after the window passes", async () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 2; i++) limiter.check("key", 2, 10);
    expect(limiter.check("key", 2, 10).allowed).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(limiter.check("key", 2, 10).allowed).toBe(true);
  });

  it("reset clears history", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("key", 3, 10_000);
    expect(limiter.check("key", 3, 10_000).allowed).toBe(false);
    limiter.reset("key");
    expect(limiter.check("key", 3, 10_000).allowed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Additional edge cases (production readiness sweep)
// ---------------------------------------------------------------------------

describe("RateLimiter (additional edge cases)", () => {
  it("returns a non-zero retry-after when blocked", () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 3; i++) limiter.check("k", 3, 5000);
    const result = limiter.check("k", 3, 5000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterSec).toBeGreaterThanOrEqual(1);
    expect(result.retryAfterSec).toBeLessThanOrEqual(5);
  });

  it("returns 0 retry-after when allowed", () => {
    const limiter = new RateLimiter();
    expect(limiter.check("k", 5, 1000).retryAfterSec).toBe(0);
  });

  it("sliding window: a request from 1s ago doesn't get filtered out", async () => {
    const limiter = new RateLimiter();
    limiter.check("k", 2, 1000);
    await new Promise((r) => setTimeout(r, 50));
    expect(limiter.check("k", 2, 1000).allowed).toBe(true);
  });

  it("evicts expired timestamps after window passes", async () => {
    const limiter = new RateLimiter();
    for (let i = 0; i < 2; i++) limiter.check("k", 2, 20);
    expect(limiter.check("k", 2, 20).allowed).toBe(false);
    await new Promise((r) => setTimeout(r, 30));
    // After the window passes, the in-memory filter rejects the old hits and
    // a new request succeeds.
    expect(limiter.check("k", 2, 20).allowed).toBe(true);
  });

  it("handles 5000+ keys without crashing (opportunistic cleanup)", () => {
    const limiter = new RateLimiter();
    // Fill the map past the cleanup threshold.
    for (let i = 0; i < 5100; i++) {
      limiter.check(`k${i}`, 5, 1);
    }
    // After cleanup, new keys still work and an old one (now expired) also works.
    expect(limiter.check("k0", 5, 1).allowed).toBe(true);
  });

  it("treats different limits per key independently", () => {
    const limiter = new RateLimiter();
    expect(limiter.check("a", 1, 1000).allowed).toBe(true);
    expect(limiter.check("a", 1, 1000).allowed).toBe(false);
    expect(limiter.check("b", 1, 1000).allowed).toBe(true);
  });

  it("reset on a non-existent key is a no-op", () => {
    const limiter = new RateLimiter();
    expect(() => limiter.reset("never-existed")).not.toThrow();
  });
});
