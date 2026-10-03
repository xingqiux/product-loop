import {
  beijingDay,
  decisionDocFileName,
  type ErrorBody,
  filledPageSchema,
  formatRoundLabel,
  ok,
  type Result,
  renderDecisionDoc,
  renderLegacyDecisionDoc,
  renderLegacyQueue,
  renderQueueDoc,
  replyLineSchema,
  roundViewSchema,
  submissionSource,
} from "@product-loop/model";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";
import { pages, rounds, submissions } from "../store/schema/index.ts";
import { listDecisions } from "./decisions.ts";
import { latestRevision } from "./mainline.ts";
import { fillPage } from "./pages/fill.ts";
import { findProject, type Reader } from "./projects.ts";
import { listQueueItems } from "./queue.ts";
import { toSubmissionView } from "./replies/read.ts";
import { toRoundView } from "./versions.ts";

// 导出一个项目：ploop export，接口是 GET /projects/:pid/export，见「03 数据模型」第九节。
// 后端给出文件的路径和全文，命令行写成文件夹：
// - 主线.md：最新的主线全文。
// - 决定.md：全部决定，含已作废的。
// - 队列.md：只读的表格，按阶段和状态分组。
// - rounds/<轮次>.json：每一轮的页面数据和回复，枚举写中文，和接口上的相同。
// 按旧格式写回时，给出旧 skill 读的主线.md、决定.md 和队列.json，见「08 版本与迁移」第八节。
// 只读，不改数据。

type ExportFile = { readonly path: string; readonly text: string };

export type ExportBundle = {
  readonly project: string;
  readonly legacy: boolean;
  readonly files: readonly ExportFile[];
};

const mainlineFile = "主线.md";

/** 带时区的时间写成北京时间的日期。 */
const dayOf = (iso: string) => beijingDay(new Date(iso));

/** 一轮的导出：轮次、每一页和它的回复。 */
function roundFile(db: Reader, row: typeof rounds.$inferSelect): ExportFile {
  const label = formatRoundLabel(row);
  const pageRows = db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.roundId, row.id))
    .orderBy(asc(pages.seq))
    .all();
  const pageViews = pageRows.flatMap(({ id }) => {
    const filled = fillPage(db, id);
    if (!filled.ok) return [];
    const submission = db.select().from(submissions).where(eq(submissions.pageId, id)).get();
    const reply =
      submission === undefined
        ? null
        : (() => {
            const view = toSubmissionView(db, submission);
            return {
              id: view.id,
              source: submissionSource.label(view.source),
              submittedAt: view.submittedAt,
              text: view.text,
              lines: z.encode(z.array(replyLineSchema), [...view.lines]),
            };
          })();
    return [{ page: z.encode(filledPageSchema, filled.value), reply }];
  });
  const content = { round: z.encode(roundViewSchema, toRoundView(row)), pages: pageViews };
  return { path: `rounds/${label}.json`, text: `${JSON.stringify(content, null, 2)}\n` };
}

/** 导出一个项目的全部文件。legacy 写 true 时给出旧格式的三个文件。 */
export function exportProject(
  db: Reader,
  projectId: string,
  options: { readonly legacy?: boolean | undefined } = {},
): Result<ExportBundle, ErrorBody<"NOT_FOUND">> {
  const project = findProject(db, projectId);
  if (!project.ok) return project;
  const mainline = latestRevision(db, projectId);
  if (!mainline.ok) return mainline;
  const decisions = listDecisions(db, projectId, { includeVoided: true });
  if (!decisions.ok) return decisions;
  const queue = listQueueItems(db, projectId);
  if (!queue.ok) return queue;
  const files: ExportFile[] = [];
  if (mainline.value !== null) files.push({ path: mainlineFile, text: mainline.value.text });
  const legacy = options.legacy === true;
  if (legacy) {
    files.push(
      { path: decisionDocFileName, text: renderLegacyDecisionDoc(decisions.value) },
      { path: "队列.json", text: renderLegacyQueue(queue.value, dayOf) },
    );
    return ok({ project: projectId, legacy, files });
  }
  files.push(
    { path: decisionDocFileName, text: renderDecisionDoc(decisions.value) },
    { path: "队列.md", text: renderQueueDoc(queue.value, dayOf) },
  );
  const roundRows = db
    .select()
    .from(rounds)
    .where(eq(rounds.projectId, projectId))
    .orderBy(asc(rounds.id))
    .all();
  for (const row of roundRows) files.push(roundFile(db, row));
  return ok({ project: projectId, legacy, files });
}
