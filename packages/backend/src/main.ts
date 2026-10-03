// 后端的进程入口：node packages/backend/src/main.ts，Node 运行时去掉类型，见「01 架构」第三节。
// 这里只接上真实的进程：环境变量、停止信号、结束进程、外部命令。启动的步骤见 process/start.ts。
// 日志写在集中存储的 logs/backend.log，标准输出不写东西。错误级别的日志另外写到标准错误，
// 前台运行时能直接看到。
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildNumber } from "@product-loop/model";
import { createExec } from "./process/exec.ts";
import { startBackend } from "./process/start.ts";

const entry = fileURLToPath(import.meta.url);
const here = dirname(entry);

// 打包以后，迁移文件夹和 better-sqlite3 的原生文件放在入口旁边，见「02 技术选型」第十五节。
// 开发时入口在 src/ 下，迁移在上一级的 drizzle/，原生文件从依赖目录里找，工作台用 packages/web 的构建结果。
const bundled = existsSync(join(here, "drizzle"));
const nativeFile = join(here, `${process.platform}-${process.arch}.node`);

/** 外部命令最多等十秒。tmutil 在备份盘没接上时会慢一些。 */
const execTimeoutMs = 10_000;

/**
 * 结束进程。先让标准错误写完再退出，写不完的最多再等两百毫秒。
 * 日志文件是同步写的，不受影响。
 */
function finish(code: number): void {
  process.exitCode = code;
  setTimeout(() => process.exit(code), 200).unref();
}

const started = await startBackend({
  env: process.env,
  // 打包时注入的构建号：版本、提交短号和构建时间，见约定 0001 第 22 条。
  build: buildNumber,
  webDir: bundled ? join(here, "web") : join(here, "..", "..", "web", "dist"),
  migrationsFolder: bundled ? join(here, "drizzle") : join(here, "..", "drizzle"),
  nativeBinding: existsSync(nativeFile) ? nativeFile : undefined,
  entry,
  exec: createExec(execTimeoutMs),
  exit: finish,
  signals: process,
  onErrorLine: (line) => process.stderr.write(line),
});

if (started.kind === "exited") {
  finish(started.code);
} else {
  process.on("uncaughtException", started.backend.crash);
  process.on("unhandledRejection", started.backend.crash);
}
