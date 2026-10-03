import { createHash } from "node:crypto";
import {
  assignSceneIds,
  type DesignSpecItem,
  designSpecItem,
  type Err,
  type ErrorBody,
  err,
  errorBody,
  formatRoundLabel,
  formatRoundName,
  formatSceneId,
  type Issue,
  type MainlineParse,
  type MainlinePart,
  type MainlineSource,
  mainlinePart,
  missingOfParse,
  ok,
  type ProjectWritingSpec,
  parseMainline,
  type Result,
  type RoundLabel,
  renderCopy,
  type TextDiffRow,
  textDiff,
} from "@product-loop/model";
import { and, asc, desc, eq, inArray, isNull, ne, notInArray } from "drizzle-orm";
import { mainlineRevisionsCopy } from "../copy/mainline.ts";
import { mainlineRevisions, rounds, type SceneStep, scenes } from "../store/schema/index.ts";
import { appendEvent } from "./events.ts";
import { fail, findProject, iso, type Reader, requireWritable } from "./projects.ts";
import { type WriteContext, type WriteScope, writeTx } from "./tx.ts";

// 主线的用例：交一个新版本、取最新的一版、历次版本、取某一版、比较两版、列出场景，
// 以及主线缺哪几样和写作规范一节。字段见「03 数据模型」第二节，接口见「05 接口」第四节。
// AI 在项目缓存的主线.md 里编辑，命令把全文连同基准版本号交上来，见「03 数据模型」第五节。
// 基准不是最新的一版就返回冲突，两个会话的修改不会互相覆盖，见「01 架构」第七节。
// 收进新版本时给没写编号的场景补上编号，此后不变，删掉的编号不再用，见「09 skill 与软件」第三节。
// 每收进一版记一条 mainline.revised 事件，事件流把它归到 mainline.changed，见约定 0002 第 9 条。

type RevisionRow = typeof mainlineRevisions.$inferSelect;
type RoundRow = typeof rounds.$inferSelect;

/** 事件里的对象种类，用术语对照表里的英文名。 */
const objectType = "mainlineRevision";

/** 历次版本里的一版，不带全文和解析结果。 */
export type MainlineRevisionSummary = {
  readonly revision: number;
  /** 全文的 SHA-256。命令把版本号和它记进 project.json 的 mainlineBase。 */
  readonly hash: string;
  readonly source: MainlineSource;
  /** 在哪一轮改的，写成 v2-构思-1。两轮之间交上来的为空。 */
  readonly round: string | null;
  readonly createdAt: string;
};

/** 一版主线的全文和解析结果。 */
export type MainlineRevision = MainlineRevisionSummary & {
  /** 全文，补好了场景编号。 */
  readonly text: string;
  readonly parsed: MainlineParse;
};

/** 全文按 UTF-8 编码的 SHA-256，六十四位小写十六进制，和命令对主线.md 算的相同。 */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function toSummary(
  row: Pick<RevisionRow, "revision" | "hash" | "source" | "roundId" | "createdAt">,
  labels: ReadonlyMap<number, string>,
): MainlineRevisionSummary {
  return {
    revision: row.revision,
    hash: row.hash,
    source: row.source,
    round: row.roundId === null ? null : (labels.get(row.roundId) ?? null),
    createdAt: iso(row.createdAt),
  };
}

function toRevision(tx: Reader, row: RevisionRow): MainlineRevision {
  const labels = roundLabels(tx, [row.roundId]);
  return { ...toSummary(row, labels), text: row.text, parsed: row.parsed };
}

/** 轮次表的编号换成轮次的写法，例如 v2-构思-1。 */
function roundLabels(tx: Reader, ids: readonly (number | null)[]): ReadonlyMap<number, string> {
  const wanted = [...new Set(ids.filter((id) => id !== null))];
  if (wanted.length === 0) return new Map();
  const rows = tx.select().from(rounds).where(inArray(rounds.id, wanted)).all();
  return new Map(rows.map((row) => [row.id, formatRoundLabel(row)]));
}

/** 项目最新的一版。还没交过主线时为 undefined。 */
function latestRow(tx: Reader, projectId: string): RevisionRow | undefined {
  return tx
    .select()
    .from(mainlineRevisions)
    .where(eq(mainlineRevisions.projectId, projectId))
    .orderBy(desc(mainlineRevisions.revision))
    .limit(1)
    .get();
}

/** 最新的一版的版本号和解析结果。状态和写作校验只要这两样，不取全文。 */
function latestParsed(
  db: Reader,
  projectId: string,
): { readonly revision: number; readonly parsed: MainlineParse } | undefined {
  return db
    .select({ revision: mainlineRevisions.revision, parsed: mainlineRevisions.parsed })
    .from(mainlineRevisions)
    .where(eq(mainlineRevisions.projectId, projectId))
    .orderBy(desc(mainlineRevisions.revision))
    .limit(1)
    .get();
}

function notFoundIssue(projectId: string, revision: number): Issue {
  const text = mainlineRevisionsCopy.notFound;
  return {
    message: renderCopy(text.message, { project: projectId, revision }),
    hint: renderCopy(text.hint),
    where: String(revision),
  };
}

// ── 交一个新版本 ──

export type PushRevisionInput = {
  /** 主线的全文，命令从项目缓存的主线.md 读出。 */
  readonly text: string;
  /** 基准版本号，也就是 project.json 的 mainlineBase 记的那一版。还没交过主线时为空。 */
  readonly baseRevision: number | null;
  readonly source: MainlineSource;
  /** 在哪一轮改的。不写就记在项目现在开着的一轮上，没有开着的就不记。 */
  readonly round?: RoundLabel | undefined;
};

/** 补上的一个场景编号。line 是场景标题所在的行，补编号前后相同。 */
type AssignedScene = {
  /** 场景编号，写成 S15。 */
  readonly id: string;
  readonly name: string;
  readonly line: number;
};

export type PushedRevision = {
  /** 交上来以后最新的一版。全文和最新的一版相同时，就是原来的那一版。 */
  readonly revision: MainlineRevision;
  /** 建了新的一版。全文和最新的一版相同时为 false，什么都没写。 */
  readonly created: boolean;
  /** 这次补上的场景编号，按场景在主线里的先后。有补上的，命令把全文写回主线.md。 */
  readonly assignedScenes: readonly AssignedScene[];
  /** 上一版里有、这一版里没有的场景编号，写成 S3，按编号排。 */
  readonly removedScenes: readonly string[];
};

/**
 * 交一个新版本：`ploop mainline push`，以及每条命令开始时的自动同步。
 * 接口是 POST /projects/:pid/mainline/revisions，见「03 数据模型」第五节的同步规则。
 * 在一个写事务里依次做下面几件事：
 * 1. 项目要能改数据。
 * 2. 全文和最新的一版相同时，什么都不写，返回最新的一版。不看基准，命令据此把基准改成最新的一版。
 * 3. 基准不是最新的一版时返回 CONFLICT，写明最新的是第几版。
 * 4. 给没写编号的场景补上编号，从项目用过的最大编号往后数，所以删掉的编号不会再用。
 * 5. 解析补好编号的全文，连同解析结果存成新的一版，再按这一版改场景表，记一条事件。
 * 返回的全文补好了编号，命令把它写回主线.md。
 */
export function pushRevision(
  ctx: WriteContext,
  projectId: string,
  input: PushRevisionInput,
): Result<PushedRevision, ErrorBody<"BAD_REQUEST" | "CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">> {
  const invalid = inputIssues(input);
  if (invalid !== undefined) return invalid;
  type Failure = ErrorBody<"CONFLICT" | "NOT_FOUND" | "NEEDS_DOCTOR">;
  return writeTx<PushedRevision, Failure>(ctx, (w) => {
    const project = requireWritable(w.tx, projectId);
    if (!project.ok) return project;
    const latest = latestRow(w.tx, projectId);
    if (latest !== undefined && latest.hash === sha256(input.text)) {
      const revision = toRevision(w.tx, latest);
      return ok({ revision, created: false, assignedScenes: [], removedScenes: [] });
    }
    const conflict = baseConflict(input.baseRevision, latest?.revision);
    if (conflict !== undefined) return conflict;
    const round = findRound(w.tx, projectId, input.round);
    if (!round.ok) return round;
    return ok(storeRevision(w, projectId, input, latest, round.value));
  });
}

/**
 * 迁移时在调用者的写事务里存一版主线，来源记为迁移，见「08 版本与迁移」第四节的主线一项。
 * 全文和最新的一版相同时不存。迁移完成以前项目还不能写，所以不查 requireWritable。
 */
export function importMainlineRevision(
  w: WriteScope,
  projectId: string,
  text: string,
): MainlineRevision {
  const latest = latestRow(w.tx, projectId);
  if (latest !== undefined && latest.hash === sha256(text)) return toRevision(w.tx, latest);
  const input = { text, baseRevision: latest?.revision ?? null, source: "migration" as const };
  return storeRevision(w, projectId, input, latest, null).revision;
}

/** 交来的全文和基准版本号本身的问题，一次报齐。没有问题时返回 undefined。 */
function inputIssues(input: PushRevisionInput): Err<ErrorBody<"BAD_REQUEST">> | undefined {
  const issues: Issue[] = [];
  if (input.text.trim() === "") {
    const text = mainlineRevisionsCopy.empty;
    issues.push({ message: renderCopy(text.message), hint: renderCopy(text.hint), where: "text" });
  }
  const base = input.baseRevision;
  if (base !== null && !(Number.isSafeInteger(base) && base >= 1)) {
    const text = mainlineRevisionsCopy.baseInvalid;
    issues.push({
      message: renderCopy(text.message, { base }),
      hint: renderCopy(text.hint),
      where: "baseRevision",
    });
  }
  const [first, ...rest] = issues;
  return first === undefined ? undefined : err(errorBody("BAD_REQUEST", [first, ...rest]));
}

/** 基准不是最新的一版时的冲突，写明最新的是第几版。基准就是最新的一版时返回 undefined。 */
function baseConflict(
  base: number | null,
  latest: number | undefined,
): Err<ErrorBody<"CONFLICT">> | undefined {
  if (base === (latest ?? null)) return undefined;
  const text = mainlineRevisionsCopy;
  const where = "baseRevision";
  if (latest === undefined) {
    return fail("CONFLICT", {
      message: renderCopy(text.noMainline.message, { base: base ?? 0 }),
      hint: renderCopy(text.noMainline.hint),
      where,
    });
  }
  const message =
    base === null
      ? renderCopy(text.conflict.noBase, { latest })
      : renderCopy(text.conflict.stale, { base, latest });
  return fail("CONFLICT", { message, hint: renderCopy(text.conflict.hint, { latest }), where });
}

/** 这一版记在哪一轮：写了就按写的找，没写就取项目现在开着的一轮，没有开着的为空。 */
function findRound(
  tx: Reader,
  projectId: string,
  label: RoundLabel | undefined,
): Result<RoundRow | null, ErrorBody<"NOT_FOUND">> {
  const ofProject = eq(rounds.projectId, projectId);
  if (label === undefined) {
    return ok(
      tx
        .select()
        .from(rounds)
        .where(and(ofProject, ne(rounds.status, "closed")))
        .get() ?? null,
    );
  }
  const { version, stage, seq } = label;
  const row = tx
    .select()
    .from(rounds)
    .where(
      and(ofProject, eq(rounds.version, version), eq(rounds.stage, stage), eq(rounds.seq, seq)),
    )
    .get();
  if (row !== undefined) return ok(row);
  const text = mainlineRevisionsCopy.roundNotFound;
  const round = formatRoundName(label);
  return fail("NOT_FOUND", {
    message: renderCopy(text.message, { project: projectId, round }),
    hint: renderCopy(text.hint),
    where: "round",
  });
}

/** 补编号、解析、存成新的一版，再改场景表、记事件。前提都已在同一个事务里查过。 */
function storeRevision(
  w: WriteScope,
  projectId: string,
  input: PushRevisionInput,
  latest: RevisionRow | undefined,
  round: RoundRow | null,
): PushedRevision {
  const known = latest?.maxSceneId ?? 0;
  const { text, assigned } = assignSceneIds(input.text, known);
  const parsed = parseMainline(text);
  const ids = parsed.scenes.flatMap((scene) => (scene.id === undefined ? [] : [scene.id]));
  const row = w.tx
    .insert(mainlineRevisions)
    .values({
      projectId,
      revision: (latest?.revision ?? 0) + 1,
      text,
      hash: sha256(text),
      createdAt: w.now,
      source: input.source,
      roundId: round?.id ?? null,
      parsed,
      maxSceneId: Math.max(known, ...ids),
    })
    .returning()
    .get();
  const removed = recordScenes(w, projectId, row.revision, parsed).map(formatSceneId);
  const assignedScenes = assigned.map(({ id, name, line }) => ({
    id: formatSceneId(id),
    name,
    line,
  }));
  const revision = toRevision(w.tx, row);
  appendEvent(w, {
    projectId,
    kind: "mainline.revised",
    objectType,
    objectId: String(row.revision),
    detail: {
      source: row.source,
      round: revision.round ?? undefined,
      hash: row.hash,
      assignedScenes: assignedScenes.map((scene) => scene.id),
      removedScenes: removed,
    },
  });
  return { revision, created: true, assignedScenes, removedScenes: removed };
}

/**
 * 按新的一版改场景表。新的编号加一行，已有的换成这一版的名字、谁在什么时候用和步骤。
 * 删掉以后又写回来的，清掉不见的版本。同一个编号写了几次的，按第一次出现的记，解析时另报问题。
 * 还在场景表里、这一版却没有的，记下从这一版起不在。返回这些场景的编号，从小到大排。
 */
function recordScenes(
  w: WriteScope,
  projectId: string,
  revision: number,
  parsed: MainlineParse,
): number[] {
  const seen = new Set<number>();
  for (const scene of parsed.scenes) {
    if (scene.id === undefined || seen.has(scene.id)) continue;
    seen.add(scene.id);
    const fields = {
      name: scene.name,
      who: scene.who ?? null,
      steps: scene.steps.map(
        (step): SceneStep => ({
          step: step.step,
          do: step.do,
          expect: step.expect,
        }),
      ),
      latestRevision: revision,
      removedInRevision: null,
    };
    w.tx
      .insert(scenes)
      .values({ projectId, number: scene.id, firstRevision: revision, ...fields })
      .onConflictDoUpdate({ target: [scenes.projectId, scenes.number], set: fields })
      .run();
  }
  return w.tx
    .update(scenes)
    .set({ removedInRevision: revision })
    .where(
      and(
        eq(scenes.projectId, projectId),
        isNull(scenes.removedInRevision),
        notInArray(scenes.number, [...seen]),
      ),
    )
    .returning({ number: scenes.number })
    .all()
    .map((row) => row.number)
    .sort((a, b) => a - b);
}

// ── 读 ──

/** 最新的一版主线：全文和解析结果。还没交过主线时为空。接口 GET /projects/:pid/mainline 用。 */
export function latestRevision(
  db: Reader,
  projectId: string,
): Result<MainlineRevision | null, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = latestRow(db, projectId);
  return ok(row === undefined ? null : toRevision(db, row));
}

/**
 * 主线的历次版本，按版本号从小到大排，不带全文和解析结果。
 * `ploop mainline history` 用，接口是 GET /projects/:pid/mainline/revisions。
 */
export function listRevisions(
  db: Reader,
  projectId: string,
): Result<MainlineRevisionSummary[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const rows = db
    .select({
      revision: mainlineRevisions.revision,
      hash: mainlineRevisions.hash,
      source: mainlineRevisions.source,
      roundId: mainlineRevisions.roundId,
      createdAt: mainlineRevisions.createdAt,
    })
    .from(mainlineRevisions)
    .where(eq(mainlineRevisions.projectId, projectId))
    .orderBy(asc(mainlineRevisions.revision))
    .all();
  const labels = roundLabels(
    db,
    rows.map((row) => row.roundId),
  );
  return ok(rows.map((row) => toSummary(row, labels)));
}

/** 按版本号取一版：全文和解析结果。工作台切到某个历史版本时用。 */
export function getRevision(
  db: Reader,
  projectId: string,
  revision: number,
): Result<MainlineRevision, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const row = db
    .select()
    .from(mainlineRevisions)
    .where(
      and(eq(mainlineRevisions.projectId, projectId), eq(mainlineRevisions.revision, revision)),
    )
    .get();
  if (row === undefined) return fail("NOT_FOUND", notFoundIssue(projectId, revision));
  return ok(toRevision(db, row));
}

/** 十样里的一样最近一次改动：哪一版、在哪一轮。一次都没写过时都为空。 */
export type MainlinePartChange = {
  readonly part: MainlinePart;
  readonly revision: number | null;
  readonly round: string | null;
};

/**
 * 十样各是哪一版最近改的，工作台主线页的目录用，见「06 工作台」第六节。
 * 按版本号从小到大，比较每一样标题到这一节末尾的原文，和上一版不同就记下这一版。
 * 删掉一样也算改动。
 */
export function partChanges(
  db: Reader,
  projectId: string,
): Result<MainlinePartChange[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const rows = db
    .select({
      revision: mainlineRevisions.revision,
      text: mainlineRevisions.text,
      parsed: mainlineRevisions.parsed,
      roundId: mainlineRevisions.roundId,
    })
    .from(mainlineRevisions)
    .where(eq(mainlineRevisions.projectId, projectId))
    .orderBy(asc(mainlineRevisions.revision))
    .all();
  const labels = roundLabels(
    db,
    rows.map((row) => row.roundId),
  );
  const last = new Map<
    MainlinePart,
    { text: string | null; revision: number; roundId: number | null }
  >();
  for (const row of rows) {
    const lines = row.text.split("\n");
    for (const entry of row.parsed.parts) {
      const text = entry.present
        ? lines.slice(entry.heading.line - 1, entry.heading.endLine).join("\n")
        : null;
      const before = last.get(entry.part);
      if (before === undefined ? text !== null : before.text !== text) {
        last.set(entry.part, { text, revision: row.revision, roundId: row.roundId });
      }
    }
  }
  return ok(
    mainlinePart.keys.map((part) => {
      const found = last.get(part);
      if (found === undefined) return { part, revision: null, round: null };
      const round = found.roundId === null ? null : (labels.get(found.roundId) ?? null);
      return { part, revision: found.revision, round };
    }),
  );
}

/** 两版主线的逐行比较。 */
export type MainlineDiff = {
  readonly from: number;
  readonly to: number;
  /** 从 from 改成 to 的逐行对照，写法和页面里文字的改前改后相同，见 model 的 textDiff。 */
  readonly rows: readonly TextDiffRow[];
};

/**
 * 任意两版的逐行比较：`ploop mainline diff` 和工作台的主线页用，见「06 工作台」第六节。
 * from 可以比 to 新，这时看到的是往回改的样子。两版相同时只有一行折起来的 gap。
 * 找不到的版本一次报齐。
 */
export function diffRevisions(
  db: Reader,
  projectId: string,
  from: number,
  to: number,
): Result<MainlineDiff, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const texts = new Map(
    db
      .select({ revision: mainlineRevisions.revision, text: mainlineRevisions.text })
      .from(mainlineRevisions)
      .where(
        and(
          eq(mainlineRevisions.projectId, projectId),
          inArray(mainlineRevisions.revision, [from, to]),
        ),
      )
      .all()
      .map((row) => [row.revision, row.text]),
  );
  const before = texts.get(from);
  const after = texts.get(to);
  if (before !== undefined && after !== undefined) {
    return ok({ from, to, rows: textDiff(before, after) });
  }
  // 走到这里至少缺一版。两个版本号相同时只报一次。
  const missing = [...new Set([from, to])].filter((revision) => !texts.has(revision));
  const [first, ...rest] = missing.map((revision) => notFoundIssue(projectId, revision));
  return err(errorBody("NOT_FOUND", [first ?? notFoundIssue(projectId, from), ...rest]));
}

/** 接口和命令行看到的一个场景。 */
export type SceneView = {
  /** 场景编号，写成 S14。 */
  readonly id: string;
  readonly name: string;
  /** 谁在什么时候用。旧写法的场景没写时为空。 */
  readonly who: string | null;
  readonly steps: readonly SceneStep[];
  /** 首次出现的主线版本号。 */
  readonly firstRevision: number;
  /** 最近一次出现的主线版本号。 */
  readonly latestRevision: number;
  /** 从哪一版起不在主线里。还在的为空。 */
  readonly removedInRevision: number | null;
};

export type ListScenesOptions = {
  /** 连已经从主线里删掉的一起列。 */
  readonly includeRemoved?: boolean | undefined;
};

/**
 * 项目的场景，按编号排。默认只列最新的主线里还在的。
 * 给出信息时按编号填场景名和步骤的文字（第 40 步），使用代码和屏也按编号引用场景。
 */
export function listScenes(
  db: Reader,
  projectId: string,
  options: ListScenesOptions = {},
): Result<SceneView[], ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const ofProject = eq(scenes.projectId, projectId);
  const rows = db
    .select()
    .from(scenes)
    .where(
      options.includeRemoved === true
        ? ofProject
        : and(ofProject, isNull(scenes.removedInRevision)),
    )
    .orderBy(asc(scenes.number))
    .all();
  return ok(
    rows.map((row) => ({
      id: formatSceneId(row.number),
      name: row.name,
      who: row.who,
      steps: row.steps,
      firstRevision: row.firstRevision,
      latestRevision: row.latestRevision,
      removedInRevision: row.removedInRevision,
    })),
  );
}

// ── 主线缺哪几样 ──

/** 主线缺哪几样，取自最新的一版的解析结果。 */
export type MainlineStatus = {
  /** 最新的主线版本号。还没交过主线时为空。 */
  readonly revision: number | null;
  /**
   * 十样里缺的，按十样的顺序。没写这一样的二级标题，或者标题下面是空的，都算缺。
   * 设计规范的十二样都缺时，设计规范这一样也算缺。
   * 还没交过主线时十样都缺。开始一轮时的警告 mainline.ten 看它，见「07 校验」第四节。
   */
  readonly missingParts: readonly MainlinePart[];
  /**
   * 设计规范十二样里缺的，按十二样的顺序。没写这一样的三级标题，或者标题下面是空的，都算缺。
   * 写了「无」的不算缺，没写原因由解析结果的问题另报。进入检查时的规矩 mainline.spec.twelve 看它。
   */
  readonly missingDesignSpec: readonly DesignSpecItem[];
};

/**
 * 主线缺哪几样：`ploop` 的状态（S13 第 3 步）、开始一轮和进入检查时用。
 * 只读，不查项目在不在，由调用的用例先查。
 */
export function mainlineStatus(db: Reader, projectId: string): MainlineStatus {
  const latest = latestParsed(db, projectId);
  if (latest === undefined) {
    return {
      revision: null,
      missingParts: [...mainlinePart.keys],
      missingDesignSpec: [...designSpecItem.keys],
    };
  }
  const missing = missingOfParse(latest.parsed);
  return {
    revision: latest.revision,
    missingParts: missing.parts,
    missingDesignSpec: missing.designSpec,
  };
}

// ── 写作规范 ──

/** 主线里没有写作规范一节时，项目这一层是空的。 */
export const noWritingSpec: ProjectWritingSpec = { banned: [], exceptions: [] };

/**
 * 最新的一版主线「写作规范」一节写的停用说法和例外，见「07 校验」第五节第 1 条。
 * 还没交过主线，或者主线里没有这一节时是空的。放进和修改队列事项时，接口层把它交给写作校验。
 */
export function projectWritingSpec(db: Reader, projectId: string): ProjectWritingSpec {
  return latestParsed(db, projectId)?.parsed.writingSpec ?? noWritingSpec;
}
