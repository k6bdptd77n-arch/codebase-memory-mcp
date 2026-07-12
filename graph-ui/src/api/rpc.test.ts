import { afterEach, describe, expect, it, vi } from "vitest";

import { callTool } from "./rpc";

describe("callTool", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON-RPC tools/call request and unwraps its JSON text", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { content: [{ text: '{"projects":[]}' }] } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(callTool("list_projects")).resolves.toEqual({ projects: [] });

    expect(fetchMock).toHaveBeenCalledWith("/rpc", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: expect.stringContaining('"name":"list_projects"'),
    }));
  });

  it("returns an unwrapped result when the server does not provide text content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ result: { accepted: true } }),
    }));

    await expect(callTool("index_status")).resolves.toEqual({ accepted: true });
  });

  it("surfaces transport and JSON-RPC errors as RpcError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: "Unavailable",
    }));
    await expect(callTool("search_graph")).rejects.toMatchObject({
      code: -1,
      message: "HTTP 503: Unavailable",
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ error: { code: -32602, message: "invalid params" } }),
    }));
    await expect(callTool("search_graph")).rejects.toMatchObject({
      code: -32602,
      message: "invalid params",
    });
  });
});
