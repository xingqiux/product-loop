import { resolve } from "node:path";
import { type CommandUnknownOpts, Option } from "@commander-js/extra-typings";
import {
  type CopyEntry,
  type ErrorBody,
  err,
  errorBody,
  ok,
  pageCheckReportSchema,
  type RepoKind,
  type Result,
  renderCopy,
  repoKind,
} from "@product-loop/model";
import { type Backend, type CommandEnv, connect } from "../connect.ts";
import { doctorCopy } from "../copy/doctor.ts";
import { initCopy } from "../copy/init.ts";
import { doctorChecks } from "../doctor/checks.ts";
import { runFix } from "../doctor/fix.ts";
import { checkOf, type DoctorCheck } from "../doctor/items.ts";
import { applyMigrate, prepareMigrate } from "../doctor/migrate.ts";
import type { PageChecker } from "../doctor/migrate-pages.ts";
import { renderDoctorReport } from "../doctor/render.ts";
import { type DoctorScan, scanProject } from "../doctor/scan.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import type { ProgramContext } from "../program.ts";
import { registeredAt } from "../project/current.ts";
import { discoverProject } from "../project/discover.ts";
import { runInit } from "./init.ts";
import { globalProject, helpOf } from "./shared.ts";

// ploop doctor [--fix] [--from <目录>]：迁移检查和迁移，见「04 命令行」第二节和「08 版本与迁移」第四节。
// 1. 定根目录，和 ploop init 相同。旧文件在项目根以外时由 --from 指明。
// 2. 扫描，写迁移对照，读回来，逐页按历史页面模式校验（要问后端，没有旧页面时不拉起后端）。
// 3. 不写 --fix 时写出迁移检查报告。写 --fix 时，还有要确认的地方就停下，没有就执行迁移。
// 看不出仓库类别时要问用户，用户答了以后由 --repo 给出。

type RepoLabel = (typeof repoKind.labels)[number];

type DoctorOptions = {
  readonly fix: boolean;
  readonly verbose: boolean;
  readonly from: string | undefined;
  readonly repo: RepoLabel | undefined;
  readonly project: string | undefined;
};

/** --repo 给出了仓库类别，替掉扫描时看不出的。 */
function withRepo(scan: DoctorScan, repo: RepoKind | undefined): DoctorScan {
  if (repo === undefined || scan.ignore.kind !== "notIgnored") return scan;
  return { ...scan, ignore: { ...scan.ignore, repoKind: repo } };
}

/** project.json 记着的项目和集中存储里这个目录的登记对不对得上：对得上时没有，对不上时是哪一种。 */
type Relink = { readonly projectId: string; readonly other: string | undefined };

async function relinkOf(
  backend: Backend,
  scan: DoctorScan,
): Promise<Result<Relink | undefined, ErrorBody>> {
  if (scan.identity.kind !== "valid") return ok(undefined);
  const { projectId } = scan.identity.identity;
  const registered = await registeredAt(backend, scan.root);
  if (!registered.ok) return registered;
  if (registered.value?.id === projectId) return ok(undefined);
  return ok({ projectId, other: registered.value?.id });
}

/** 身份一项：对照集中存储里的登记，对不上时写出来，--fix 重新登记。 */
function withRelink(checks: readonly DoctorCheck[], relink: Relink | undefined): DoctorCheck[] {
  if (relink === undefined) return [...checks];
  const t = doctorCopy.identity;
  const { projectId, other } = relink;
  const check =
    other === undefined
      ? checkOf("identity", {
          found: [renderCopy(t.notRegistered, { projectId }), renderCopy(t.notRegisteredWhy)],
          fix: [renderCopy(t.registerAgain)],
        })
      : checkOf("identity", {
          found: [renderCopy(t.registeredToOther, { projectId, other })],
          fix: [renderCopy(t.relink, { other })],
        });
  return checks.map((each) => (each.item === "identity" ? check : each));
}

async function doctor(ctx: CommandEnv, options: DoctorOptions): Promise<Outcome> {
  const discovery = await discoverProject({
    cwd: ctx.cwd,
    home: ctx.userHome,
    forDoctor: true,
    ...(options.project === undefined ? {} : { projectOption: options.project }),
  });
  if (!discovery.ok) return discovery;
  const found = discovery.value;
  if (found.kind === "byId") {
    const { message, hint } = initCopy.errors.byId;
    const issue = {
      message: renderCopy(message, { value: found.projectId }),
      hint: renderCopy(hint),
    };
    return err(errorBody("BAD_REQUEST", [issue]));
  }
  const root = found.kind === "found" ? found.root : (found.gitRoot ?? found.from);
  const from = options.from === undefined ? undefined : resolve(ctx.cwd, options.from);
  // 取值由 commander 按标签限定过，一定认得。
  const repo = options.repo === undefined ? undefined : (repoKind.key(options.repo) as RepoKind);
  const scan = withRepo(await scanProject(root, from === undefined ? {} : { from }), repo);

  const backend = connect(ctx);
  const check: PageChecker = async (input) => {
    const checked = await backend.call((api) =>
      api.api.v1.legacy.pages.check.$post({ json: input }),
    );
    return checked.ok
      ? ok({ block: pageCheckReportSchema.parse(checked.value.data).block })
      : checked;
  };
  const prepared = await prepareMigrate(scan, check);
  if (!prepared.ok) return prepared;
  const state = prepared.value;
  const relink = await relinkOf(backend, scan);
  if (!relink.ok) return relink;
  const migrated =
    state === undefined ? doctorChecks(scan) : await applyMigrate(scan, doctorChecks(scan), state);
  const checks = withRelink(migrated, relink.value);
  const t = doctorCopy.migrate;
  const lines =
    state === undefined
      ? []
      : [
          ...(state.written.length > 0
            ? [renderCopy(t.written, { files: state.written.join("、") })]
            : []),
          renderCopy(t.dir, { dir: `${state.dir}/` }),
        ];
  const report = renderDoctorReport(scan, { checks, lines, verbose: options.verbose });
  // 没有要迁移的旧文件，只是集中存储里没有登记这个目录：--fix 重新登记，和 ploop init 一样。
  if (options.fix && state === undefined && relink.value !== undefined) {
    return runInit(ctx, {
      repo: options.repo,
      project: options.project,
      hook: "no",
      ask: undefined,
    });
  }
  if (!options.fix || state === undefined) return ok(report);
  const confirm = checks.filter((item) => item.status === "confirm").length;
  if (confirm > 0) {
    const text = doctorCopy.run.errors.confirmFirst;
    const issue = {
      message: renderCopy(text.message, { count: confirm }),
      hint: renderCopy(text.hint),
    };
    return err(errorBody("CONFLICT", [issue]));
  }
  return runFix({ backend, scan, state, repo });
}

/** 挂上 ploop doctor。 */
export function doctorCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = doctorCopy;
  const t = (entry: CopyEntry) => renderCopy(entry);
  const command = program
    .command("doctor")
    .description(t(help.description))
    .option("--fix", t(help.fix))
    .option("--verbose", t(help.verbose))
    .option("--from <目录>", t(help.from))
    .addOption(new Option("--repo <仓库>", t(help.repo)).choices(repoKind.labels))
    .action(async (options, self) => {
      context.settle(
        await doctor(context, {
          fix: options.fix === true,
          verbose: options.verbose === true,
          from: options.from,
          repo: options.repo,
          project: globalProject(self),
        }),
      );
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
