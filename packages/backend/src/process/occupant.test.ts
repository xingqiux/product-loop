import { mkdirSync, symlinkSync } from "node:fs";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createTcpServer, type Server as TcpServer } from "node:net";
import { join } from "node:path";
import { err, ok } from "@product-loop/model";
import { describe, expect, it, onTestFinished } from "vitest";
import type { Exec } from "../core/time-machine.ts";
import { tempDir } from "../store/testing.ts";
import { findOccupant, probeBackend, sameDir } from "./occupant.ts";

// 查端口上是谁，见「01 架构」第六节和第八节。
// 占着端口的程序在这个进程里起，lsof 用假的执行器，真的 lsof 在 main.use.test.ts 里跑。

/** 在 127.0.0.1 的空闲端口上起一个服务，测试结束时关掉，返回端口。 */
async function listening(server: Server | TcpServer): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve) => {
        if ("closeAllConnections" in server) server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("没有拿到端口");
  return address.port;
}

/** 像后端一样应答 health 的服务。 */
function backendLike(home: string) {
  return createHttpServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    const data = { status: "正常", build: "dev", apiVersion: 1, pid: 51234, home, extra: 1 };
    res.end(JSON.stringify({ ok: true, data, warnings: [], next: [] }));
  });
}

/** 收下请求、从不应答的服务。读到对方关掉连接时，这一头也关掉。 */
function silent(): TcpServer {
  return createTcpServer((socket) => socket.resume());
}

/** 一个空闲端口：先占上再放开。 */
async function freePort(): Promise<number> {
  const server = createTcpServer();
  const port = await new Promise<number>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : 0);
    }),
  );
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

const lsofSays =
  (stdout: string): Exec =>
  async () =>
    ok({ status: 0, stdout, stderr: "" });

describe("问端口上的是不是后端", () => {
  it("应答 health 的是后端：返回它的进程号、目录和构建号，多出来的字段不管", async () => {
    const port = await listening(backendLike("/tmp/ploop-home"));
    expect(await probeBackend(port, 1000)).toEqual({
      port,
      pid: 51234,
      home: "/tmp/ploop-home",
      build: "dev",
    });
  });

  it("应答的不是后端：返回 undefined", async () => {
    const port = await listening(
      createHttpServer((_req, res) => {
        res.statusCode = 404;
        res.end("<html>not found</html>");
      }),
    );
    expect(await probeBackend(port, 1000)).toBeUndefined();
  });

  it("连上了却一直不应答：到时返回 undefined", async () => {
    const port = await listening(silent());
    const started = Date.now();
    expect(await probeBackend(port, 200)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it("端口上没有程序：返回 undefined", async () => {
    expect(await probeBackend(await freePort(), 1000)).toBeUndefined();
  });
});

describe("查占着端口的是谁", () => {
  it("是后端时写明它的目录和进程号，不用 lsof", async () => {
    const port = await listening(backendLike("/tmp/other-home"));
    const exec: Exec = async () => {
      throw new Error("不该运行 lsof");
    };
    expect(await findOccupant(port, exec, 1000)).toEqual({
      kind: "backend",
      port,
      pid: 51234,
      home: "/tmp/other-home",
      build: "dev",
    });
  });

  it("不是后端时用 lsof 查监听这个端口的进程：进程号和命令名", async () => {
    const port = await listening(silent());
    const calls: string[][] = [];
    const exec: Exec = async (command, args) => {
      calls.push([command, ...args]);
      return ok({ status: 0, stdout: "p51234\ncpython3\nf5\n", stderr: "" });
    };
    expect(await findOccupant(port, exec, 200)).toEqual({
      kind: "process",
      pid: 51234,
      command: "python3",
    });
    expect(calls).toEqual([["/usr/sbin/lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]]);
  });

  it.each([
    ["lsof 什么也没查到", lsofSays("")],
    ["lsof 的输出认不出来", lsofSays("oops\n")],
    ["找不到 lsof", (async () => err({ kind: "notFound" })) satisfies Exec],
    [
      "执行器自己抛出",
      (async () => {
        throw new Error("spawn failed");
      }) satisfies Exec,
    ],
  ])("%s：查不到是哪个进程", async (_name, exec) => {
    expect(await findOccupant(await freePort(), exec, 200)).toEqual({ kind: "unknown" });
  });
});

describe("两个目录是不是同一个", () => {
  it("符号链接展开以后再比", () => {
    const dir = tempDir("ploop-dir-");
    const real = join(dir, "real");
    mkdirSync(real);
    symlinkSync(real, join(dir, "link"));
    expect(sameDir(join(dir, "link"), real)).toBe(true);
    expect(sameDir(real, dir)).toBe(false);
    expect(sameDir("/no/such/dir", "/no/such/other")).toBe(false);
  });
});
