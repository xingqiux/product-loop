import { execFile } from "node:child_process";
import { err, ok, renderCopy } from "@product-loop/model";
import { processCopy } from "../copy/process.ts";
import type { Exec } from "../core/time-machine.ts";

// 真的执行器：Time Machine 的检查运行 tmutil 和 plutil，查端口的占用者运行 lsof。
// 约定见 core/time-machine.ts 的 Exec：命令运行完就返回 ok，退出码不是 0 也一样。
// 找不到命令返回 notFound，超时或被信号结束返回 failed。
// 测试一律用假的执行器，不运行真的 tmutil。这个文件本身在 exec.use.test.ts 里用 node 测。

/** 输出最多收这么多，超过时算没运行完。 */
const maxBuffer = 4 * 1024 * 1024;

export function createExec(timeoutMs: number): Exec {
  return (command, args) =>
    new Promise((resolve) => {
      execFile(
        command,
        [...args],
        { encoding: "utf8", timeout: timeoutMs, maxBuffer },
        (error, stdout, stderr) => {
          if (error === null) {
            resolve(ok({ status: 0, stdout, stderr }));
          } else if (error.code === "ENOENT") {
            resolve(err({ kind: "notFound" }));
          } else if (typeof error.code === "number") {
            resolve(ok({ status: error.code, stdout, stderr }));
          } else {
            const seconds = timeoutMs / 1000;
            const message = error.killed
              ? renderCopy(processCopy.execTimeout, { seconds })
              : error.message;
            resolve(err({ kind: "failed", message }));
          }
        },
      );
    });
}
