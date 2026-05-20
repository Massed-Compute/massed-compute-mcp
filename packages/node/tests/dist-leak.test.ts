import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist", import.meta.url));

const walk = (dir: string): string[] => {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
};

describe("dist leak scan", () => {
  it("dist/ exists (run `npm run build` first if this fails)", () => {
    expect(existsSync(DIST)).toBe(true);
  });

  const FORBIDDEN = [
    "vm-marketplace",
    "vm_marketplace",
    "massed-compute-api",
    "argon2",
    "argon",
    "mysql",
    "mariadb",
    "stripe_customer",
    "proxmox",
    "user_api_key",
    "user_uuid",
    "api_key_hash",
  ];

  it("no forbidden internal references appear in any compiled file", () => {
    // Also scan .json artifacts (tools-spec.json) — they're shipped to
    // users and a leaked internal term there is just as visible as one
    // in compiled JS.
    const files = walk(DIST).filter(
      (f) => f.endsWith(".js") || f.endsWith(".d.ts") || f.endsWith(".json"),
    );
    expect(files.length).toBeGreaterThan(0);
    const leaks: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf-8").toLowerCase();
      for (const needle of FORBIDDEN) {
        if (content.includes(needle.toLowerCase())) {
          leaks.push(`${file}: contains "${needle}"`);
        }
      }
    }
    expect(leaks, leaks.length > 0 ? leaks.join("\n") : "").toEqual([]);
  });

  it("no .js.map files (source maps must be disabled to avoid leaking source)", () => {
    const maps = walk(DIST).filter((f) => f.endsWith(".js.map"));
    expect(maps).toEqual([]);
  });
});
