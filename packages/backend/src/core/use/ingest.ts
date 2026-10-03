import { existsSync } from "node:fs";
import {
  assignCardIds,
  type ErrorBody,
  err,
  errorBody,
  formatRoundLabel,
  formatSceneId,
  type Issue,
  ok,
  parseSceneId,
  type Result,
  renderCopy,
  type UseRunOutput,
  type UseStepResult,
} from "@product-loop/model";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { useRunsCopy } from "../../copy/use.ts";
import { type BlobHash, blobPath, parseBlobHash } from "../../store/blobs.ts";
import {
  blobRefs,
  blobs,
  rounds,
  scenes,
  screens,
  useRuns,
  useSteps,
} from "../../store/schema/index.ts";
import type { JsonObject } from "../../store/schema/json.ts";
import {
  hashImage,
  maxScreenPixels,
  readShot,
  type ScreenHash,
  type ScreenHashError,
  screenChanged,
} from "../../store/screen-hash.ts";
import { appendEvent } from "../events.ts";
import { mainlineStatus } from "../mainline.ts";
import { insertPage } from "../pages/present.ts";
import { fail, type Reader, requireWritable } from "../projects.ts";
import { roundNext } from "../rounds/next.ts";
import { useLeaveIssues } from "../rounds/use-leave.ts";
import { type WriteContext, type WriteScope, writeTx } from "../tx.ts";
import { toRunSummary, type UnreachedSteps, type UseRunSummary, unreachedSteps } from "./runs.ts";

// 收进使用代码的一次运行：ploop use run 和 ploop use ingest，接口是 POST /projects/:pid/use-runs。
// 字段见「03 数据模型」第二节「使用记录和屏」，接口见「05 接口」第四节和第七节。
// 先准备、后提交，见「01 架构」第七节：命令行先把截图逐张上传到附件库，再交这一次运行。
// 交来的是 use-run.json 按共用定义解析的结果，外加每张截图的路径和哈希。
// 屏的规则：
// - 一屏以场景、步号和宽度确定。只有结果是通过的步骤，它的截图才更新屏。
//   断了和环境出错的截图照样记在这一步上，但不代表这一屏正常的样子。
// - 这一版的截图都和「上一版的截图」比，也就是这一版以前最后一次截到的那张。
//   变没变的判断见 store/screen-hash.ts 的 screenChanged。
// - 这一版里记为变过，就一直算变过，后来的运行不撤销。按「12 风险」R8，宁可多列几屏。

/** 收使用记录自己的规矩编号。说明登记在 model 的 rules/backend.ts 的 useRuleInfo。 */
export const useRules = {
  /** 拦截：使用记录引用的截图都已上传，和给出信息的 blob.present 同理。 */
  shotsPresent: "use.shots.present",
  /** 警告：场景编号和步号在最新的主线里。 */
  sceneKnown: "use.scene.known",
} as const;

/** 收一次运行的请求，对应接口 POST /projects/:pid/use-runs 的请求体，枚举已换成英文键。 */
export type UseRunInput = {
  /** use-run.json 按共用定义 useRunOutputSchema 解析以后的内容。 */
  readonly output: UseRunOutput;
  /** 每张截图的路径和哈希。路径和 use-run.json 里写的相同，截图已经上传到附件库。 */
  readonly screenshots: readonly { readonly path: string; readonly hash: string }[];
  /** ploop use run 运行的程序和参数。ploop use ingest 不写。 */
  readonly command?: readonly string[] | undefined;
  readonly exitCode?: number | undefined;
  /** 运行时的 HEAD，完整的提交号。 */
  readonly commit?: string | undefined;
  /** 覆盖表的快照：命令行读到的覆盖表全文。 */
  readonly coverage?: string | undefined;
  /** ploop use run 量到的时间，带时区的 ISO 8601。写了就代替 use-run.json 里写的。 */
  readonly startedAt?: string | undefined;
  readonly finishedAt?: string | undefined;
};

/** 一屏：场景编号写成 S14，步号和宽度。 */
type ScreenKey = { readonly scene: string; readonly step: number; readonly width: number };

export type IngestedUseRun = {
  readonly run: UseRunSummary;
  /** 这次第一次截到的屏。 */
  readonly newScreens: readonly ScreenKey[];
  /** 这次记为变过的屏。这一版里早先已经记为变过的不再列。 */
  readonly changedScreens: readonly ScreenKey[];
  /** 使用阶段的运行：主线里有、这次没走到的步，每个场景一项。别的阶段的运行不对照，为空。 */
  readonly unreached: readonly { readonly scene: string; readonly steps: readonly number[] }[];
  /** 这次运行没有断点也没有缺口，使用阶段自动给出的一页，写它是这一轮的第几页。没给出时为空。 */
  readonly page: number | null;
  /** 场景编号或步号不在最新的主线里。 */
  readonly warnings: readonly Issue[];
  /** 下一步：一到两条完整的命令。 */
  readonly next: readonly string[];
};

type Failure = ErrorBody<
  "BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR" | "RULE_BLOCKED"
>;

/** 整理好的一步。 */
type CleanStep = {
  readonly scene: number;
  readonly step: number;
  readonly width: number | null;
  readonly do: string;
  readonly expect: string;
  readonly result: UseStepResult;
  readonly facts: JsonObject | null;
  readonly error: string | null;
  readonly shot: { readonly path: string; readonly hash: BlobHash } | null;
  /** 在 use-run.json 里的位置，写成 scenes[0].steps[1]。 */
  readonly where: string;
};

/**
 * 收进一次运行。请求本身的问题先一次报齐，返回 BAD_REQUEST。
 * 其余的在一个写事务里依次做，任何一步不通过就整个撤回，什么都不写：
 * 1. 项目要能改数据，要先体检的返回 NEEDS_DOCTOR。
 * 2. 要有开着的一轮，运行挂在这一轮上。没有就返回 CONFLICT。
 * 3. 截图都已上传，缺的一次报齐，返回 RULE_BLOCKED。
 *    不是 PNG、读不出来、太大的，一次报齐，返回 BAD_REQUEST。
 * 4. 记下这次运行和每一步，每张截图记一条附件引用。
 * 5. 按通过的步骤的截图更新屏，记下这一版新出现和变过的屏。
 * 6. 记一条 useRun.ingested 事件。场景编号和步号不在最新的主线里的，随结果返回警告。
 * blobsDir 是附件库的目录。读截图算感知哈希也在事务里做，重发的请求直接拿到第一次的结果。
 */
export function ingestUseRun(
  ctx: WriteContext,
  blobsDir: string,
  projectId: string,
  input: UseRunInput,
): Result<IngestedUseRun, Failure> {
  const cleaned = cleanRequest(input);
  if (!cleaned.ok) return cleaned;
  const steps = cleaned.value;
  return writeTx<IngestedUseRun, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const round = w.tx
      .select()
      .from(rounds)
      .where(and(eq(rounds.projectId, projectId), ne(rounds.status, "closed")))
      .get();
    if (round === undefined) {
      const text = useRunsCopy.noRound;
      return fail("CONFLICT", {
        message: renderCopy(text.message, { project: projectId }),
        hint: renderCopy(text.hint),
      });
    }
    const shots = checkShots(w.tx, blobsDir, steps);
    if (!shots.ok) return shots;

    const run = w.tx
      .insert(useRuns)
      .values({
        projectId,
        roundId: round.id,
        command: input.command === undefined ? null : [...input.command],
        startedAt: time(input.startedAt ?? input.output.startedAt),
        finishedAt: time(input.finishedAt ?? input.output.finishedAt),
        exitCode: input.exitCode ?? null,
        commit: input.commit ?? null,
        coverage: input.coverage ?? null,
        environment: input.output.environment ?? null,
        createdAt: w.now,
      })
      .returning()
      .get();
    const newScreens: ScreenKey[] = [];
    const changedScreens: ScreenKey[] = [];
    for (const step of steps) {
      const { shot, where: _where, ...fields } = step;
      const stored = w.tx
        .insert(useSteps)
        .values({ runId: run.id, ...fields, shot: shot?.hash ?? null })
        .returning({ id: useSteps.id })
        .get();
      if (shot === null) continue;
      refer(w, shot.hash, "useStep", stored.id, "shot");
      const hash = shots.value.get(shot.hash);
      if (step.result !== "pass" || step.width === null || hash === undefined) continue;
      const key = { scene: step.scene, step: step.step, width: step.width };
      const status = updateScreen(w, blobsDir, projectId, round.version, key, shot.hash, hash);
      const view = { ...key, scene: formatSceneId(key.scene) };
      if (status === "new") newScreens.push(view);
      if (status === "changed") changedScreens.push(view);
    }

    const label = formatRoundLabel(round);
    const summary = toRunSummary(
      run,
      label,
      steps.map((step) => step.result),
    );
    appendEvent(w, {
      projectId,
      kind: "useRun.ingested",
      objectType: "useRun",
      objectId: String(run.id),
      detail: {
        round: label,
        results: summary.results,
        newScreens,
        changedScreens,
      },
    });
    const unreached: UnreachedSteps[] =
      round.stage === "use"
        ? unreachedSteps(
            w.tx,
            projectId,
            steps.map((step) => ({ scene: step.scene, step: step.step })),
          )
        : [];
    const page = autoUsePage(w, round);
    return ok({
      run: summary,
      newScreens,
      changedScreens,
      unreached: unreached.map((gap) => ({ scene: formatSceneId(gap.scene), steps: gap.steps })),
      page,
      warnings: sceneWarnings(w.tx, projectId, input.output),
      next: roundNext(w.tx, projectId, round, mainlineStatus(w.tx, projectId)),
    });
  });
}

/**
 * 使用阶段的运行没有断点、主线的每一步都走到、覆盖表没有缺口时，自动给用户看一页只看的页：
 * 页面由后端从这次运行填，没有卡片，不等回复（决定 204）。这个阶段的收尾在下一次开始阶段时自动做，
 * 不再要 AI 手敲 page present 和 round close，见改进 D02。返回这一页是这一轮的第几页，没给出时返回 null。
 */
function autoUsePage(w: WriteScope, round: typeof rounds.$inferSelect): number | null {
  if (round.stage !== "use" || useLeaveIssues(w.tx, round).length > 0) return null;
  const row = insertPage(w, {
    projectId: round.projectId,
    round,
    roundStatus: round.status,
    purpose: "view",
    status: "presented",
    sections: assignCardIds({}),
    images: new Map(),
    presentedAt: w.now,
  });
  appendEvent(w, {
    projectId: round.projectId,
    kind: "page.presented",
    objectType: "page",
    objectId: String(row.id),
    detail: {
      round: formatRoundLabel(round),
      page: row.id,
      seq: row.seq,
      purpose: "view",
      roundStatus: round.status,
      auto: true,
    },
  });
  return row.seq;
}

// ── 请求本身的问题 ──

/** 把每一步摊平，截图的路径换成哈希。请求本身的问题一次报齐。 */
function cleanRequest(input: UseRunInput): Result<CleanStep[], ErrorBody<"BAD_REQUEST">> {
  const issues: Issue[] = [];
  const text = useRunsCopy.shot;
  const hashes = new Map<string, BlobHash | undefined>();
  for (const { path, hash } of input.screenshots) {
    const parsed = parseBlobHash(hash);
    const where = `screenshots[${path}]`;
    if (!parsed.ok) {
      issues.push({
        message: renderCopy(text.badHash.message, { path, hash }),
        hint: renderCopy(text.badHash.hint),
        where,
      });
      hashes.set(path, undefined);
    } else if (hashes.has(path) && hashes.get(path) !== parsed.value) {
      issues.push({
        message: renderCopy(text.twoHashes.message, { path }),
        hint: renderCopy(text.twoHashes.hint),
        where,
      });
    } else {
      hashes.set(path, parsed.value);
    }
  }
  const steps: CleanStep[] = [];
  for (const [i, scene] of input.output.scenes.entries()) {
    const number = parseSceneId(scene.scene);
    // 共用定义已经按场景编号的写法查过。
    if (!number.ok) throw new Error(`场景编号写错了：${scene.scene}`);
    for (const [j, step] of scene.steps.entries()) {
      const where = `scenes[${i}].steps[${j}]`;
      const path = step.screenshot;
      const hash = path === undefined ? undefined : hashes.get(path);
      if (path !== undefined && !hashes.has(path)) {
        issues.push({
          message: renderCopy(text.unmapped.message, { path }),
          hint: renderCopy(text.unmapped.hint),
          where: `${where}.screenshot`,
        });
      }
      steps.push({
        scene: number.value,
        step: step.step,
        width: step.width ?? null,
        do: step.do,
        expect: step.expect,
        result: step.result,
        facts: (step.facts as JsonObject | undefined) ?? null,
        error: step.error ?? null,
        shot: path === undefined || hash === undefined ? null : { path, hash },
        where,
      });
    }
  }
  const [first, ...rest] = issues;
  return first === undefined ? ok(steps) : err(errorBody("BAD_REQUEST", [first, ...rest]));
}

/** 时间写成 Date。共用定义和接口层已经查过写法。 */
function time(text: string | undefined): Date | null {
  if (text === undefined) return null;
  const at = new Date(text);
  if (Number.isNaN(at.getTime())) throw new Error(`时间写错了：${text}`);
  return at;
}

// ── 截图 ──

/**
 * 截图都要已经上传：附件表里有记录，文件也在。缺的一次报齐，返回 RULE_BLOCKED。
 * 通过的步骤的截图要读出来算感知哈希，别的步骤的截图只看类型是不是 PNG。
 * 读不出来的一次报齐，返回 BAD_REQUEST。返回每张通过的截图的感知哈希。
 */
function checkShots(
  tx: Reader,
  blobsDir: string,
  steps: readonly CleanStep[],
): Result<Map<BlobHash, ScreenHash>, ErrorBody<"BAD_REQUEST" | "RULE_BLOCKED">> {
  const wanted = [
    ...new Set(steps.flatMap((step) => (step.shot === null ? [] : [step.shot.hash]))),
  ];
  const types = new Map(
    wanted.length === 0
      ? []
      : tx
          .select({ hash: blobs.hash, contentType: blobs.contentType })
          .from(blobs)
          .where(inArray(blobs.hash, wanted))
          .all()
          .map((row) => [row.hash, row.contentType]),
  );
  const present = (hash: BlobHash) => types.has(hash) && existsSync(blobPath(blobsDir, hash));
  const missing: Issue[] = [];
  for (const { shot, where } of steps) {
    if (shot === null || present(shot.hash)) continue;
    const text = useRunsCopy.shot.missing;
    missing.push({
      rule: useRules.shotsPresent,
      message: renderCopy(text.message, { path: shot.path, hash: shot.hash }),
      hint: renderCopy(text.hint),
      where: `${where}.screenshot`,
    });
  }
  const [firstMissing, ...moreMissing] = missing;
  if (firstMissing !== undefined) {
    return err(errorBody("RULE_BLOCKED", [firstMissing, ...moreMissing]));
  }

  const hashes = new Map<BlobHash, ScreenHash>();
  const failed = new Map<BlobHash, ScreenHashError["kind"]>();
  for (const { shot, result } of steps) {
    if (shot === null || hashes.has(shot.hash) || failed.has(shot.hash)) continue;
    if (result !== "pass") {
      if (types.get(shot.hash) !== "image/png") failed.set(shot.hash, "notPng");
      continue;
    }
    const image = readShot(blobsDir, shot.hash);
    if (image?.ok === true) hashes.set(shot.hash, hashImage(image.value));
    else failed.set(shot.hash, image?.error.kind ?? "corrupt");
  }
  const issues = steps.flatMap(({ shot, where }): Issue[] => {
    const kind = shot === null ? undefined : failed.get(shot.hash);
    if (shot === null || kind === undefined) return [];
    const text = useRunsCopy.shot[kind];
    const params = { path: shot.path, limit: maxScreenPixels };
    return [
      {
        message: renderCopy(text.message, params),
        hint: renderCopy(text.hint),
        where: `${where}.screenshot`,
      },
    ];
  });
  const [first, ...rest] = issues;
  return first === undefined ? ok(hashes) : err(errorBody("BAD_REQUEST", [first, ...rest]));
}

/** 记一条附件引用，已有的不重复记。 */
function refer(
  w: WriteScope,
  hash: BlobHash,
  kind: "useStep" | "screen",
  id: number,
  purpose: string,
): void {
  w.tx
    .insert(blobRefs)
    .values({ blobHash: hash, referrerKind: kind, referrerId: String(id), purpose })
    .onConflictDoNothing()
    .run();
}

// ── 屏 ──

type ScreenStatus = "new" | "changed" | "same";

/**
 * 用一张通过的截图更新一屏，返回这一屏这次是新出现、记为变过，还是别的情况。
 * 最近一次的截图是更早的版本截的，它就成了这一版的「上一版的截图」。
 * 这一版里已经记为变过的，不再比较。
 */
function updateScreen(
  w: WriteScope,
  blobsDir: string,
  projectId: string,
  version: number,
  key: { readonly scene: number; readonly step: number; readonly width: number },
  shot: BlobHash,
  hash: ScreenHash,
): ScreenStatus {
  const row = w.tx
    .select()
    .from(screens)
    .where(
      and(
        eq(screens.projectId, projectId),
        eq(screens.scene, key.scene),
        eq(screens.step, key.step),
        eq(screens.width, key.width),
      ),
    )
    .get();
  if (row === undefined) {
    const inserted = w.tx
      .insert(screens)
      .values({
        projectId,
        ...key,
        firstVersion: version,
        shot,
        phash: hash.hash,
        shotVersion: version,
      })
      .returning({ id: screens.id })
      .get();
    refer(w, shot, "screen", inserted.id, "shot");
    return "new";
  }
  const base =
    row.shotVersion < version
      ? { shot: row.shot, phash: row.phash }
      : row.baseShot === null || row.basePhash === null
        ? null
        : { shot: row.baseShot, phash: row.basePhash };
  const changed =
    base !== null &&
    row.changedVersion !== version &&
    base.shot !== shot &&
    differs(w.tx, blobsDir, base, shot, hash);
  w.tx
    .update(screens)
    .set({
      shot,
      phash: hash.hash,
      shotVersion: version,
      baseShot: base?.shot ?? null,
      basePhash: base?.phash ?? null,
      changedVersion: changed ? version : row.changedVersion,
    })
    .where(eq(screens.id, row.id))
    .run();
  w.tx
    .delete(blobRefs)
    .where(and(eq(blobRefs.referrerKind, "screen"), eq(blobRefs.referrerId, String(row.id))))
    .run();
  refer(w, shot, "screen", row.id, "shot");
  if (base !== null) refer(w, base.shot, "screen", row.id, "base");
  return changed ? "changed" : "same";
}

/** 这一张截图和上一版的截图比，算不算变过。上一张的尺寸取自附件表，像素要复核时才读。 */
function differs(
  tx: Reader,
  blobsDir: string,
  base: { readonly shot: BlobHash; readonly phash: string },
  shot: BlobHash,
  hash: ScreenHash,
): boolean {
  const size = tx
    .select({ width: blobs.width, height: blobs.height })
    .from(blobs)
    .where(eq(blobs.hash, base.shot))
    .get();
  const before = { hash: base.phash, width: size?.width ?? 0, height: size?.height ?? 0 };
  return screenChanged(before, hash, () => {
    const a = readShot(blobsDir, base.shot);
    const b = readShot(blobsDir, shot);
    return a?.ok === true && b?.ok === true ? [a.value, b.value] : undefined;
  });
}

// ── 警告 ──

/** 场景编号不在最新的主线里，或者主线里这个场景没有这一步，逐个警告。同一步的几个宽度只报一次。 */
function sceneWarnings(tx: Reader, projectId: string, output: UseRunOutput): Issue[] {
  const known = new Map(
    tx
      .select({ number: scenes.number, steps: scenes.steps })
      .from(scenes)
      .where(and(eq(scenes.projectId, projectId), isNull(scenes.removedInRevision)))
      .all()
      .map((row) => [row.number, new Set(row.steps.map((step) => step.step))]),
  );
  const rule = useRules.sceneKnown;
  const text = useRunsCopy.scene;
  const issues: Issue[] = [];
  for (const [i, { scene, steps }] of output.scenes.entries()) {
    const number = parseSceneId(scene);
    const numbers = number.ok ? known.get(number.value) : undefined;
    if (numbers === undefined) {
      issues.push({
        rule,
        message: renderCopy(text.unknown.message, { scene }),
        hint: renderCopy(text.unknown.hint),
        where: `scenes[${i}].scene`,
      });
      continue;
    }
    const reported = new Set<number>();
    for (const [j, { step }] of steps.entries()) {
      if (numbers.has(step) || reported.has(step)) continue;
      reported.add(step);
      issues.push({
        rule,
        message: renderCopy(text.unknownStep.message, { scene, step }),
        hint: renderCopy(text.unknownStep.hint),
        where: `scenes[${i}].steps[${j}].step`,
      });
    }
  }
  return issues;
}
