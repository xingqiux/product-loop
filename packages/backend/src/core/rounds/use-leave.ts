import {
  defaultCoveragePath,
  formatCommand,
  formatRoundName,
  formatSceneId,
  type Issue,
  parseCoverage,
  parseSceneId,
  renderCopy,
} from "@product-loop/model";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { roundsCopy } from "../../copy/rounds.ts";
import { rounds, useRuns } from "../../store/schema/index.ts";
import { findProject, type Reader } from "../projects.ts";
import { latestUseRun, type UnreachedSteps, unreachedSteps } from "../use/runs.ts";

// 使用阶段的离开条件，见「04 命令行」第十节：最近一次运行没有断点，覆盖表没有缺口。
// 收尾使用阶段时拦截，查这一件事的地方只有这里：收尾、给出页面和下一步都用它。

/** 规矩 use.leave 的编号，登记在 model 的 rules/backend.ts，收尾用的常量指向它。 */
export const useLeaveRule = "use.leave";

type RoundRow = typeof rounds.$inferSelect;

/**
 * 下一步写的重跑命令：优先取使用阶段里最近一次运行用的命令，那一次是要跑全的；
 * 使用阶段还没运行过，才取别的阶段最近用的，例如落地时只重跑改到的几个场景，那条命令不能拿来当使用阶段的下一步。
 * ploop use ingest 收下的运行没有命令。
 */
export function lastUseCommand(db: Reader, projectId: string): readonly string[] | null {
  const recent = (stageOnly: boolean) =>
    db
      .select({ command: useRuns.command })
      .from(useRuns)
      .innerJoin(rounds, eq(rounds.id, useRuns.roundId))
      .where(
        and(
          eq(useRuns.projectId, projectId),
          isNotNull(useRuns.command),
          stageOnly ? eq(rounds.stage, "use") : undefined,
        ),
      )
      .orderBy(desc(useRuns.id))
      .limit(1)
      .get();
  return (recent(true) ?? recent(false))?.command ?? null;
}

/**
 * 规矩 use.leave：收尾使用轮时看这一轮最近一次运行。
 * 这一轮还没有运行、有断点、没有覆盖表的快照、覆盖表有缺口，各报一处。
 * 环境问题和跳过的步不算断点，见「09 skill 与软件」第四节。
 * 提示不写「放进队列」：断点不清零，使用阶段就收不了尾，放进队列只会原地打转。
 * 项目里运行过使用代码时，提示里的重跑命令直接写上。
 * 覆盖表默认放在使用代码的文件夹里，自己的仓库和共用的仓库不同，提示里写这个项目的位置，见决定 107。
 */
export function useLeaveIssues(db: Reader, round: RoundRow): Issue[] {
  const name = formatRoundName(round);
  const text = roundsCopy.close.use;
  const issue = (entry: { message: string; hint: string }): Issue => ({
    rule: useLeaveRule,
    message: entry.message,
    hint: entry.hint,
    where: name,
  });
  const latest = latestUseRun(db, round.projectId, { round });
  const run = latest.ok ? latest.value : null;
  if (run === null) {
    const known = lastUseCommand(db, round.projectId);
    return [
      issue({
        message: renderCopy(text.noRun.message, { round: name }),
        hint:
          known === null
            ? renderCopy(text.noRun.hint)
            : renderCopy(text.noRun.hintKnown, { command: formatCommand(known) }),
      }),
    ];
  }
  const blocks: Issue[] = [];
  if (run.results.broken > 0) {
    const steps = run.scenes.flatMap((scene) =>
      scene.steps
        .filter((step) => step.result === "broken")
        .map((step) => renderCopy(text.broken.step, { scene: scene.scene, step: step.step })),
    );
    blocks.push(
      issue({
        message: renderCopy(text.broken.message, {
          count: run.results.broken,
          steps: [...new Set(steps)].join("、"),
        }),
        hint: renderCopy(text.broken.hint),
      }),
    );
  }
  const ran = run.scenes.flatMap((scene) => {
    const number = parseSceneId(scene.scene);
    return number.ok ? scene.steps.map((step) => ({ scene: number.value, step: step.step })) : [];
  });
  const gaps = unreachedSteps(db, round.projectId, ran);
  if (gaps.length > 0) blocks.push(issue(unreachedEntry(gaps)));
  if (run.coverage === null) {
    const project = findProject(db, round.projectId);
    const file = defaultCoveragePath(project.ok ? project.value.repoKind : "own");
    blocks.push(
      issue({
        message: renderCopy(text.noCoverage.message),
        hint: renderCopy(text.noCoverage.hint, { file }),
      }),
    );
  } else {
    const { gaps } = parseCoverage(run.coverage);
    if (gaps.length > 0) {
      blocks.push(
        issue({
          message: renderCopy(text.gaps.message, {
            count: gaps.length,
            items: gaps.map((gap) => gap.item).join("、"),
          }),
          hint: renderCopy(text.gaps.hint),
        }),
      );
    }
  }
  return blocks;
}

/** 场景最多列几个，再多的写「等」。 */
const listedScenes = 6;

/** 主线里没走到的步，写成「S2 第 2、3 步，S4 第 1 步」。 */
function unreachedText(gaps: readonly UnreachedSteps[]): string {
  const text = roundsCopy.close.use.unreached;
  const listed = gaps
    .slice(0, listedScenes)
    .map((gap) =>
      renderCopy(text.scene, { scene: formatSceneId(gap.scene), steps: gap.steps.join("、") }),
    )
    .join("，");
  return gaps.length > listedScenes
    ? renderCopy(text.more, { list: listed, count: gaps.length - listedScenes })
    : listed;
}

/** 没走到的步：写明几步、哪几步，怎么补。 */
function unreachedEntry(gaps: readonly UnreachedSteps[]): { message: string; hint: string } {
  const text = roundsCopy.close.use.unreached;
  const count = gaps.reduce((sum, gap) => sum + gap.steps.length, 0);
  return {
    message: renderCopy(text.message, { count, steps: unreachedText(gaps) }),
    hint: renderCopy(text.hint),
  };
}
