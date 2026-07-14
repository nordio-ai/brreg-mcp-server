import { describe, it, expect, vi } from "vitest";
import { brregGet, buildUrl, retryDelayMs, isRetryable } from "../src/http.js";

/**
 * [fixture] Retry/backoff.
 *
 * ⚠️ This path has NEVER fired against the live register: brreg publishes no rate limit, and
 * 13,028 real lookups at concurrency 8 drew zero 429s. These tests prove the logic is correct,
 * NOT that brreg behaves this way. Fixture-only by nature.
 */

const res = (status: number, headers: Record<string, string> = {}) =>
  new Response(status === 200 ? JSON.stringify({ navn: "X" }) : "", {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const noSleep = async () => {}; // never actually wait in tests

describe("[fixture] retry — what is worth retrying", () => {
  it("429 and 5xx are retryable; answers are not", () => {
    expect(isRetryable(429)).toBe(true);
    expect(isRetryable(500)).toBe(true);
    expect(isRetryable(503)).toBe(true);
    // These are ANSWERS, not failures. Retrying a 404 asks the same question twice.
    expect(isRetryable(404)).toBe(false);
    expect(isRetryable(410)).toBe(false);
    expect(isRetryable(400)).toBe(false);
    expect(isRetryable(200)).toBe(false);
  });

  it("retries a 429 then succeeds", async () => {
    let n = 0;
    const fetchImpl = vi.fn(async () => (++n === 1 ? res(429) : res(200)));
    const out = await brregGet(buildUrl("/enhetsregisteret/api/enheter/923609016"), {
      fetchImpl,
      sleepImpl: noSleep,
    });
    expect(out.status).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after maxAttempts and says narrow the fan-out, not retry harder", async () => {
    const fetchImpl = vi.fn(async () => res(429));
    const out = await brregGet(buildUrl("/enhetsregisteret/api/enheter/923609016"), {
      fetchImpl,
      sleepImpl: noSleep,
      maxAttempts: 3,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(out.status).toBe("error");
    if (out.status === "error") {
      expect(out.message).toMatch(/Reduce the batch size or concurrency/);
    }
  });

  it("does NOT retry a 410 — an erasure is an answer, and retrying it wastes an erasure signal", async () => {
    const fetchImpl = vi.fn(async () => res(410));
    const out = await brregGet(buildUrl("/enhetsregisteret/api/enheter/1"), { fetchImpl, sleepImpl: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    if (out.status === "error") expect(out.reason).toBe("gone");
  });

  it("does not retry a 404", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    await brregGet(buildUrl("/enhetsregisteret/api/enheter/1"), { fetchImpl, sleepImpl: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("[fixture] retry — delay policy", () => {
  it("honours Retry-After in seconds", () => {
    expect(retryDelayMs(res(429, { "retry-after": "2" }), 0)).toBe(2000);
  });

  it("honours Retry-After as an HTTP-date", () => {
    const now = Date.parse("2026-07-14T12:00:00Z");
    const when = new Date(now + 3000).toUTCString();
    const d = retryDelayMs(res(429, { "retry-after": when }), 0, now);
    expect(d).toBeGreaterThanOrEqual(2000);
    expect(d).toBeLessThanOrEqual(4000);
  });

  it("caps Retry-After so a hostile header cannot hang the agent", () => {
    expect(retryDelayMs(res(429, { "retry-after": "99999" }), 0)).toBeLessThanOrEqual(8000);
  });

  it("backs off exponentially with jitter when there is no header", () => {
    const a = retryDelayMs(res(429), 0);
    const b = retryDelayMs(res(429), 1);
    const c = retryDelayMs(res(429), 2);
    expect(a).toBeGreaterThanOrEqual(500);
    expect(b).toBeGreaterThanOrEqual(1000);
    expect(c).toBeGreaterThanOrEqual(2000);
    expect(c).toBeLessThanOrEqual(8250); // capped + jitter
  });

  it("jitter differs across calls (no synchronised thundering herd from a bounded fan-out)", () => {
    const samples = new Set(Array.from({ length: 20 }, () => retryDelayMs(res(429), 1)));
    expect(samples.size).toBeGreaterThan(1);
  });
});
