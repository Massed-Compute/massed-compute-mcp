import { describe, it, expect } from "vitest";
import { redactSensitive } from "../src/redact";

describe("redactSensitive", () => {
  it("replaces top-level password with the sentinel", () => {
    const out = redactSensitive({ username: "Ubuntu", password: "leak-xyz" }) as Record<
      string,
      unknown
    >;
    expect(out.username).toBe("Ubuntu");
    expect(out.password).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toContain("leak-xyz");
  });

  it("scrubs password inside arrays of instances", () => {
    const out = redactSensitive({
      runningInstances: [
        { uuid: "a", password: "leak-a" },
        { uuid: "b", password: "leak-b" },
      ],
    });
    expect(JSON.stringify(out)).not.toMatch(/leak-[ab]/);
  });

  it("scrubs deeply nested password fields", () => {
    const out = redactSensitive({ a: { b: { c: { password: "deep-leak" } } } });
    expect(JSON.stringify(out)).not.toContain("deep-leak");
  });

  it("does not mutate the input", () => {
    const input = { password: "original" };
    redactSensitive(input);
    expect(input.password).toBe("original");
  });

  it("leaves null/empty password values alone (nothing sensitive to hide)", () => {
    const out = redactSensitive({ password: null }) as Record<string, unknown>;
    expect(out.password).toBeNull();
  });

  it("passes through primitives and non-sensitive fields untouched", () => {
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive("hello")).toBe("hello");
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive({ ip: "1.2.3.4" })).toEqual({ ip: "1.2.3.4" });
  });
});
