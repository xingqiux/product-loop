// ploop 的进程入口：node packages/cli/src/main.ts <命令> …，Node 运行时去掉类型。
// 退出码写进 process.exitCode，不调用 process.exit()，标准输出写完才退出。
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { run } from "./program.ts";

/** 在终端里问一句话。问题写到标准错误，标准输出留给命令的结果。 */
async function ask(question: string): Promise<string | undefined> {
  const lines = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await lines.question(`${question} `);
  } catch {
    // 输入被关掉，当作没有回答。
    return undefined;
  } finally {
    lines.close();
  }
}

/** 标准输入输出都是终端才能问；AI 经工具运行时不是终端，不问，靠选项定下来。 */
const interactive = process.stdin.isTTY && process.stdout.isTTY;

process.exitCode = await run(process.argv.slice(2), {
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
  columns: process.stdout.isTTY ? process.stdout.columns : undefined,
  cwd: process.cwd(),
  env: process.env,
  userHome: homedir(),
  ...(interactive ? { ask } : {}),
});
