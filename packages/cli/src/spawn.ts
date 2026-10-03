import { spawn } from "node:child_process";

// 命令行替 AI 运行的命令：落地的检查命令和使用代码，见「04 命令行」第十一节。
// 不经过 shell，在给定的目录里运行，收下标准输出和标准错误。

/** 常见信号的编号，被信号终止时按 shell 的惯例记 128 加编号。 */
const signalNumbers: Readonly<Record<string, number>> = {
  SIGHUP: 1,
  SIGINT: 2,
  SIGQUIT: 3,
  SIGKILL: 9,
  SIGTERM: 15,
};

export type Spawned = {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** 没有跑起来时的原因，例如 ENOENT。跑起来了为 undefined。 */
  readonly notStarted?: string;
};

/**
 * 运行一条命令，等它结束。程序找不到时记退出码 127，不能执行时记 126。
 * env 写了就代替当前的环境变量。
 */
export function runCommand(
  command: readonly [string, ...string[]],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<Spawned> {
  const [program, ...args] = command;
  return new Promise((done) => {
    let out = "";
    let errText = "";
    const child = spawn(program, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stderr.on("data", (chunk) => {
      errText += chunk;
    });
    child.on("error", (error) => {
      const code = "code" in error ? String(error.code) : String(error);
      done({
        exitCode: code === "EACCES" ? 126 : 127,
        stdout: out,
        stderr: String(error),
        notStarted: code,
      });
    });
    child.on("close", (code, signal) => {
      const number = signal === null ? 0 : (signalNumbers[signal] ?? 0);
      done({ exitCode: code ?? 128 + number, stdout: out, stderr: errText });
    });
  });
}
