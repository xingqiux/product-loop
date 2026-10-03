import type { CommandUnknownOpts } from "@commander-js/extra-typings";
import { createClient } from "@product-loop/client";
import { findBackend } from "@product-loop/client/node";
import { ok, pageNameOfLabel, renderCopy } from "@product-loop/model";
import { connect } from "../connect.ts";
import { primeCopy } from "../copy/prime.ts";
import { statusCopy } from "../copy/status.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { discoverProject } from "../project/discover.ts";
import { globalProject, helpOf } from "./shared.ts";
import { headLine, queueText } from "./status.ts";

// ploop prime：会话开始时把当前项目的状态和下一步交给 AI，见「09 skill 与软件」第八节。
// 会话被压缩以后 AI 可能忘了还在用产品循环，钩子每次会话开始都运行它。
// 钩子里的命令不能拖慢会话，也不能报错吓人，所以和别的命令相反：只看一眼后端，不拉起它，
// 退出码一直是 0。不在项目里什么都不输出；在项目里但后端没开、三秒内没应答、没能取到状态时，
// 各写一行说明现在是什么情况、下一步敲什么，这样 AI 分得出「这个项目没用产品循环」和「后端没开」。

/** 整条命令最多等多久，毫秒。含后端应答，超了就当没有。 */
const budgetMs = 3_000;

/** 输出的下一步最多几条：合起来不超过十行。 */
const maxNext = 2;

/** 什么都不输出：不在项目里。 */
const nothing: Outcome = ok({
  kind: "prime.none",
  data: {},
  lines: [""],
  next: [],
  warnings: [],
  quiet: true,
});

/** 在项目里，可是给不出状态：三种情况各写一行，退出码仍是 0。 */
type Unavailable = keyof typeof primeCopy.unavailable;

function unavailable(reason: Unavailable): Outcome {
  return ok({
    kind: "prime.unavailable",
    data: { reason },
    lines: [renderCopy(primeCopy.unavailable[reason])],
    next: [],
    warnings: [],
  });
}

/** 当前项目的状态，十行以内。 */
async function prime(ctx: ProgramContext, projectOption: string | undefined): Promise<Outcome> {
  let inProject = false;
  try {
    const discovery = await discoverProject({
      cwd: ctx.cwd,
      home: ctx.userHome,
      ...(projectOption === undefined ? {} : { projectOption }),
    });
    if (!discovery.ok || discovery.value.kind === "none") return nothing;
    const found = discovery.value;
    const pid = found.kind === "byId" ? found.projectId : found.identity.projectId;
    inProject = true;

    const backend = connect(ctx);
    const running = await findBackend(backend.ensureOptions);
    if (running === undefined) return unavailable("notRunning");
    const client = createClient({
      baseUrl: `http://127.0.0.1:${running.port}`,
      client: "cli",
      timeoutMs: budgetMs,
    });
    // 后端忙时客户端会按 Retry-After 一直等，用总时限拦住。
    const result = await client.call(
      (api) => api.api.v1.projects[":pid"].status.$get({ param: { pid } }),
      {
        signal: AbortSignal.timeout(budgetMs),
      },
    );
    // 取不到状态的原因不在这里展开，运行 ploop status 会写明。
    if (!result.ok) return unavailable("failed");

    const { data: status, next } = result.value;
    const [first, ...others] = status.waitingPages;
    const waiting =
      first === undefined
        ? [renderCopy(statusCopy.waitingNone)]
        : others.length === 0
          ? [
              renderCopy(statusCopy.waiting, {
                page: pageNameOfLabel(first.round, first.seq),
                purpose: first.purpose,
              }),
            ]
          : [
              renderCopy(primeCopy.waitingMore, {
                count: status.waitingPages.length,
                page: pageNameOfLabel(first.round, first.seq),
                purpose: first.purpose,
              }),
            ];
    return ok({
      kind: "prime.state",
      data: status,
      lines: [
        renderCopy(primeCopy.tip),
        renderCopy(primeCopy.skill),
        headLine(status),
        ...waiting,
        queueText(status),
      ],
      next: next.slice(0, maxNext),
      warnings: [],
    });
  } catch {
    // 超时被取消、接口的应答对不上，都不能打断会话：在项目里就说一声没有应答。
    return inProject ? unavailable("noAnswer") : nothing;
  }
}

/** 挂上 ploop prime。 */
export function primeCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = primeCopy;
  const command = program
    .command("prime")
    .description(renderCopy(help.description))
    .action(async (_options, self) => {
      context.settle(await prime(context, globalProject(self)));
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
