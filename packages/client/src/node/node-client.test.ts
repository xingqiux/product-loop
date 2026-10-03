import { idempotencyHeader } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { okResponse } from "../testing.ts";
import { createNodeClient } from "./node-client.ts";
import { type FakeWorld, fakeWorld, refusedError } from "./testing.ts";

// 命令行用的客户端：第一次调用前确认后端在运行，连不上时拉起一次再重发，见「01 架构」第六节。

const register = { root: "/work/app", repoKind: "自己的" } as const;

/** 假后端对登记项目的回应。 */
function answerProjects(w: FakeWorld) {
  w.route((backend, request) =>
    request.method === "POST" && new URL(request.url).pathname === "/api/v1/projects"
      ? okResponse({ servedBy: backend.pid }, { status: 201 })
      : okResponse({}),
  );
}

const projectRequests = (w: FakeWorld) =>
  w.requests.filter(({ url }) => new URL(url).pathname === "/api/v1/projects");

describe("命令行用的客户端", () => {
  it("第一次调用前确认一次，以后不再确认", async () => {
    const w = fakeWorld();
    const backend = w.running();
    const client = createNodeClient(w.options());
    for (let i = 0; i < 2; i++) {
      const result = await client.call((api) => api.api.v1.health.$get());
      expect(result.ok).toBe(true);
    }
    expect(w.requests.map(({ url }) => new URL(url).port)).toEqual(
      Array(3).fill(String(backend.port)),
    );
    expect(w.spawns).toEqual([]);
  });

  it("后端没开时先拉起，再调用", async () => {
    const w = fakeWorld();
    const result = await createNodeClient(w.options()).call((api) => api.api.v1.health.$get());
    expect(result.ok).toBe(true);
    expect(w.spawns).toHaveLength(1);
  });

  it("每次按 backend.json 取地址，别的会话换了后端也能跟上", async () => {
    const w = fakeWorld();
    w.running();
    const client = createNodeClient(w.options());
    await client.call((api) => api.api.v1.health.$get());
    const other = w.running();
    await client.call((api) => api.api.v1.health.$get());
    expect(w.requests.at(-1)?.url).toBe(`http://127.0.0.1:${other.port}/api/v1/health`);
  });

  it("后端中途没了：拉起一次，用同一个请求编号重发", async () => {
    const w = fakeWorld();
    const old = w.running();
    answerProjects(w);
    const client = createNodeClient(w.options());
    await client.call((api) => api.api.v1.health.$get());
    w.kill(old.pid);
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(w.spawns).toHaveLength(1);
    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.value.data).not.toEqual({ servedBy: old.pid });
    const sent = projectRequests(w);
    expect(sent).toHaveLength(2);
    const keys = sent.map((request) => request.headers.get(idempotencyHeader));
    expect(keys[0]).toMatch(/.+/u);
    expect(keys[1]).toBe(keys[0]);
  });

  it("拉起失败时，调用的结果是起不来的原因", async () => {
    const w = fakeWorld();
    const old = w.running();
    const client = createNodeClient(w.options());
    await client.call((api) => api.api.v1.health.$get());
    w.kill(old.pid);
    w.next({ kind: "exit", code: 3 });
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "startFailed", reason: "exited", exitCode: 3 },
    });
  });

  it("第一次确认就失败：不发请求，结果是起不来的原因", async () => {
    const w = fakeWorld();
    w.setNodeVersion("22.11.0");
    const result = await createNodeClient(w.options()).call((api) => api.api.v1.health.$get());
    expect(result).toMatchObject({ ok: false, error: { kind: "nodeTooOld" } });
    expect(w.requests).toEqual([]);
  });

  it("等响应超时不拉起", async () => {
    const w = fakeWorld();
    w.running();
    answerProjects(w);
    const client = createNodeClient(w.options());
    await client.call((api) => api.api.v1.health.$get());
    w.failNext("/api/v1/projects", new DOMException("超时", "TimeoutError"));
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(result).toMatchObject({ ok: false, error: { unreachable: "timeout" } });
    expect(projectRequests(w)).toHaveLength(1);
    expect(w.spawns).toEqual([]);
  });

  it("重发以后仍连不上，不再拉起", async () => {
    const w = fakeWorld();
    const backend = w.running();
    answerProjects(w);
    const client = createNodeClient(w.options());
    await client.call((api) => api.api.v1.health.$get());
    w.failNext("/api/v1/projects", refusedError(backend.port));
    w.failNext("/api/v1/projects", refusedError(backend.port));
    const result = await client.call((api) => api.api.v1.projects.$post({ json: register }));
    expect(result).toMatchObject({ ok: false, error: { unreachable: "refused" } });
    expect(projectRequests(w)).toHaveLength(2);
    expect(w.spawns).toEqual([]);
  });

  it("几个调用同时要确认时只确认一次", async () => {
    const w = fakeWorld();
    const client = createNodeClient(w.options());
    expect(client.ensure()).toBe(client.ensure());
    const results = await Promise.all(
      [1, 2, 3].map(() => client.call((api) => api.api.v1.health.$get())),
    );
    expect(results.every((result) => result.ok)).toBe(true);
    expect(w.spawns).toHaveLength(1);
  });
});
