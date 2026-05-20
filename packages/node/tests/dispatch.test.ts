import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dispatchToolCall } from "../src/dispatch";

describe("dispatchToolCall", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an unknown-tool error when the name does not match any registered tool", async () => {
    const result = await dispatchToolCall(
      "nonexistent_tool",
      {},
      "Bearer abc",
      "http://localhost",
    );
    expect(result.isError).toBe(true);
    expect(result._meta?.rpcCode).toBe(-32602);
    const firstContent = result.content[0] as { type: string; text: string };
    expect(firstContent.text).toContain("nonexistent_tool");
  });

  it("forwards to the upstream for known tools with the supplied auth + base URL", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ gpu_inventory: [{ name: "A100" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }) as unknown as Response,
    );

    const result = await dispatchToolCall(
      "gpu_inventory_list",
      {},
      "Bearer abc",
      "https://upstream.test",
    );

    expect(result.isError).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://upstream.test/api/v1/gpu-inventory");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer abc");
  });
});
