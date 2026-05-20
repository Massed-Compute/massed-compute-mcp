import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildRequest, mapResponseToToolResult, forwardToUpstream } from "../src/forward";
import type { ToolDef } from "../src/types";

const tool = (overrides: Partial<ToolDef>): ToolDef => ({
  name: "t",
  title: "T",
  description: "d",
  inputSchema: { type: "object" },
  upstream: { method: "GET", path: "/x" },
  ...overrides,
});

describe("buildRequest", () => {
  it("GET with no args produces a clean URL and no body", () => {
    const { url, body } = buildRequest(
      tool({ upstream: { method: "GET", path: "/api/v1/gpu-inventory" } }),
      {},
      "https://upstream.example.com",
    );
    expect(url).toBe("https://upstream.example.com/api/v1/gpu-inventory");
    expect(body).toBeUndefined();
  });

  it("GET with args appends them as a query string", () => {
    const { url, body } = buildRequest(
      tool({ upstream: { method: "GET", path: "/api/v1/instance" } }),
      { active: true, region: "us-east-1" },
      "https://upstream.example.com",
    );
    expect(body).toBeUndefined();
    expect(url).toMatch(/^https:\/\/upstream\.example\.com\/api\/v1\/instance\?/);
    expect(url).toContain("active=true");
    expect(url).toContain("region=us-east-1");
  });

  it("interpolates path params and removes them from the body", () => {
    const { url, body } = buildRequest(
      tool({
        upstream: {
          method: "GET",
          path: "/api/v1/instance/{id}",
          pathParams: { id: "uuid" },
        },
      }),
      { uuid: "abc-123" },
      "https://upstream.example.com",
    );
    expect(url).toBe("https://upstream.example.com/api/v1/instance/abc-123");
    expect(body).toBeUndefined();
  });

  it("interpolates path params, then sends remaining args in the body for POST", () => {
    const { url, body } = buildRequest(
      tool({
        upstream: { method: "POST", path: "/api/v1/instance/launch" },
      }),
      { imageId: 7, productName: "p1" },
      "https://upstream.example.com",
    );
    expect(url).toBe("https://upstream.example.com/api/v1/instance/launch");
    expect(body).toBe(JSON.stringify({ imageId: 7, productName: "p1" }));
  });

  it("DELETE with a path param interpolates and sends no body", () => {
    const { url, body } = buildRequest(
      tool({
        upstream: {
          method: "DELETE",
          path: "/api/v1/ssh-keys/{id}",
          pathParams: { id: "sshKeyId" },
        },
      }),
      { sshKeyId: 42 },
      "https://upstream.example.com",
    );
    expect(url).toBe("https://upstream.example.com/api/v1/ssh-keys/42");
    expect(body).toBeUndefined();
  });

  it("throws if a declared path param is missing from args", () => {
    expect(() =>
      buildRequest(
        tool({
          upstream: {
            method: "GET",
            path: "/api/v1/instance/{id}",
            pathParams: { id: "uuid" },
          },
        }),
        {},
        "https://upstream.example.com",
      ),
    ).toThrow(/missing.*uuid/i);
  });

  it("encodes path param values to prevent URL injection", () => {
    const { url } = buildRequest(
      tool({
        upstream: {
          method: "GET",
          path: "/api/v1/instance/{id}",
          pathParams: { id: "uuid" },
        },
      }),
      { uuid: "abc/def?evil=1" },
      "https://upstream.example.com",
    );
    expect(url).toContain("abc%2Fdef%3Fevil%3D1");
  });

  it("does not emit a trailing '?' when all GET args are null/undefined", () => {
    const { url, body } = buildRequest(
      tool({ upstream: { method: "GET", path: "/api/v1/instance" } }),
      { active: null, region: undefined },
      "https://upstream.example.com",
    );
    expect(url).toBe("https://upstream.example.com/api/v1/instance");
    expect(body).toBeUndefined();
  });
});

describe("mapResponseToToolResult", () => {
  const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("returns content + structuredContent on 2xx with JSON body", async () => {
    const res = jsonResponse(200, { items: [1, 2, 3] });
    const result = await mapResponseToToolResult(res);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ items: [1, 2, 3] });
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toMatchObject({ type: "text" });
    expect(JSON.parse((result.content[0] as { type: "text"; text: string }).text)).toEqual({
      items: [1, 2, 3],
    });
  });

  it("returns isError + JSON-RPC error code on 401", async () => {
    const res = jsonResponse(401, { error: "no auth" });
    const result = await mapResponseToToolResult(res);
    expect(result.isError).toBe(true);
    expect(result._meta?.rpcCode).toBe(-32001);
  });

  it("maps 403 → -32003", async () => {
    const result = await mapResponseToToolResult(jsonResponse(403, {}));
    expect(result._meta?.rpcCode).toBe(-32003);
  });

  it("maps 404 → -32002", async () => {
    const result = await mapResponseToToolResult(jsonResponse(404, {}));
    expect(result._meta?.rpcCode).toBe(-32002);
  });

  it("maps 422 → -32602", async () => {
    const result = await mapResponseToToolResult(jsonResponse(422, {}));
    expect(result._meta?.rpcCode).toBe(-32602);
  });

  it("maps 500 → -32603 (InternalError)", async () => {
    const result = await mapResponseToToolResult(jsonResponse(500, {}));
    expect(result._meta?.rpcCode).toBe(-32603);
  });

  it("handles non-JSON success bodies as text", async () => {
    const res = new Response("plain text body", {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
    const result = await mapResponseToToolResult(res);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]).toMatchObject({ type: "text", text: "plain text body" });
  });

  it("handles a malformed JSON body without crashing or returning undefined text", async () => {
    const res = new Response("not json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
    const result = await mapResponseToToolResult(res);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toBeUndefined();
    // text should be a string, never undefined
    expect(typeof (result.content[0] as { type: "text"; text: string }).text).toBe("string");
  });

  it("maps other 4xx (e.g. 400, 429) → -32600 (InvalidRequest)", async () => {
    expect((await mapResponseToToolResult(jsonResponse(400, {})))._meta?.rpcCode).toBe(-32600);
    expect((await mapResponseToToolResult(jsonResponse(429, {})))._meta?.rpcCode).toBe(-32600);
  });
});

describe("forwardToUpstream", () => {
  const realFetch = globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const okJson = (body: unknown): Response =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  it("forwards GET to the right URL with the user's Authorization header verbatim", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ ok: true }));
    await forwardToUpstream(
      tool({ upstream: { method: "GET", path: "/api/v1/gpu-inventory" } }),
      {},
      "Bearer abc.def",
      "https://upstream.example.com",
    );
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0]!;
    expect(url).toBe("https://upstream.example.com/api/v1/gpu-inventory");
    expect((init as RequestInit).method).toBe("GET");
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer abc.def",
      "Content-Type": "application/json",
    });
    expect((init as RequestInit).body).toBeUndefined();
  });

  it("forwards POST with JSON body and the Authorization header", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ launched: true }));
    await forwardToUpstream(
      tool({ upstream: { method: "POST", path: "/api/v1/instance/launch" } }),
      { imageId: 5, productName: "p" },
      "Bearer abc.def",
      "https://upstream.example.com",
    );
    const [, init] = mockFetch.mock.calls[0]!;
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ imageId: 5, productName: "p" }),
    );
  });

  it("returns the mapped tool result on success", async () => {
    mockFetch.mockResolvedValueOnce(okJson({ count: 2 }));
    const result = await forwardToUpstream(
      tool({ upstream: { method: "GET", path: "/x" } }),
      {},
      "Bearer t",
      "https://upstream.example.com",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ count: 2 });
  });

  it("returns an error result when the upstream responds 401", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response("{}", {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const result = await forwardToUpstream(
      tool({ upstream: { method: "GET", path: "/x" } }),
      {},
      "Bearer wrong",
      "https://upstream.example.com",
    );
    expect(result.isError).toBe(true);
    expect(result._meta?.rpcCode).toBe(-32001);
  });

  it("returns an internal-error result when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const result = await forwardToUpstream(
      tool({ upstream: { method: "GET", path: "/x" } }),
      {},
      "Bearer t",
      "https://upstream.example.com",
    );
    expect(result.isError).toBe(true);
    expect(result._meta?.rpcCode).toBe(-32603);
    expect((result.content[0] as { text: string }).text).toBe("Upstream fetch failed.");
  });
});
