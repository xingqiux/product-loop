import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type CommandUnknownOpts, InvalidArgumentError, Option } from "@commander-js/extra-typings";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  mainlineTemplate,
  ok,
  type ProjectIdentity,
  projectIdentityVersion,
  type RepoKind,
  type Result,
  renderCopy,
  repoKind,
} from "@product-loop/model";
import { type Backend, type CommandEnv, connect } from "../connect.ts";
import { initCopy } from "../copy/init.ts";
import { hasUncommittedChange } from "../git.ts";
import { withHelp } from "../help.ts";
import type { Outcome } from "../output.ts";
import { shownFrom } from "../page/data.ts";
import type { ProgramContext } from "../program.ts";
import { projectCacheDir, writeProjectCache } from "../project/cache.ts";
import { type ProjectView, registeredAt } from "../project/current.ts";
import { discoverProject } from "../project/discover.ts";
import {
  ensureIgnoreRule,
  ignoreFileFor,
  inferRepoKind,
  settingsIgnoreRule,
} from "../project/ignore.ts";
import { backendRemote, mainlineFileName, syncMainline } from "../project/mainline-sync.ts";
import {
  inspectSessionHook,
  installSessionHook,
  primeCommandLineOf,
  settingsFile,
  type UnusableReason,
  uninstallSessionHook,
} from "../project/session-hook.ts";
import { globalProject, shellWord } from "./shared.ts";
import { projectName } from "./status.ts";

// ploop init：在当前项目开工，见「04 命令行」第二节、「03 数据模型」第五节和 S13 第 1 步。
// 1. 定根目录：往上找到了 project.json 就是它所在的目录，是重跑。
//    没找到时，在 git 仓库里取仓库的根目录，不在仓库里取当前目录。
// 2. 问后端这个根目录登记过没有。登记过就是重跑，例如 project.json 被删了。
// 3. 仓库是谁的由 --repo 定。AI 不能替用户答，第一次开工没写时退出码 2，打印要问的话。
// 4. 登记项目，第 1 版同时建好。重跑时仓库类别或规则的位置变了才改。
// 5. 写忽略规则，建项目缓存，写 project.json 和 README.md。
// 6. 还没有主线时写进主线模板，当场交成第 1 版。
// 登记在写文件之前：写文件失败时重跑，按第 2 步找回登记过的项目。

type RepoLabel = (typeof repoKind.labels)[number];

export type InitOptions = {
  readonly repo: RepoLabel | undefined;
  /** 全局选项 --project：开工的目录。只收路径。 */
  readonly project: string | undefined;
  /** --hook：yes 写会话开始的钩子，no 不写、写过的撤掉，不写这个选项时第一次开工在终端里问。 */
  readonly hook: HookChoice | undefined;
  /** 在终端里问用户一句，返回回答。不能问时（不在终端里、要 --json）没有它。 */
  readonly ask: Ask | undefined;
};

type HookChoice = "yes" | "no";
/** --hook 的取值写中文，yes、no 也认。 */
const hookLabels = ["是", "否"] as const;
const hookByLabel: ReadonlyMap<string, HookChoice> = new Map([
  ["是", "yes"],
  ["否", "no"],
  ["yes", "yes"],
  ["no", "no"],
]);

/** 问用户一句话，返回回答。用户没有回答（输入结束）时返回 undefined。 */
export type Ask = (question: string) => Promise<string | undefined>;

/**
 * 会话开始钩子的处理结果。removed 是 --hook no 撤掉了 ploop 写的钩子；
 * foreign 是设置里有运行 ploop prime 的钩子，但不是 ploop init 写的样子，没有动。
 */
export type HookState =
  | {
      readonly kind:
        | "written"
        | "present"
        | "updated"
        | "declined"
        | "undecided"
        | "removed"
        | "foreign";
    }
  | { readonly kind: "unusable"; readonly reason: UnusableReason | "notJson" };

/** 用户的回答是不是同意。只认明确的同意，其余都当成不同意。 */
function agreed(answer: string | undefined): boolean {
  return /^\s*(y|yes|是|好|同意|要)\s*$/iu.test(answer ?? "");
}

/**
 * 决定要不要写会话开始的钩子，见「13 待定」第 8 项和决定 197：只在用户同意时写。
 * --hook no 不写，之前写过的撤掉：只去掉 ploop 写的那一条，设置文件里别的东西原样保留。
 * 设置文件读不出来时没法撤，也不再提醒，文件不动。
 * 已经有就不再问。--hook 是（yes）就是同意。都没有时在终端里问，不能问的（不在终端里）不写，
 * 交给 AI 去问用户。只在第一次开工时问、提醒：以后重跑 ploop init 不再问，要写就写 --hook 是。
 */
export async function setupHook(
  root: string,
  choice: HookChoice | undefined,
  ask: Ask | undefined,
  first = true,
  commandLine?: string,
): Promise<HookState> {
  if (choice === "no") {
    const removed = await uninstallSessionHook(root, commandLine);
    return removed.kind === "removed" || removed.kind === "foreign"
      ? { kind: removed.kind }
      : { kind: "declined" };
  }
  const seen = await inspectSessionHook(root, commandLine);
  if (seen.kind === "unusable") return seen;
  if (seen.kind === "present") return { kind: "present" };
  // 早先写的相对写法：没写 --hook 是 就照旧不动，写了才换成绝对路径。
  if (seen.kind === "legacy" && choice !== "yes") return { kind: "present" };
  if (choice === undefined) {
    if (ask === undefined || !first) return { kind: "undecided" };
    const file = settingsFile(root);
    if (!agreed(await ask(renderCopy(initCopy.prompt.hook, { file })))) {
      return { kind: "declined" };
    }
  }
  return installSessionHook(root, commandLine);
}

/** 第一次开工没写 --repo：写出要问用户的话，和两种回答各自的完整命令。 */
function askRepo(project: string | undefined): ErrorBody<"BAD_REQUEST"> {
  const suffix = project === undefined ? "" : ` --project ${shellWord(project)}`;
  const command = (label: RepoLabel) => `ploop init --repo ${label}${suffix}`;
  const { message, hint } = initCopy.errors.askRepo;
  const issue: Issue = {
    message: renderCopy(message),
    hint: renderCopy(hint, {
      own: command(repoKind.label("own")),
      shared: command(repoKind.label("shared")),
    }),
  };
  return errorBody("BAD_REQUEST", [issue]);
}

/** 在当前项目开工。 */
export async function runInit(ctx: CommandEnv, options: InitOptions): Promise<Outcome> {
  const discovery = await discoverProject({
    cwd: ctx.cwd,
    home: ctx.userHome,
    homeIsUsage: true,
    ...(options.project === undefined ? {} : { projectOption: options.project }),
  });
  if (!discovery.ok) return discovery;
  const found = discovery.value;
  if (found.kind === "byId") {
    const { message, hint } = initCopy.errors.byId;
    const text = {
      message: renderCopy(message, { value: found.projectId }),
      hint: renderCopy(hint),
    };
    return err(errorBody("BAD_REQUEST", [text]));
  }
  const root = found.kind === "found" ? found.root : (found.gitRoot ?? found.from);
  const backend = connect(ctx);
  const registered = await registeredAt(backend, root);
  if (!registered.ok) return registered;
  const before = registered.value;
  // project.json 记着的项目和集中存储里这个目录的登记对不上，例如数据库恢复到了较早的备份，
  // 集中存储里没有这个项目了。集中存储是准的，项目缓存原样保留，按它重新登记。
  const relinked = found.kind === "found" && before?.id !== found.identity.projectId;
  const inferred = relinked && before === undefined ? await inferRepoKind(root) : undefined;
  const repoLabel =
    options.repo ??
    before?.repoKind ??
    (inferred === undefined ? undefined : repoKind.label(inferred));
  if (repoLabel === undefined) return err(askRepo(options.project));
  // 取值由 commander 按标签限定过，登记过的项目也是标签，一定认得。
  const repo = repoKind.key(repoLabel) as RepoKind;
  const ignoreFile = await ignoreFileFor(root, repo);
  if (!ignoreFile.ok) return ignoreFile;

  const saved = await save(backend, before, {
    root,
    repoKind: repoLabel,
    ignoreFile: ignoreFile.value,
  });
  if (!saved.ok) return saved;
  const { project, version } = saved.value;
  if (project.skillVersion === null) {
    const { message, hint } = initCopy.errors.migrating;
    const text = { message: renderCopy(message, { project: project.id }), hint: renderCopy(hint) };
    return err(errorBody("NEEDS_DOCTOR", [text]));
  }

  const ruleAdded = await ensureIgnoreRule(ignoreFile.value);
  // 重新登记以后，缓存里记的主线基准指向的版本集中存储里没有了，不能沿用。
  const base = found.kind === "found" && !relinked ? found.identity.mainlineBase : undefined;
  const identity: ProjectIdentity = {
    schemaVersion: projectIdentityVersion,
    projectId: project.id,
    skillVersion: project.skillVersion,
    ...(base === undefined ? {} : { mainlineBase: base }),
  };
  const cacheDir = await writeProjectCache(root, identity);

  const template = await writeMainlineTemplate(backend, root, identity);
  if (!template.ok) return template;
  // 集中存储里没有这个项目的主线，缓存里的主线.md 当场交成第 1 版，不等下一条命令。
  const restored = relinked && before === undefined && template.value === undefined;
  if (restored) {
    const remote = backendRemote(backend, identity.projectId);
    const synced = await syncMainline({ root, identity, remote, mode: "auto" });
    if (!synced.ok) return synced;
  }

  const created = before === undefined;
  const hook = await setupHook(
    root,
    options.hook,
    options.ask,
    created,
    primeCommandLineOf(ctx.userHome),
  );
  // 钩子写在 .claude/settings.local.json：它只在本机用，不进仓库，
  // 没有全局忽略规则的机器上会被落地收尾的「有文件没提交」拦住，所以规则写进同一个忽略文件。
  const settingsRuleAdded =
    hook.kind === "written" || hook.kind === "updated" || hook.kind === "present"
      ? await ensureIgnoreRule(ignoreFile.value, settingsIgnoreRule)
      : false;
  const { output } = initCopy;
  const name = projectName(project.name, project.id);
  const headLine = relinked
    ? renderCopy(before === undefined ? output.registeredAgain : output.idRewritten, {
        project: name,
        from: found.kind === "found" ? found.identity.projectId : "",
        to: project.id,
      })
    : created
      ? renderCopy(output.created, { project: name, version: version ?? 1 })
      : renderCopy(output.again, { project: name });
  // 根目录只在「根目录」一行写全，别的路径写相对根目录的，免得同一个长路径印好几遍。
  const shown = shownFrom(root);
  const repoLine = renderCopy(ruleAdded ? output.ruleAdded : output.ruleKept, {
    repo: repoLabel,
    file: shown(ignoreFile.value),
  });
  // 自己的仓库里 .gitignore 没提交时，落地阶段收尾会被「有文件没提交」拦住，先提醒。
  const ignoreUncommitted =
    repo === "own" && (await hasUncommittedChange(root, ".gitignore")) === true;
  const repoChanged =
    before !== undefined && before.repoKind !== repoLabel
      ? [renderCopy(output.repoChanged, { from: before.repoKind, to: repoLabel })]
      : [];
  const hookOut = hookLines(hook, root, options.project, shown, {
    created,
    explicitNo: options.hook === "no",
  });
  // 已经开工过的项目，这次要做的事是写、换或撤钩子：结果写在第一行，「已经开工过」排后面。
  const hookFirst =
    !created &&
    !relinked &&
    (hook.kind === "written" || hook.kind === "updated" || hook.kind === "removed");
  const lines = [
    ...(hookFirst ? hookOut : []),
    headLine,
    ...(relinked && before === undefined ? [renderCopy(output.registeredAgainNote)] : []),
    ...(restored ? [renderCopy(output.mainlineRestored)] : []),
    renderCopy(output.root, { root }),
    renderCopy(output.cache, { dir: `${shown(cacheDir)}/` }),
    repoLine,
    ...(ignoreUncommitted ? [renderCopy(output.ignoreUncommitted, { file: ".gitignore" })] : []),
    ...repoChanged,
    ...(template.value === undefined
      ? []
      : [renderCopy(output.mainlineTemplate, { file: shown(template.value) })]),
    ...(hookFirst ? [] : hookOut),
    ...(settingsRuleAdded
      ? [
          renderCopy(output.settingsRuleAdded, {
            file: shown(settingsFile(root)),
            ignore: shown(ignoreFile.value),
          }),
        ]
      : []),
  ];
  const [first = "", ...rest] = lines;
  return ok({
    kind: "project.initialized",
    data: {
      created,
      reregistered: relinked,
      project,
      version,
      root,
      cacheDir,
      ignoreFile: ignoreFile.value,
      ruleAdded,
      mainlineTemplate: template.value ?? null,
      hook: hook.kind,
      settingsRuleAdded,
    },
    lines: [first, ...rest],
    next: [created && !relinked ? renderCopy(initCopy.help.after) : renderCopy(output.status)],
    warnings: hook.kind === "unusable" ? [hookWarning(root, hook.reason)] : [],
  });
}

/**
 * 钩子这一项输出的行。用户没同意的不写，第一次开工时不能问、还没答复的要提醒，
 * 以后重跑不再提醒。--hook no 写明撤掉了什么，没有可撤的也说一句。
 */
function hookLines(
  hook: HookState,
  root: string,
  project: string | undefined,
  shown: (file: string) => string,
  now: { readonly created: boolean; readonly explicitNo: boolean },
): string[] {
  const { output } = initCopy;
  const file = shown(settingsFile(root));
  switch (hook.kind) {
    case "written":
      return [renderCopy(output.hookWritten, { file })];
    case "present":
      return [renderCopy(output.hookPresent, { file })];
    case "updated":
      return [renderCopy(output.hookUpdated, { file })];
    case "removed":
      return [renderCopy(output.hookRemoved, { file })];
    case "foreign":
      return [renderCopy(output.hookForeign, { file })];
    case "declined":
      return now.explicitNo && !now.created ? [renderCopy(output.hookNothing, { file })] : [];
    case "undecided": {
      if (!now.created) return [];
      const suffix = project === undefined ? "" : ` --project ${shellWord(project)}`;
      return [renderCopy(output.hookUndecided, { command: `ploop init --hook 是${suffix}` })];
    }
    default:
      return [];
  }
}

/** 设置文件合不进去：不影响开工，作为警告提醒。 */
function hookWarning(root: string, reason: UnusableReason | "notJson"): Issue {
  const { errors, hookReasons } = initCopy;
  return {
    message: renderCopy(errors.hookUnusable.message, { reason: renderCopy(hookReasons[reason]) }),
    hint: renderCopy(errors.hookUnusable.hint),
    where: shownFrom(root)(settingsFile(root)),
  };
}

/**
 * 主线.md 不在、集中存储里也还没有主线时，写进主线模板，并当场交成第 1 版，见「04 命令行」第九节。
 * 当场交上去，下一条命令开始时就不用再同步。集中存储里已有主线时不写，由同步取回。
 * 返回写好的文件。没写时返回 undefined。
 */
async function writeMainlineTemplate(
  backend: Backend,
  root: string,
  identity: ProjectIdentity,
): Promise<Result<string | undefined, ErrorBody>> {
  const file = join(projectCacheDir(root), mainlineFileName);
  if (existsSync(file)) return ok(undefined);
  const remote = backendRemote(backend, identity.projectId);
  const latest = await remote.latest();
  if (!latest.ok) return latest;
  if (latest.value !== null) return ok(undefined);
  await writeFile(file, mainlineTemplate());
  const synced = await syncMainline({ root, identity, remote, mode: "auto" });
  if (!synced.ok) return synced;
  return ok(file);
}

type Saved = { readonly project: ProjectView; readonly version: number | undefined };

/** 没登记过就登记。登记过的，仓库类别或规则的位置变了才改。 */
async function save(
  backend: Backend,
  before: ProjectView | undefined,
  input: { readonly root: string; readonly repoKind: RepoLabel; readonly ignoreFile: string },
): Promise<Result<Saved, ErrorBody>> {
  if (before === undefined) {
    const created = await backend.call((api) => api.api.v1.projects.$post({ json: input }));
    if (!created.ok) return created;
    return ok({ project: created.value.data.project, version: created.value.data.version });
  }
  const patch = {
    ...(before.repoKind === input.repoKind ? {} : { repoKind: input.repoKind }),
    ...(before.ignoreFile === input.ignoreFile ? {} : { ignoreFile: input.ignoreFile }),
  };
  if (Object.keys(patch).length === 0) return ok({ project: before, version: undefined });
  const pid = before.id;
  const updated = await backend.call((api) =>
    api.api.v1.projects[":pid"].$patch({ param: { pid }, json: patch }),
  );
  if (!updated.ok) return updated;
  return ok({ project: updated.value.data, version: undefined });
}

/** --hook 的选项：取值写是、否，也认 yes、no。帮助里只列是、否。 */
function hookOption(description: string) {
  return new Option("--hook <是|否>", description)
    .choices(hookLabels)
    .argParser((value: string) => {
      const key = hookByLabel.get(value);
      if (key === undefined) {
        // 文字照 commander 限定取值时的写法，usage-error.ts 按它换成中文。
        throw new InvalidArgumentError(`Allowed choices are ${hookLabels.join(", ")}.`);
      }
      return key;
    });
}

/** 挂上 ploop init。 */
export function initCommand(program: CommandUnknownOpts, context: ProgramContext): void {
  const { help } = initCopy;
  const command = program
    .command("init")
    .description(renderCopy(help.description))
    .addOption(new Option("--repo <仓库>", renderCopy(help.repo)).choices(repoKind.labels))
    .addOption(hookOption(renderCopy(help.hook)))
    .action(async (options, self) => {
      // --json 时标准输出只有一个 JSON 对象，不在中途提问。
      const json = self.optsWithGlobals().json === true;
      const ask = json ? undefined : context.ask;
      context.settle(
        await runInit(context, {
          repo: options.repo,
          project: globalProject(self),
          hook: options.hook,
          ask,
        }),
      );
    });
  withHelp(command, {
    details: Object.values(help.details).map((entry) => renderCopy(entry)),
    blocks: Object.values(help.blocks).map(({ situation, fix }) => [
      renderCopy(situation),
      renderCopy(fix),
    ]),
    reads: renderCopy(help.reads),
    writes: renderCopy(help.writes),
    examples: Object.values(help.examples).map((example) => renderCopy(example)),
    after: [renderCopy(help.after)],
  });
}
