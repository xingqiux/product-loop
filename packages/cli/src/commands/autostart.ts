import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import { err, errorBody, ok, renderCopy, resolveHome } from "@product-loop/model";
import type { CommandEnv } from "../connect.ts";
import { autostartCopy } from "../copy/autostart.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { helpOf } from "./shared.ts";

// ploop backend autostart on|off|status：登录时自动启动后端的 launchd 启动项，
// 见「01 架构」第六节和决定 167、198。只有用户运行 on 才装，没有别的命令会装它。
// 启动项放在 ~/Library/LaunchAgents/，指向 ploop setup 装好的 app/current/backend.mjs，
// 用运行命令行的这个 Node 的绝对路径，和 ~/.local/bin/ploop 的启动脚本一样。
// 用 launchctl bootstrap 加载、bootout 卸载。launchctl 由调用的一方传进来，测试换成假的。

/** 启动项的标签，也是文件名。集中存储在默认位置时用它，别处的见 agentLabelFor。 */
const launchAgentLabel = "com.product-loop.backend";

/** 运行 launchctl 的结果：退出码和输出。 */
export type LaunchctlRun = { readonly code: number; readonly output: string };

/** 运行 launchctl。 */
type Launchctl = (args: readonly string[]) => Promise<LaunchctlRun>;

/** 装、卸、查启动项要用的外部东西，测试时换成假的。 */
export type AutostartDeps = {
  readonly launchctl: Launchctl;
  /** 当前用户的编号，launchd 的用户域是 gui/<编号>。 */
  readonly uid: number;
  readonly platform: NodeJS.Platform;
  /** 运行后端的 Node，写进启动项。 */
  readonly node: string;
};

/**
 * 这份集中存储的启动项标签。launchd 的标签在整个用户下只有一份，PLOOP_HOME 指到别处时，
 * 标签后面加上这个路径的哈希，两份集中存储各装各的，装、卸时不会碰到对方的。
 */
export function agentLabelFor(ctx: Pick<CommandEnv, "env" | "cwd" | "userHome">): string {
  const home = resolveHome(ctx.env, ctx);
  if (home === resolveHome({}, ctx)) return launchAgentLabel;
  return `${launchAgentLabel}.${createHash("sha256").update(home).digest("hex").slice(0, 8)}`;
}

/** 启动项文件。 */
export function agentFile(userHome: string, label: string = launchAgentLabel): string {
  return join(userHome, "Library", "LaunchAgents", `${label}.plist`);
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * 启动项的内容。登录时运行（RunAtLoad）。
 * 只在异常退出时重启：ploop backend stop 是正常退出，不会被拉回来，
 * 这是用户定的「停了就停着」（决定 167）。
 */
export function renderPlist(input: {
  readonly label?: string;
  readonly node: string;
  readonly entry: string;
  readonly home: string;
  readonly logFile: string;
}): string {
  const text = (value: string) => `<string>${escapeXml(value)}</string>`;
  return `${[
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
    `<plist version="1.0">`,
    `<dict>`,
    `  <key>Label</key>`,
    `  ${text(input.label ?? launchAgentLabel)}`,
    `  <key>ProgramArguments</key>`,
    `  <array>`,
    `    ${text(input.node)}`,
    `    ${text(input.entry)}`,
    `  </array>`,
    `  <key>EnvironmentVariables</key>`,
    `  <dict>`,
    `    <key>PLOOP_HOME</key>`,
    `    ${text(input.home)}`,
    `  </dict>`,
    `  <key>WorkingDirectory</key>`,
    `  ${text(input.home)}`,
    `  <key>RunAtLoad</key>`,
    `  <true/>`,
    `  <key>KeepAlive</key>`,
    `  <dict>`,
    `    <key>SuccessfulExit</key>`,
    `    <false/>`,
    `  </dict>`,
    `  <key>ThrottleInterval</key>`,
    `  <integer>10</integer>`,
    `  <key>StandardOutPath</key>`,
    `  ${text(input.logFile)}`,
    `  <key>StandardErrorPath</key>`,
    `  ${text(input.logFile)}`,
    `</dict>`,
    `</plist>`,
  ].join("\n")}\n`;
}

/** 已装好的后端入口：ploop setup 让 current 指向的那一版。 */
function installedEntry(home: string): string {
  return join(home, "app", "current", "backend.mjs");
}

/** 启动项自己的日志，和后端的日志放在一起。 */
function launchdLog(home: string): string {
  return join(home, "logs", "launchd.log");
}

/** launchd 的用户域和这个启动项的完整名字。 */
const domainOf = (deps: AutostartDeps) => `gui/${deps.uid}`;
const targetOf = (deps: AutostartDeps, label: string) => `${domainOf(deps)}/${label}`;

/** 真的 launchctl。环境变量 PLOOP_LAUNCHCTL 换程序，给测试用，不碰真实的 launchd。 */
function realLaunchctl(env: CommandEnv["env"]): Launchctl {
  const program =
    env.PLOOP_LAUNCHCTL === undefined || env.PLOOP_LAUNCHCTL === ""
      ? "launchctl"
      : env.PLOOP_LAUNCHCTL;
  return (args) =>
    new Promise((resolve) => {
      execFile(program, [...args], { encoding: "utf8" }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 127;
        resolve({ code, output: `${stdout}${stderr}`.trim() });
      });
    });
}

/** 命令里用的外部东西：真的 launchctl、真的用户编号和系统。 */
function realDeps(env: CommandEnv["env"]): AutostartDeps {
  return {
    launchctl: realLaunchctl(env),
    uid: process.getuid?.() ?? 0,
    platform: process.platform,
    node: process.execPath,
  };
}

function notMac(deps: AutostartDeps): Outcome | undefined {
  if (deps.platform === "darwin") return undefined;
  const { message, hint } = autostartCopy.errors.notMac;
  return err(errorBody("BAD_REQUEST", [{ message: renderCopy(message), hint: renderCopy(hint) }]));
}

/** ploop backend autostart on：写启动项并加载。已经装过的重新写、重新加载。 */
export async function autostartOn(ctx: CommandEnv, deps: AutostartDeps): Promise<Outcome> {
  const refused = notMac(deps);
  if (refused !== undefined) return refused;
  const home = resolveHome(ctx.env, ctx);
  const entry = installedEntry(home);
  if (!existsSync(entry)) {
    const { message, hint } = autostartCopy.errors.notSetup;
    const issue = { message: renderCopy(message, { entry }), hint: renderCopy(hint) };
    return err(errorBody("NOT_FOUND", [issue]));
  }
  const label = agentLabelFor(ctx);
  const file = agentFile(ctx.userHome, label);
  await mkdir(join(ctx.userHome, "Library", "LaunchAgents"), { recursive: true });
  await mkdir(join(home, "logs"), { recursive: true });
  await writeFile(
    file,
    renderPlist({ label, node: deps.node, entry, home, logFile: launchdLog(home) }),
  );
  // 已经加载过的先卸掉，bootstrap 不会覆盖它。没加载过时卸载会失败，不用管。
  await deps.launchctl(["bootout", targetOf(deps, label)]);
  const loaded = await deps.launchctl(["bootstrap", domainOf(deps), file]);
  if (loaded.code !== 0) {
    const { message, hint } = autostartCopy.errors.loadFailed;
    const detail = loaded.output === "" ? `退出码 ${loaded.code}` : loaded.output;
    const issue = { message: renderCopy(message, { detail }), hint: renderCopy(hint), where: file };
    return err(errorBody("INTERNAL", [issue]));
  }
  const { output } = autostartCopy;
  return ok({
    kind: "backend.autostart.on",
    data: { installed: true, loaded: true, file, node: deps.node, entry },
    lines: [
      renderCopy(output.installed),
      renderCopy(output.file, { file }),
      renderCopy(output.command, { node: deps.node, entry }),
      renderCopy(output.crash),
      renderCopy(output.stopNote),
      renderCopy(output.stopNext),
    ],
    next: [renderCopy(autostartCopy.help.on.after)],
    warnings: [],
  });
}

/** ploop backend autostart off：卸载并删除启动项。没装过就什么都不做。 */
export async function autostartOff(ctx: CommandEnv, deps: AutostartDeps): Promise<Outcome> {
  const refused = notMac(deps);
  if (refused !== undefined) return refused;
  const label = agentLabelFor(ctx);
  const file = agentFile(ctx.userHome, label);
  const { output } = autostartCopy;
  if (!existsSync(file)) {
    return ok({
      kind: "backend.autostart.off",
      data: { installed: false, removed: false, file },
      lines: [renderCopy(output.notInstalledYet)],
      next: [],
      warnings: [],
    });
  }
  const unloaded = await deps.launchctl(["bootout", targetOf(deps, label)]);
  await rm(file, { force: true });
  return ok({
    kind: "backend.autostart.off",
    data: { installed: false, removed: true, unloaded: unloaded.code === 0, file },
    lines: [
      renderCopy(output.removed),
      renderCopy(output.fileRemoved, { file }),
      ...(unloaded.code === 0 ? [renderCopy(output.stoppedWithAgent)] : []),
    ],
    next: [],
    warnings: [],
  });
}

/** ploop backend autostart status：装没装、加载没加载。 */
export async function autostartStatus(ctx: CommandEnv, deps: AutostartDeps): Promise<Outcome> {
  const refused = notMac(deps);
  if (refused !== undefined) return refused;
  const label = agentLabelFor(ctx);
  const file = agentFile(ctx.userHome, label);
  const { output } = autostartCopy;
  if (!existsSync(file)) {
    return ok({
      kind: "backend.autostart.status",
      data: { installed: false, loaded: false, file },
      lines: [renderCopy(output.off)],
      next: [renderCopy(autostartCopy.help.examples.on)],
      warnings: [],
    });
  }
  const loaded = (await deps.launchctl(["print", targetOf(deps, label)])).code === 0;
  return ok({
    kind: "backend.autostart.status",
    data: { installed: true, loaded, file },
    lines: [
      renderCopy(output.on),
      renderCopy(output.file, { file }),
      renderCopy(loaded ? output.loaded : output.notLoaded),
    ],
    next: [],
    warnings: [],
  });
}

/** 挂上 ploop backend autostart 和它的三个子命令。 */
export function autostartCommand(group: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = autostartCopy;
  const autostart = group.command("autostart").description(renderCopy(help.description));
  withHelp(autostart, { details: Object.values(help.details).map((entry) => renderCopy(entry)) });
  const deps = () => realDeps(context.env);

  const on = autostart
    .command("on")
    .description(renderCopy(help.on.description))
    .action(async () => context.settle(await autostartOn(context, deps())));
  withHelp(
    on,
    helpOf({
      details: Object.values(help.on.details),
      blocks: Object.values(help.on.blocks),
      reads: help.reads,
      writes: help.on.writes,
      examples: [help.examples.on],
      after: help.on.after,
    }),
  );

  const off = autostart
    .command("off")
    .description(renderCopy(help.off.description))
    .action(async () => context.settle(await autostartOff(context, deps())));
  withHelp(
    off,
    helpOf({
      details: Object.values(help.off.details),
      reads: help.reads,
      writes: help.off.writes,
      examples: [help.examples.off],
      after: help.off.after,
    }),
  );

  const status = autostart
    .command("status")
    .description(renderCopy(help.status.description))
    .action(async () => context.settle(await autostartStatus(context, deps())));
  withHelp(status, {
    details: Object.values(help.status.details).map((entry) => renderCopy(entry)),
    reads: renderCopy(help.reads),
    examples: [renderCopy(help.examples.status)],
  });
}
