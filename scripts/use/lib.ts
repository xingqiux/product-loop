import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// 使用代码的底子：每个场景一个干净的临时目录和临时的 PLOOP_HOME，像 AI 一样敲 ploop。
// 见「09 skill 与软件」第四节和「10 工程规范与流程」第六节。端口写 0，Time Machine 的检查关掉，
// 不碰真实的集中存储和正在运行的后端。场景走完停掉它拉起的后端，删掉临时目录。

/** 仓库的根目录。 */
export const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * 运行哪一个 ploop：pnpm use 打好的运行目录有 ploop.mjs 时用它，否则运行源码。
 * 源码的入口由 Node 直接运行 TypeScript。
 */
function ploopEntry(): string {
  const app = process.env.PLOOP_TEST_APP;
  if (app !== undefined && app !== "") return join(app, "ploop.mjs");
  return join(repoRoot, "packages", "cli", "src", "main.ts");
}

export type Run = {
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * 一个能截图的窗口。工作台一侧的场景登记它，运行器在每一步走完以后，
 * 按 1440 和 700 两个宽度各截一张，写进使用记录。
 */
export type Frame = {
  /** 现在的窗口宽度。 */
  readonly width: () => number;
  /** 窗口还开着。 */
  readonly isOpen: () => boolean;
  /** 换到 width 宽，等版面稳定，截整个窗口，再换回来。facts 是这一屏量到的事实。 */
  readonly shoot: (width: number) => Promise<{ png: Buffer; facts: Record<string, unknown> }>;
};

/** 一步里敲过的一条命令：命令行的场景没有屏，使用记录里记下命令、退出码和输出的开头。 */
export type CommandNote = {
  readonly command: string;
  readonly exit: number | null;
  readonly output: string;
};

const noteLength = 300;

function noteOf(command: string, run: Run): CommandNote {
  const output = `${run.stdout}${run.stderr}`.trim();
  return {
    command,
    exit: run.code,
    output: output.length > noteLength ? `${output.slice(0, noteLength)}…` : output,
  };
}

/** 一个场景的临时环境。 */
export type World = {
  /** 项目根目录，是临时家目录下的 proj/app。 */
  readonly root: string;
  /** 临时的家目录。HOME 指向这里，~/.local/bin 和 ~/.claude 都在它下面。 */
  readonly home: string;
  readonly store: string;
  /** 打好的运行目录。没有 PLOOP_TEST_APP 时为空，ploop 运行源码。 */
  readonly app: string | undefined;
  /** 这一步要截图的窗口。openPage 打开的最后一个窗口，或者步骤里用 show 指定的。 */
  readonly frame: { current: Frame | undefined };
  /** 这一步敲过的命令，运行器在每一步开始前清空，走完取走。 */
  readonly commands: CommandNote[];
  readonly env: Record<string, string | undefined>;
  /** 在项目根目录，或者它下面的 cwd 里敲一次 ploop。 */
  readonly ploop: (argv: readonly string[], cwd?: string) => Run;
  /** 在后台敲 ploop，不等它结束。 */
  readonly launch: (argv: readonly string[]) => {
    readonly done: Promise<Run>;
    readonly running: () => boolean;
  };
  /** 在项目根目录运行 git，作者写临时的名字。 */
  readonly git: (...args: string[]) => string;
  /** 写一个文件，路径相对项目根目录，文件夹不在就建。 */
  readonly write: (path: string, content: string | Buffer) => void;
  readonly read: (path: string) => string;
  readonly exists: (path: string) => boolean;
  /** 像工作台那样直接调后端的接口，path 从 /api/v1 以后写起。 */
  readonly api: (method: string, path: string, body?: unknown, type?: string) => Promise<unknown>;
  /** 后端上的一个地址，path 从 / 写起。后端要已经被拉起。 */
  readonly url: (path: string) => string;
  /** 场景走完时要做的事，比如关掉浏览器。按登记的反序先做。 */
  readonly defer: (fn: () => void | Promise<void>) => void;
  /** 场景里几步之间要传的东西。 */
  readonly memo: Map<string, unknown>;
  readonly cleanup: () => Promise<void>;
};

export function world(): World {
  const base = mkdtempSync(join(tmpdir(), "ploop-use-"));
  const home = join(base, "home");
  const store = join(base, "store");
  const root = join(home, "proj", "app");
  mkdirSync(root, { recursive: true });
  const env: Record<string, string | undefined> = {
    ...process.env,
    HOME: home,
    PLOOP_HOME: store,
    PLOOP_PORT: "0",
    PLOOP_TIME_MACHINE: "off",
    GIT_AUTHOR_NAME: "use",
    GIT_AUTHOR_EMAIL: "use@example.com",
    GIT_COMMITTER_NAME: "use",
    GIT_COMMITTER_EMAIL: "use@example.com",
  };
  // 外面设了也不要：入口按上面选，会话标识和使用代码的输出目录不带进去
  for (const key of ["PLOOP_BACKEND_ENTRY", "PLOOP_SESSION", "PLOOP_USE_OUT"]) delete env[key];
  const entry = ploopEntry();
  const commands: CommandNote[] = [];
  const children: ReturnType<typeof spawn>[] = [];
  const deferred: (() => void | Promise<void>)[] = [];
  const at = (path: string) => join(root, path);

  const ploop = (argv: readonly string[], cwd = root): Run => {
    const result = spawnSync(process.execPath, [entry, ...argv], { cwd, env, encoding: "utf8" });
    const run = { code: result.status, stdout: result.stdout, stderr: result.stderr };
    commands.push(noteOf(`ploop ${argv.join(" ")}`, run));
    return run;
  };

  const launch = (argv: readonly string[]) => {
    const child = spawn(process.execPath, [entry, ...argv], { cwd: root, env });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const done = new Promise<Run>((resolve) => {
      child.on("close", (code) => {
        const run = { code, stdout, stderr };
        commands.push(noteOf(`ploop ${argv.join(" ")}`, run));
        resolve(run);
      });
    });
    return { done, running: () => child.exitCode === null && child.signalCode === null };
  };

  const runInfo = (): { port?: number; pid?: number } | undefined => {
    const file = join(store, "run", "backend.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  };

  return {
    root,
    home,
    store,
    app: process.env.PLOOP_TEST_APP === "" ? undefined : process.env.PLOOP_TEST_APP,
    frame: { current: undefined },
    commands,
    env,
    ploop,
    launch,
    git: (...args) => execFileSync("git", args, { cwd: root, env, encoding: "utf8" }),
    write: (path, content) => {
      mkdirSync(dirname(at(path)), { recursive: true });
      writeFileSync(at(path), content);
    },
    read: (path) => readFileSync(at(path), "utf8"),
    exists: (path) => existsSync(at(path)),
    api: async (method, path, body, type = "application/json") => {
      const port = runInfo()?.port;
      const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, {
        method,
        headers: { "X-Ploop-Client": "web/2.0.0", "Content-Type": type },
        ...(body === undefined
          ? {}
          : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
      });
      return response.json();
    },
    url: (path) => `http://127.0.0.1:${runInfo()?.port}${path}`,
    defer: (fn) => {
      deferred.push(fn);
    },
    memo: new Map(),
    cleanup: async () => {
      for (const fn of deferred.reverse()) {
        try {
          await fn();
        } catch {
          // 收尾出错不影响删临时目录
        }
      }
      for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
      if (runInfo() !== undefined) ploop(["backend", "stop"]);
      const pid = runInfo()?.pid;
      if (pid !== undefined) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // 已经退出了
        }
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
}

/** 核对不对时抛出，这一步记为断了，原因就是 message。 */
export function check(ok: boolean, message: string): void {
  if (!ok) throw new Error(message);
}

/** 核对一次命令的退出码和输出里该有的字。 */
export function expectRun(run: Run, code: number, ...texts: string[]): void {
  const output = `${run.stdout}\n${run.stderr}`;
  check(
    run.code === code,
    `退出码是 ${run.code}，应当是 ${code}。输出：${output.trim().slice(0, 300)}`,
  );
  for (const text of texts) {
    check(output.includes(text), `输出里没有「${text}」。输出：${output.trim().slice(0, 300)}`);
  }
}

export const pause = (ms: number) => sleep(ms);

/** 一个场景的一步：做什么、该看到什么，和替人做的代码。 */
type Step = {
  readonly do: string;
  readonly expect: string;
  /**
   * 产品现在做不到主线写的这一步。写清主线写的和实际看到的，不放宽断言，不改主线迁就。
   * 走不通时照常记成断了，也照常截图，但不停下这个场景，后面的步接着走；
   * 走通了就提醒把这行删掉。
   */
  readonly gap?: string;
  readonly run: (w: World) => void | Promise<void>;
};

export type Scene = {
  /** 场景编号，例如 S13。 */
  readonly scene: string;
  /** 走第 1 步以前要摆好的状态。 */
  readonly setup?: (w: World) => void | Promise<void>;
  readonly steps: readonly Step[];
};

/** 一像素的 PNG。 */
export const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

/** 这个软件自己的主线：十样和设计规范十二样都写了，进入检查不被拦截。 */
const ownMainline = readFileSync(join(repoRoot, "design", "主线.md"), "utf8");

/** 开工：登记项目，写好主线。 */
export function started(w: World): void {
  expectRun(w.ploop(["init", "--repo", "自己的"]), 0);
  w.write(".product-loop/主线.md", ownMainline);
}
