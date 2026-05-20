import { describe, it, expect } from "vitest";
import { TOOLS } from "../src/tools";

describe("tool registry", () => {
  it("has unique tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("every tool has a title, description, and inputSchema", () => {
    for (const t of TOOLS) {
      expect(t.title, `${t.name}.title`).toBeTruthy();
      expect(t.description, `${t.name}.description`).toBeTruthy();
      expect(t.inputSchema, `${t.name}.inputSchema`).toBeTruthy();
    }
  });

  it("every tool has a valid upstream method + path", () => {
    const validMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
    for (const t of TOOLS) {
      expect(validMethods.has(t.upstream.method), `${t.name}.upstream.method`).toBe(true);
      expect(t.upstream.path, `${t.name}.upstream.path`).toMatch(/^\/api\/v\d+\//);
    }
  });

  it("path placeholders and pathParams are in sync (bidirectional)", () => {
    for (const t of TOOLS) {
      const params = t.upstream.pathParams ?? {};
      for (const placeholder of Object.keys(params)) {
        expect(
          t.upstream.path.includes(`{${placeholder}}`),
          `${t.name}: path "${t.upstream.path}" missing {${placeholder}}`,
        ).toBe(true);
      }
      const pathPlaceholders = [...t.upstream.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      for (const ph of pathPlaceholders) {
        expect(
          ph !== undefined && ph in params,
          `${t.name}: path has {${ph}} but pathParams has no entry for it`,
        ).toBe(true);
      }
    }
  });

  describe("obfuscation lint — no internal references in user-facing text", () => {
    const forbidden = [
      "user_api_key",
      "user_api_key_readonly",
      "vm-marketplace",
      "vm_marketplace",
      "massed-compute-api",
      "argon2",
      "argon",
      "mysql",
      "MariaDB",
      "stripe_customer",
      "proxmox",
      "user_uuid",
      "api_key_hash",
    ];

    for (const tool of TOOLS) {
      it(`${tool.name} description contains no forbidden internal strings`, () => {
        const { upstream: _upstream, ...publicSurface } = tool;
        const haystack = JSON.stringify(publicSurface).toLowerCase();
        for (const needle of forbidden) {
          expect(
            haystack.includes(needle.toLowerCase()),
            `${tool.name} description contains forbidden string "${needle}". Rewrite to avoid leaking internals.`,
          ).toBe(false);
        }
      });
    }
  });
});
