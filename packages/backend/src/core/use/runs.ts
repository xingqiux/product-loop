import {
  type ErrorBody,
  formatRoundLabel,
  formatRoundName,
  formatSceneId,
  ok,
  type Result,
  type RoundLabel,
  renderCopy,
  type UseStepResult,
} from "@product-loop/model";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { useRunsCopy } from "../../copy/use.ts";
import { rounds, scenes, useRuns, useSteps } from "../../store/schema/index.ts";
import type { JsonObject } from "../../store/schema/json.ts";
import { fail, findProject, iso, isoOrNull, type Reader } from "../projects.ts";

// 使用代码的运行：接口和命令行看到的样子，以及最近一次运行，见「05 接口」第四节的 GET /use-runs/latest。
// 给出使用轮的页面时，使用区块由后端从最近一次运行生成。收尾使用轮时，use.leave 看它有没有断点。
// 这两件由第 53 步接上。

type RunRow = typeof useRuns.$inferSelect;
type StepRow = typeof useSteps.$inferSelect;

/** 各种结果的步数。 */
type UseResultCounts = {
  readonly pass: number;
  readonly broken: number;
  readonly skipped: number;
  readonly environment: number;
};

/** 一次运行，不带每一步。 */
export type UseRunSummary = {
  readonly id: number;
  /** 收进哪一轮，写成 v2-使用-1。 */
  readonly round: string;
  /** 运行的程序和参数。ploop use ingest 收下的为空。 */
  readonly command: readonly string[] | null;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
  readonly exitCode: number | null;
  readonly commit: string | null;
  readonly environment: string | null;
  /** 覆盖表的快照。 */
  readonly coverage: string | null;
  /** 收进来的时间。 */
  readonly createdAt: string;
  readonly results: UseResultCounts;
};

/** 一步在一个宽度下的结果。 */
type UseStepView = {
  readonly step: number;
  readonly width: number | null;
  readonly do: string;
  readonly expect: string;
  readonly result: UseStepResult;
  /** 截图的哈希，工作台用 GET /blobs/:sha256 读图。 */
  readonly shot: string | null;
  readonly facts: JsonObject | null;
  readonly error: string | null;
};

/** 一个场景这次走到的每一步。名字取自场景表，场景不在场景表里时为空。 */
type UseSceneView = {
  readonly scene: string;
  readonly name: string | null;
  readonly steps: readonly UseStepView[];
};

/** 一次运行和它的每一步，场景按 use-run.json 里的先后排。 */
export type UseRunView = UseRunSummary & { readonly scenes: readonly UseSceneView[] };

function countResults(results: readonly UseStepResult[]): UseResultCounts {
  const count = (key: UseStepResult) => results.filter((result) => result === key).length;
  return {
    pass: count("pass"),
    broken: count("broken"),
    skipped: count("skipped"),
    environment: count("environment"),
  };
}

export function toRunSummary(
  row: RunRow,
  round: string,
  results: readonly UseStepResult[],
): UseRunSummary {
  return {
    id: row.id,
    round,
    command: row.command,
    startedAt: isoOrNull(row.startedAt),
    finishedAt: isoOrNull(row.finishedAt),
    exitCode: row.exitCode,
    commit: row.commit,
    environment: row.environment,
    coverage: row.coverage,
    createdAt: iso(row.createdAt),
    results: countResults(results),
  };
}

/** 场景编号到名字，删掉的场景也在其中。 */
export function sceneNames(db: Reader, projectId: string): ReadonlyMap<number, string> {
  const rows = db
    .select({ number: scenes.number, name: scenes.name })
    .from(scenes)
    .where(eq(scenes.projectId, projectId))
    .all();
  return new Map(rows.map((row) => [row.number, row.name]));
}

/** 最新的主线里每个场景的步号，删掉的场景不算，没写步的场景也不算。 */
function mainlineSteps(db: Reader, projectId: string): Map<number, readonly number[]> {
  const rows = db
    .select({ number: scenes.number, steps: scenes.steps })
    .from(scenes)
    .where(and(eq(scenes.projectId, projectId), isNull(scenes.removedInRevision)))
    .orderBy(asc(scenes.number))
    .all();
  return new Map(
    rows.flatMap((row): [number, readonly number[]][] =>
      row.steps.length === 0 ? [] : [[row.number, row.steps.map((step) => step.step)]],
    ),
  );
}

/** 主线里某个场景的几步，这次运行没走到。 */
export type UnreachedSteps = { readonly scene: number; readonly steps: readonly number[] };

/**
 * 主线里有、这次运行没走到的步，按场景编号和步号排。走到指运行里有这一步，不管结果。
 * 使用阶段的运行要把主线的每一步都用一遍（决定 215），没走到的步就是缺口。
 * 主线里还没有场景时没有缺口。
 */
export function unreachedSteps(
  db: Reader,
  projectId: string,
  ran: readonly { readonly scene: number; readonly step: number }[],
): UnreachedSteps[] {
  const reached = new Set(ran.map((entry) => `${entry.scene}:${entry.step}`));
  const result: UnreachedSteps[] = [];
  for (const [scene, steps] of mainlineSteps(db, projectId)) {
    const missing = [...new Set(steps)]
      .filter((step) => !reached.has(`${scene}:${step}`))
      .sort((a, b) => a - b);
    if (missing.length > 0) result.push({ scene, steps: missing });
  }
  return result;
}

export type LatestUseRunOptions = {
  /** 只看这一轮的运行。不写就看整个项目。 */
  readonly round?: RoundLabel | undefined;
};

/** 最近一次收进来的运行和它的每一步。还没有运行时为空。 */
export function latestUseRun(
  db: Reader,
  projectId: string,
  options: LatestUseRunOptions = {},
): Result<UseRunView | null, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  let where = eq(useRuns.projectId, projectId);
  if (options.round !== undefined) {
    const { version, stage, seq } = options.round;
    const round = db
      .select({ id: rounds.id })
      .from(rounds)
      .where(
        and(
          eq(rounds.projectId, projectId),
          eq(rounds.version, version),
          eq(rounds.stage, stage),
          eq(rounds.seq, seq),
        ),
      )
      .get();
    if (round === undefined) {
      const text = useRunsCopy.roundNotFound;
      const name = formatRoundName(options.round);
      return fail("NOT_FOUND", {
        message: renderCopy(text.message, { project: projectId, round: name }),
        hint: renderCopy(text.hint),
        where: name,
      });
    }
    where = and(where, eq(useRuns.roundId, round.id)) ?? where;
  }
  const row = db.select().from(useRuns).where(where).orderBy(desc(useRuns.id)).limit(1).get();
  return ok(row === undefined ? null : runView(db, row));
}

function runView(db: Reader, row: RunRow): UseRunView {
  const round = db.select().from(rounds).where(eq(rounds.id, row.roundId)).get();
  // 运行一定挂在一个阶段上，外键保证这个阶段在。
  if (round === undefined) throw new Error(`运行 ${row.id} 挂的阶段不在，数据不一致。`);
  const steps = db
    .select()
    .from(useSteps)
    .where(eq(useSteps.runId, row.id))
    .orderBy(asc(useSteps.id))
    .all();
  const names = sceneNames(db, row.projectId);
  const grouped: { scene: number; steps: StepRow[] }[] = [];
  for (const step of steps) {
    const last = grouped.at(-1);
    if (last?.scene === step.scene) last.steps.push(step);
    else grouped.push({ scene: step.scene, steps: [step] });
  }
  const summary = toRunSummary(
    row,
    formatRoundLabel(round),
    steps.map((step) => step.result),
  );
  return {
    ...summary,
    scenes: grouped.map((group) => ({
      scene: formatSceneId(group.scene),
      name: names.get(group.scene) ?? null,
      steps: group.steps.map(toStepView),
    })),
  };
}

function toStepView(row: StepRow): UseStepView {
  return {
    step: row.step,
    width: row.width,
    do: row.do,
    expect: row.expect,
    result: row.result,
    shot: row.shot,
    facts: row.facts,
    error: row.error,
  };
}
