// 三个验证脚本共用的小工具：运行命令、拉起服务等它报端口、记录每一项的结果。
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

/** spikes/backend 的根目录 */
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 某个目录下 node_modules/.bin 里的命令 */
export const bin = (name: string, dir = ROOT) => join(dir, 'node_modules', '.bin', name);

export type RunResult = { code: number; stdout: string; stderr: string; output: string };

export function run(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): RunResult {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    encoding: 'utf8',
    timeout: opts.timeoutMs,
  });
  const stdout = r.stdout ?? '';
  const stderr = (r.stderr ?? '') + (r.error ? String(r.error) : '');
  return { code: r.status ?? -1, stdout, stderr, output: stdout + stderr };
}

export type Server = { port: number; proc: ChildProcess; stop: () => Promise<number | null>; logs: () => string };

/** 拉起一个进程，等它在标准输出打印 {"event":"listening","port":N}。 */
export function startServer(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<Server> {
  const proc = spawn(cmd, args, {
    cwd: opts.cwd ?? ROOT,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  proc.stderr?.on('data', (d) => (logs += d));
  const exited = new Promise<number | null>((resolve) => proc.on('exit', (code) => resolve(code)));
  const stop = async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM');
    return exited;
  };
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`等待服务启动超时。输出：\n${logs}`));
    }, opts.timeoutMs ?? 15_000);
    exited.then((code) => {
      clearTimeout(timer);
      reject(new Error(`服务没有启动就退出了，退出码 ${code}。输出：\n${logs}`));
    });
    createInterface({ input: proc.stdout! }).on('line', (line) => {
      logs += `${line}\n`;
      try {
        const msg = JSON.parse(line) as { event?: string; port?: number };
        if (msg.event === 'listening' && typeof msg.port === 'number') {
          clearTimeout(timer);
          resolve({ port: msg.port, proc, stop, logs: () => logs });
        }
      } catch {
        // 不是 JSON 的行只记进日志
      }
    });
  });
}

/** 记录每一项检查，最后打印汇总并按结果设退出码。 */
export class Report {
  private checks: { name: string; pass: boolean }[] = [];
  private title: string;

  constructor(title: string) {
    this.title = title;
    console.log(`\n${'='.repeat(8)} ${title} ${'='.repeat(8)}`);
  }

  section(title: string) {
    console.log(`\n--- ${title}`);
  }

  evidence(text: string) {
    for (const line of text.trimEnd().split('\n')) console.log(`    ${line}`);
  }

  check(name: string, pass: boolean, detail?: string) {
    this.checks.push({ name, pass });
    console.log(`  [${pass ? '通过' : '不通过'}] ${name}`);
    if (!pass && detail) this.evidence(detail);
  }

  finish(): never {
    const passed = this.checks.filter((c) => c.pass).length;
    const allPass = passed === this.checks.length && this.checks.length > 0;
    console.log(`\n${this.title}：${allPass ? '通过' : '不通过'}（${passed}/${this.checks.length} 项检查通过）`);
    process.exit(allPass ? 0 : 1);
  }
}
