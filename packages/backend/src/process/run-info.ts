import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseRunInfo, type RunInfo, runInfoFileName, runInfoSchema } from "@product-loop/model";

// run/backend.json：后端开始服务时写下的运行信息，见「01 架构」第六节。
// 命令行先读它，取出端口、进程号和构建号，再请求 GET /health。文件不在就用默认端口。
// 格式在共用定义里，命令行按同一份定义读，见 model 的 process.ts。
// 先写临时文件再改名，读的一方不会读到写了一半的文件。
// 后端退出时删掉它。只删自己写的，进程号不是自己的就不动。

/** 写到一半的临时文件，名字里带着写它的进程号。 */
const partialName = /^backend\.json\.\d+\.partial$/u;

export function runInfoFile(runDir: string): string {
  return join(runDir, runInfoFileName);
}

/** 写 backend.json：先写到带进程号的临时文件，再改名。 */
export function writeRunInfo(runDir: string, info: RunInfo): void {
  const file = runInfoFile(runDir);
  const partial = `${file}.${info.pid}.partial`;
  writeFileSync(partial, `${JSON.stringify(runInfoSchema.parse(info), null, 2)}\n`);
  renameSync(partial, file);
}

/** 读 backend.json。文件不在、不是 JSON、不合定义，都返回 undefined。 */
export function readRunInfo(runDir: string): RunInfo | undefined {
  let text: string;
  try {
    text = readFileSync(runInfoFile(runDir), "utf8");
  } catch {
    return undefined;
  }
  return parseRunInfo(text);
}

/** 删掉 backend.json，只删 pid 这个进程写的。删了返回 true。 */
export function removeRunInfo(runDir: string, pid: number): boolean {
  if (readRunInfo(runDir)?.pid !== pid) return false;
  rmSync(runInfoFile(runDir), { force: true });
  return true;
}

/**
 * 删掉以前的实例留下的 backend.json 和没写完的临时文件，拿到实例锁以后调用。
 * 这时没有别的实例在运行，文件在就是上一个实例异常退出时留下的。
 */
export function clearStaleRunInfo(runDir: string): void {
  for (const name of readdirSync(runDir)) {
    if (name === runInfoFileName || partialName.test(name)) {
      rmSync(join(runDir, name), { force: true });
    }
  }
}
