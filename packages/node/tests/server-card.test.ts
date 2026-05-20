import { describe, it, expect } from "vitest";
import { buildServerCard } from "../src/server-card";
import { TOOLS } from "../src/tools";

describe("buildServerCard", () => {
  const card = buildServerCard();

  it("includes serverInfo with name, version, and title", () => {
    expect(card.serverInfo.name).toBe("massed-compute-mcp");
    expect(card.serverInfo.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(card.serverInfo.title).toBeTruthy();
  });

  it("declares Bearer authentication as required", () => {
    expect(card.authentication.required).toBe(true);
    expect(card.authentication.schemes).toContain("bearer");
  });

  it("exposes the full tool catalog with input + output schemas", () => {
    expect(card.tools).toHaveLength(TOOLS.length);
    expect(card.tools[0]).toHaveProperty("name");
    expect(card.tools[0]).toHaveProperty("description");
    expect(card.tools[0]).toHaveProperty("inputSchema");
  });

  it("returns empty arrays for resources and prompts", () => {
    expect(card.resources).toEqual([]);
    expect(card.prompts).toEqual([]);
  });
});
