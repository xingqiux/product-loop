import { createServer, type Server } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { describe, expect, it, onTestFinished } from "vitest";
import { isAbort, unreachableOf } from "./unreachable.ts";

// fetch 抛出的错误归成哪一种。用 Node 真正的 fetch 连本机的端口，不起子进程。
// 第 11 步的 Node 入口按这里的结果决定：连接被拒绝就拉起后端，超时就报错。

/** 在本机的随机端口上起一个服务，测试结束时关掉。 */
async function listen(server: Server | ReturnType<typeof createTcpServer>): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(() => {
    if ("closeAllConnections" in server) server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("没有拿到端口。");
  return address.port;
}

/** 一个没有程序监听的端口：先占一个，再放掉。 */
async function closedPort(): Promise<number> {
  const server = createTcpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("没有拿到端口。");
  return address.port;
}

/** fetch 抛出的错误。没有抛出时测试失败。 */
async function fetchError(url: string, init?: RequestInit): Promise<unknown> {
  try {
    await fetch(url, init);
  } catch (error) {
    return error;
  }
  throw new Error(`请求 ${url} 应当失败，却成功了。`);
}

describe("Node 的 fetch 抛出的错误", () => {
  it("端口上没有程序监听时是 refused", async () => {
    const port = await closedPort();
    for (const host of ["127.0.0.1", "localhost"]) {
      const error = await fetchError(`http://${host}:${port}/api/v1/health`);
      expect(unreachableOf(error)).toMatchObject({ unreachable: "refused" });
    }
  });

  it("等响应超过时限是 timeout", async () => {
    const port = await listen(createServer(() => {}));
    const signal = AbortSignal.timeout(30);
    const error = await fetchError(`http://127.0.0.1:${port}/`, { signal });
    expect(unreachableOf(error)).toMatchObject({ unreachable: "timeout" });
    expect(isAbort(error)).toBe(false);
  });

  it("连接被重置、回来的不是 HTTP，都是 network", async () => {
    const reset = await listen(createTcpServer((socket) => socket.destroy()));
    const junk = await listen(createTcpServer((socket) => socket.end("hello\r\n\r\n")));
    for (const port of [reset, junk]) {
      const error = await fetchError(`http://127.0.0.1:${port}/`);
      expect(unreachableOf(error)).toMatchObject({ unreachable: "network" });
    }
  });

  it("取消的请求是 AbortError，不归进连不上", async () => {
    const port = await listen(createServer(() => {}));
    const controller = new AbortController();
    const pending = fetchError(`http://127.0.0.1:${port}/`, { signal: controller.signal });
    controller.abort();
    expect(isAbort(await pending)).toBe(true);
  });
});

describe("别的写法", () => {
  it("浏览器的 fetch 不给原因，一律是 network", () => {
    const failure = unreachableOf(new TypeError("Failed to fetch"));
    expect(failure).toEqual({ unreachable: "network", detail: "Failed to fetch" });
  });

  it("写明了超时的错误码也是 timeout", () => {
    const cause = Object.assign(new Error("Headers Timeout Error"), {
      code: "UND_ERR_HEADERS_TIMEOUT",
    });
    const failure = unreachableOf(new TypeError("fetch failed", { cause }));
    expect(failure).toEqual({ unreachable: "timeout", detail: "Headers Timeout Error" });
  });

  it("不是 Error 的也能归类", () => {
    expect(unreachableOf("断了")).toEqual({ unreachable: "network", detail: "断了" });
  });
});
