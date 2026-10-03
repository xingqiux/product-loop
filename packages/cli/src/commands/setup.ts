import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { chmod, cp, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import {
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type Result,
  renderCopy,
  resolveHome,
} from "@product-loop/model";
import type { CommandEnv } from "../connect.ts";
import { setupCopy } from "../copy/setup.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { stopRunning } from "./backend.ts";
import { helpOf } from "./shared.ts";

// ploop setup [--version <安装版本>]，见「02 技术选型」第十五节和第一期计划第 64 步。
// 在代码仓库里用 pnpm ploop:setup 运行：先打包，再由打包的 ploop.mjs 把自己所在的运行目录
// 复制到集中存储的 app/<版本>/，current 指向它，在 ~/.local/bin/ploop 写启动脚本，
// 脚本用 Node 的绝对路径执行 app/current/ploop.mjs。最后请旧后端退出，下一条命令拉起新的。
// 复制先写到临时目录再改名，正在运行的旧后端的文件不会被写坏。

const { output, errors: text } = setupCopy;

type BuildInfo = { readonly build: string; readonly version: string };

function readBuildInfo(dir: string): BuildInfo | undefined {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, "build.json"), "utf8")) as Partial<BuildInfo>;
    if (typeof parsed.build === "string" && typeof parsed.version === "string") {
      return { build: parsed.build, version: parsed.version };
    }
  } catch {
    // 没有或读不出来，都不是打包的运行目录。
  }
  return undefined;
}

/** 装过的版本：app/ 下带 ploop.mjs 的文件夹，不含 current 和临时的。 */
function installedVersions(appRoot: string): string[] {
  try {
    return readdirSync(appRoot)
      .filter((name) => !name.startsWith(".") && name !== "current")
      .filter((name) => existsSync(join(appRoot, name, "ploop.mjs")))
      .sort();
  } catch {
    return [];
  }
}

/** 把运行目录复制到 app/<版本>/：先写临时目录，再把旧的改名移开，最后删掉旧的。 */
async function install(source: string, appRoot: string, version: string): Promise<void> {
  const target = join(appRoot, version);
  if (existsSync(target) && realpathSync(target) === realpathSync(source)) return;
  const partial = join(appRoot, `.${version}.partial`);
  await rm(partial, { recursive: true, force: true });
  await cp(source, partial, { recursive: true });
  const old = join(appRoot, `.${version}.old-${process.pid}`);
  if (existsSync(target)) await rename(target, old);
  await rename(partial, target);
  await rm(old, { recursive: true, force: true });
}

/** current 指向 app/<版本>：先建临时的链接，再改名盖过去。 */
async function pointCurrent(appRoot: string, version: string): Promise<void> {
  const temp = join(appRoot, `.current-${process.pid}`);
  await rm(temp, { force: true });
  await symlink(version, temp);
  await rename(temp, join(appRoot, "current"));
}

/** ~/.local/bin/ploop：用 Node 的绝对路径执行 app/current/ploop.mjs。 */
async function writeLauncher(file: string, entry: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const script = `#!/bin/sh\n# 由 ploop setup 写入。\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`;
  await writeFile(file, script);
  await chmod(file, 0o755);
}

async function setup(ctx: CommandEnv, versionOption: string | undefined): Promise<Outcome> {
  const home = resolveHome(ctx.env, ctx);
  const appRoot = join(home, "app");
  await mkdir(appRoot, { recursive: true });
  let info: BuildInfo;
  if (versionOption === undefined) {
    const source = dirname(fileURLToPath(import.meta.url));
    const found = readBuildInfo(source);
    if (found === undefined) {
      const body = {
        message: renderCopy(text.notBundle.message, { dir: source }),
        hint: renderCopy(text.notBundle.hint),
      };
      return err(errorBody("BAD_REQUEST", [body]));
    }
    info = found;
    await install(source, appRoot, info.version);
  } else {
    const found = readBuildInfo(join(appRoot, versionOption));
    if (found === undefined || !existsSync(join(appRoot, versionOption, "ploop.mjs"))) {
      const installed = installedVersions(appRoot);
      const body = {
        message: renderCopy(text.missing.message, {
          version: versionOption,
          installed: installed.join("、") || "没有",
        }),
        hint: renderCopy(text.missing.hint),
      };
      return err(errorBody("NOT_FOUND", [body]));
    }
    info = { ...found, version: versionOption };
  }
  await pointCurrent(appRoot, info.version);
  const binDir = join(ctx.userHome, ".local", "bin");
  const launcher = join(binDir, "ploop");
  await writeLauncher(launcher, join(appRoot, "current", "ploop.mjs"));

  const stopped: Result<number | undefined, ErrorBody> = await stopRunning(ctx);
  if (!stopped.ok) return stopped;
  const warnings: Issue[] = [];
  const path = (ctx.env.PATH ?? "").split(":");
  if (!path.includes(binDir)) {
    warnings.push({
      message: renderCopy(text.pathMissing.message, { dir: binDir }),
      hint: renderCopy(text.pathMissing.hint),
    });
  }
  const head = versionOption === undefined ? output.installed : output.switched;
  return ok({
    kind: "setup.done",
    data: { ...info, dir: join(appRoot, info.version), launcher, node: process.execPath },
    lines: [
      renderCopy(head, info),
      renderCopy(output.place, { dir: `${join(appRoot, info.version)}/` }),
      renderCopy(output.launcher, { file: launcher, node: process.execPath }),
      stopped.value === undefined
        ? renderCopy(output.notRunning)
        : renderCopy(output.stopped, { pid: stopped.value }),
    ],
    next: ["ploop status"],
    warnings,
  });
}

/** 挂上 ploop setup。 */
export function setupCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = setupCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const command = program
    .command("setup")
    .description(t(help.description))
    .option("--version <安装版本>", t(help.version))
    .action(async (options) => {
      context.settle(await setup(context, options.version));
    });
  withHelp(
    command,
    helpOf({
      details: Object.values(help.details),
      blocks: Object.values(help.blocks),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.examples),
      after: help.after,
    }),
  );
}
