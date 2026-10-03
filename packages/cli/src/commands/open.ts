import { spawn } from "node:child_process";
import { type CommandUnknownOpts, Option } from "@commander-js/extra-typings";
import { type CopyEntry, type Issue, ok, pagePurpose, renderCopy } from "@product-loop/model";
import { type CommandEnv, connect } from "../connect.ts";
import { openCopy } from "../copy/open.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { programFailure } from "../project/read-error.ts";
import { addressOf, globalProject, helpOf, openProject } from "./shared.ts";

// ploop open：在浏览器里打开工作台的页面，见「04 命令行」第二节和「06 工作台」第一节。
// --round 打开指定的阶段；--queue、--mainline、--decisions 打开这个项目的队列看板、主线页、决定页；
// --all 打开首页，列出所有项目，不需要在项目里。都不写时，有在等的页就打开它所在的阶段，
// 没有就打开最近的阶段，一个阶段也没开始过就打开项目页。
// 打开浏览器用系统的命令：macOS 是 open，Windows 是 start，其余是 xdg-open。
// 环境变量 PLOOP_BROWSER 写了程序时用它，测试用它换掉浏览器。

/** 打开浏览器的命令和参数。 */
function browserCommand(env: CommandEnv["env"], url: string): [string, string[]] {
  const chosen = env.PLOOP_BROWSER;
  if (chosen !== undefined && chosen !== "") return [chosen, [url]];
  if (process.platform === "darwin") return ["open", [url]];
  if (process.platform === "win32") return ["cmd", ["/c", "start", "", url]];
  return ["xdg-open", [url]];
}

/** 起一个打开浏览器的进程，不等它结束。起不来时返回原因。 */
function launch(command: string, args: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.once("error", (error: NodeJS.ErrnoException) => resolve(error.code ?? error.message));
    child.once("spawn", () => {
      child.unref();
      resolve(undefined);
    });
  });
}

/** 要打开哪里：命令行选项里最多写一个。 */
type OpenOptions = {
  readonly round?: string | undefined;
  readonly queue?: boolean | undefined;
  readonly mainline?: boolean | undefined;
  readonly decisions?: boolean | undefined;
  readonly all?: boolean | undefined;
};

/** 打开地址，起浏览器，把结果写成输出。note 是地址之外要补的一行。 */
async function launchUrl(
  ctx: CommandEnv,
  target: {
    readonly url: string;
    readonly data: object;
    readonly note?: string;
    readonly next?: string;
  },
): Promise<Outcome> {
  const [command, args] = browserCommand(ctx.env, target.url);
  const failed = await launch(command, args);
  const warnings: Issue[] =
    failed === undefined
      ? []
      : [
          {
            message: renderCopy(openCopy.errors.browser.message, {
              command,
              reason: programFailure(failed).reason,
            }),
            hint: renderCopy(openCopy.errors.browser.hint),
          },
        ];
  const line = failed === undefined ? openCopy.output.opened : openCopy.output.notOpened;
  return ok({
    kind: "page.opened",
    data: { url: target.url, ...target.data },
    lines: [
      renderCopy(line, { url: target.url }),
      ...(target.note === undefined ? [] : [target.note]),
    ],
    next: target.next === undefined ? [] : [target.next],
    warnings,
  });
}

async function open(
  ctx: CommandEnv,
  project: string | undefined,
  options: OpenOptions,
): Promise<Outcome> {
  // 首页不属于哪个项目，不用找项目；先请后端起来，才知道端口。
  if (options.all === true) {
    const backend = connect(ctx);
    const health = await backend.call((api) => api.api.v1.health.$get());
    if (!health.ok) return health;
    return launchUrl(ctx, { url: addressOf(backend, "/"), data: { target: "all" } });
  }
  const opened = await openProject(ctx, project);
  if (!opened.ok) return opened;
  const { backend, projectId: pid } = opened.value;
  // 队列看板、主线页、决定页：路径就是项目页下面的一层。
  const named = (["queue", "mainline", "decisions"] as const).find(
    (name) => options[name] === true,
  );
  if (named !== undefined) {
    const url = addressOf(backend, encodeURI(`/p/${pid}/${named}`));
    return launchUrl(ctx, { url, data: { target: named, project: pid } });
  }
  let label = options.round;
  // 只有真有一页在等用户点，下一步才是等回复。
  let waitingAsk = false;
  if (label === undefined) {
    const status = await backend.call((api) =>
      api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
    );
    if (!status.ok) return status;
    const { waitingPages, round: latest } = status.value.data;
    const waiting =
      waitingPages.find((page) => page.purpose === pagePurpose.label("ask")) ?? waitingPages.at(0);
    label = waiting?.round ?? latest?.label;
    waitingAsk = waitingPages.some((page) => page.purpose === pagePurpose.label("ask"));
  } else {
    // 写了阶段时先确认有这个阶段，写法不对或找不到照后端的报错。
    const found = await backend.call((api) =>
      api.api.v1.projects[":pid"].rounds[":rid"].$get({ param: { pid, rid: label as string } }),
    );
    if (!found.ok) return found;
    label = found.value.data.round.label;
  }
  // 一个阶段也没开始过：没有页可打开，打开项目页，说明为什么。
  if (label === undefined) {
    const url = addressOf(backend, encodeURI(`/p/${pid}`));
    return launchUrl(ctx, {
      url,
      data: { target: "project", project: pid },
      note: renderCopy(openCopy.output.noRound),
      next: renderCopy(openCopy.next.start),
    });
  }
  const url = addressOf(backend, encodeURI(`/p/${pid}/r/${label}`));
  return launchUrl(ctx, {
    url,
    data: { target: "round", project: pid, round: label },
    ...(waitingAsk ? { next: renderCopy(openCopy.next.wait) } : {}),
  });
}

const targets = ["round", "queue", "mainline", "decisions", "all"] as const;

/** 要打开哪里的几个选项互相排斥，只能写一个。 */
function exclusive(option: Option, name: (typeof targets)[number]): Option {
  return option.conflicts(targets.filter((other) => other !== name));
}

/** 挂上 ploop open。 */
export function openCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = openCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const command = program
    .command("open")
    .description(t(help.description))
    .option("--round <阶段>", t(help.round))
    .addOption(exclusive(new Option("--queue", t(help.queue)), "queue"))
    .addOption(exclusive(new Option("--mainline", t(help.mainline)), "mainline"))
    .addOption(exclusive(new Option("--decisions", t(help.decisions)), "decisions"))
    .addOption(exclusive(new Option("--all", t(help.all)), "all"))
    .action(async (options, self) => {
      context.settle(await open(context, globalProject(self), options));
    });
  withHelp(
    command,
    helpOf({
      details: Object.values(help.details),
      reads: help.reads,
      writes: help.writes,
      examples: Object.values(help.examples),
      after: help.after,
    }),
  );
}
