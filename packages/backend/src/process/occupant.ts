import { realpathSync } from "node:fs";
import { request } from "node:http";
import { backendIdentitySchema } from "@product-loop/model";
import { z } from "zod";
import type { Exec } from "../core/time-machine.ts";

// 查端口上是谁，见「01 架构」第六节：端口被占用时，先确认占用者是不是另一个后端。
// 是这个集中存储的后端就安静退出，不是就报错，并写明占用的进程，见第八节。
// 先请求 GET /api/v1/health。应答的不是后端，再用 lsof 查监听这个端口的进程。

/** 在端口上应答的后端。 */
export type BackendOnPort = {
  readonly port: number;
  readonly pid: number;
  readonly home: string;
  readonly build: string;
};

export type Occupant =
  | ({ readonly kind: "backend" } & BackendOnPort)
  | { readonly kind: "process"; readonly pid: number; readonly command: string }
  | { readonly kind: "unknown" };

/** 只取认后端要用的几个字段，别的字段不管，新旧版本的后端都认得出。 */
const healthBody = z.object({ ok: z.literal(true), data: backendIdentitySchema });

/** health 的响应最多读这么多，占着端口的程序可能返回很大的内容。 */
const maxBodyBytes = 64 * 1024;

const lsof = "/usr/sbin/lsof";

/** 请求这个端口的 GET /api/v1/health。应答的是后端时返回它的进程号、目录和构建号。 */
export function probeBackend(port: number, timeoutMs: number): Promise<BackendOnPort | undefined> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: "127.0.0.1",
        port,
        path: "/api/v1/health",
        headers: { host: `127.0.0.1:${port}` },
        // 不复用连接，查完就关，不拖住进程的退出。
        agent: false,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBodyBytes) req.destroy();
          else chunks.push(chunk);
        });
        res.on("end", () => resolve(parseHealth(Buffer.concat(chunks).toString("utf8"), port)));
        // 中途断开时不会有 end。先到的结果算数，所以这里只管没有结果的情况。
        res.on("close", () => resolve(undefined));
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(undefined));
    req.on("close", () => resolve(undefined));
    req.end();
  });
}

function parseHealth(text: string, port: number): BackendOnPort | undefined {
  try {
    const parsed = healthBody.safeParse(JSON.parse(text));
    return parsed.success ? { port, ...parsed.data.data } : undefined;
  } catch {
    return undefined;
  }
}

/** 查占着端口的是谁。先问是不是后端，不是就用 lsof 查进程，都查不到时是 unknown。 */
export async function findOccupant(port: number, exec: Exec, timeoutMs: number): Promise<Occupant> {
  const backend = await probeBackend(port, timeoutMs);
  if (backend !== undefined) return { kind: "backend", ...backend };
  const listener = await listenerOf(port, exec);
  return listener === undefined ? { kind: "unknown" } : { kind: "process", ...listener };
}

/**
 * lsof 的 -F 输出每项一行：p 开头的是进程号，c 开头的是命令名。取第一个进程。
 * 查不到、lsof 不在、没有权限看别人的进程时，返回 undefined。
 */
async function listenerOf(
  port: number,
  exec: Exec,
): Promise<{ readonly pid: number; readonly command: string } | undefined> {
  let stdout: string;
  try {
    const result = await exec(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
    if (!result.ok) return undefined;
    stdout = result.value.stdout;
  } catch {
    return undefined;
  }
  const lines = stdout.split("\n");
  const pid = Number(lines.find((line) => line.startsWith("p"))?.slice(1));
  const command = lines.find((line) => line.startsWith("c"))?.slice(1);
  if (!Number.isInteger(pid) || pid <= 0 || !command) return undefined;
  return { pid, command };
}

/** 两个目录是不是同一个。符号链接展开以后再比，例如 macOS 上的 /var 和 /private/var。 */
export function sameDir(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
}
