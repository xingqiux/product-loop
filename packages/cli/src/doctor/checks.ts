import {
  decisionProblemNeedsCheck,
  describeLandPlanProblem,
  describeLegacyDecisionProblem,
  describeLegacyDecisionSkip,
  describeLegacyQueueCheck,
  describeLegacyQueueProblem,
  describeMainlineProblem,
  type LegacyDecisionRow,
  legacyDecisionShape,
  legacyQueueStatus,
  renderCopy,
  repoKind,
  stage,
} from "@product-loop/model";
import { doctorCopy as text } from "../copy/doctor.ts";
import { checkOf, type DoctorCheck } from "./items.ts";
import type { LandIssue } from "./land.ts";
import type { DoctorScan } from "./scan.ts";

// 把迁移检查看到的情况写成十二个检查项的结论，见「08 版本与迁移」第四节的表。
// 每一项写三组行：发现了什么、--fix 做什么、要 AI 确认什么。有要确认的，这一项的结论就是要确认。

/** 列表最多写几项，多的写「等几个」。 */
const listLimit = 10;

function listText(items: readonly string[], limit = listLimit): string {
  const shown = items.slice(0, limit).join("、");
  return items.length <= limit
    ? shown
    : renderCopy(text.more, { items: shown, count: items.length });
}

/** 旧文件的位置写成相对项目根的路径，在项目根以外的写绝对路径。 */
function place(scan: DoctorScan, dir: string): string {
  return dir.startsWith(`${scan.root}/`) ? dir.slice(scan.root.length + 1) : dir;
}

function identityCheck(scan: DoctorScan): DoctorCheck {
  const { identity, location } = scan;
  const t = text.identity;
  switch (identity.kind) {
    case "valid":
      return checkOf("identity", {
        found: [renderCopy(t.valid, { projectId: identity.identity.projectId })],
      });
    case "invalid":
      return checkOf("identity", {
        found: identity.issues.map((issue) => issue.message),
        fix: [renderCopy(t.rewrite)],
      });
    case "missing":
      if (location.source === undefined) {
        return checkOf("identity", { found: [renderCopy(t.fresh)] }, "info");
      }
      return checkOf("identity", { found: [renderCopy(t.missing)], fix: [renderCopy(t.register)] });
  }
}

function locationCheck(scan: DoctorScan): DoctorCheck {
  const { source, others, ownDocs, tracked, nested, files } = scan.location;
  const t = text.location;
  const found: string[] = [];
  const fix: string[] = [];
  const confirm: string[] = [];
  if (scan.location.rootIsFolder) {
    found.push(renderCopy(t.rootIsFolder));
    confirm.push(renderCopy(t.rootIsFolderHint, { dir: scan.root }));
  }
  if (scan.location.fromEmpty && scan.from !== undefined) {
    confirm.push(renderCopy(t.fromEmpty, { dir: scan.from }));
  }
  if (source === undefined) {
    if (found.length === 0 && confirm.length === 0) found.push(renderCopy(t.none));
  } else {
    switch (source.kind) {
      case "projectCache":
        found.push(renderCopy(t.inCache));
        break;
      case "docs":
        found.push(renderCopy(t.inDocs, { files: listText(source.entries) }));
        if (ownDocs.length > 0) found.push(renderCopy(t.ownDocs, { files: listText(ownDocs) }));
        fix.push(renderCopy(t.docsFix));
        break;
      case "folder":
        found.push(renderCopy(t.inFolder, { dir: source.dir }));
        fix.push(renderCopy(t.folderFix));
        break;
    }
    found.push(renderCopy(t.files, { count: files.length }));
    if (tracked.length > 0) {
      const dir = `${place(scan, source.dir)}/`;
      found.push(renderCopy(t.tracked, { dir, files: listText(tracked) }));
      fix.push(renderCopy(t.trackedFix));
    }
    for (const dir of nested) {
      found.push(renderCopy(t.nested, { dir }));
      confirm.push(renderCopy(t.nestedHint, { dir: `${source.dir}/${dir}` }));
    }
  }
  for (const other of others) {
    found.push(
      renderCopy(t.other, { dir: place(scan, other.dir), files: listText(other.entries) }),
    );
    confirm.push(renderCopy(t.otherHint));
  }
  return checkOf("location", { found, fix, confirm });
}

function ignoreCheck(scan: DoctorScan): DoctorCheck {
  const { ignore } = scan;
  const t = text.ignore;
  if (ignore.kind === "noRepo") return checkOf("ignore", { found: [renderCopy(t.noRepo)] });
  const found = ignore.repo.worktree ? [renderCopy(t.worktree)] : [];
  if (ignore.kind === "ignored") {
    const { source, pattern } = ignore.rule;
    return checkOf("ignore", { found: [renderCopy(t.ignored, { source, pattern }), ...found] });
  }
  found.unshift(renderCopy(t.notIgnored));
  if (ignore.repoKind === undefined) {
    return checkOf("ignore", { found, confirm: [renderCopy(t.askKind)] });
  }
  found.push(renderCopy(t.mainlineKind, { kind: repoKind.label(ignore.repoKind) }));
  const fix = renderCopy(ignore.repoKind === "own" ? t.fixOwn : t.fixShared);
  return checkOf("ignore", { found, fix: [fix] });
}

/** 解析主线的问题最多列几条，多的只写条数。 */
const mainlineProblemLimit = 5;

function mainlineCheck(scan: DoctorScan): DoctorCheck {
  const { mainline } = scan;
  const t = text.mainline;
  if (mainline.kind === "missing") {
    const quiet = scan.location.source === undefined ? "ok" : "info";
    return checkOf(
      "mainline",
      { found: scan.location.source === undefined ? [] : [renderCopy(t.missing)] },
      quiet,
    );
  }
  const found: string[] = [];
  if (mainline.links.length > 0) {
    found.push(renderCopy(t.links, { lines: mainline.links.join("、") }));
  }
  // 一个场景都没认出时，解析的问题里有一条，这里不重复写
  if (mainline.scenes > 0) {
    found.push(renderCopy(t.scenes, { count: mainline.scenes, assigned: mainline.assigned }));
    if (mainline.legacyScenes > 0) {
      found.push(renderCopy(t.legacyScenes, { count: mainline.legacyScenes }));
    }
  }
  if (mainline.missingParts.length > 0) {
    found.push(renderCopy(t.parts, { count: mainline.missingParts.length }));
  }
  const shown = mainline.problems.slice(0, mainlineProblemLimit);
  for (const problem of shown) {
    const { message } = describeMainlineProblem(problem);
    found.push(renderCopy(t.problem, { line: problem.line, message }));
  }
  const rest = mainline.problems.length - shown.length;
  if (rest > 0) found.push(renderCopy(t.moreProblems, { count: rest }));
  const clean = mainline.links.length > 0 || mainline.assigned > 0;
  return checkOf("mainline", { found, fix: [renderCopy(clean ? t.fixClean : t.fixPlain)] });
}

function decisionsCheck(scan: DoctorScan): DoctorCheck {
  const { decisions } = scan;
  const t = text.decisions;
  if (decisions.kind === "missing") {
    return checkOf("decisions", {
      found: scan.location.source === undefined ? [] : [renderCopy(t.missing)],
    });
  }
  const { rows, skipped, tables } = decisions.file;
  const found: string[] = [];
  const confirm: string[] = [];
  if (rows.length === 0 && skipped.length === 0) {
    return checkOf("decisions", { found: [renderCopy(t.noRows)] });
  }
  const shapes = legacyDecisionShape.keys.flatMap((shape) => {
    const count = rows.filter((row) => tableShape(tables, row) === shape).length;
    return count === 0
      ? []
      : [renderCopy(t.shape, { shape: legacyDecisionShape.label(shape), count })];
  });
  found.push(renderCopy(t.rows, { count: rows.length, shapes: shapes.join("、") }));
  const attached = rows.filter((row) => row.attached).length;
  if (attached > 0) found.push(renderCopy(t.attached, { count: attached }));
  const voided = rows.filter((row) => row.status === "voided").length;
  if (voided > 0) found.push(renderCopy(t.voided, { count: voided }));
  const laterNoCase = rows.filter((row) =>
    row.problems.some((problem) => problem.kind === "laterWithoutCase"),
  ).length;
  if (laterNoCase > 0) found.push(renderCopy(t.laterNoCase, { count: laterNoCase }));
  for (const row of rows) {
    for (const problem of row.problems.filter(decisionProblemNeedsCheck)) {
      const line = row.line;
      confirm.push(renderCopy(t.row, { line, text: describeLegacyDecisionProblem(problem) }));
    }
  }
  for (const skip of skipped) {
    confirm.push(renderCopy(t.row, { line: skip.line, text: describeLegacyDecisionSkip(skip) }));
  }
  if (skipped.length > 0) confirm.push(renderCopy(t.skippedHint));
  return checkOf("decisions", { found, fix: [renderCopy(t.fix)], confirm });
}

/** 这一行归到的那张表的形状。 */
function tableShape(tables: DoctorScanDecisionTables, row: LegacyDecisionRow) {
  return tables.find((table) => table.line === row.table)?.shape;
}

type DoctorScanDecisionTables = Extract<
  DoctorScan["decisions"],
  { kind: "found" }
>["file"]["tables"];

function queueCheck(scan: DoctorScan): DoctorCheck {
  const { queue } = scan;
  const t = text.queue;
  if (queue.kind === "missing") {
    return checkOf("queue", {
      found: scan.location.source === undefined ? [] : [renderCopy(t.missing)],
    });
  }
  const { rows, problems } = queue.table;
  const found: string[] = [];
  const fix: string[] = [];
  const confirm: string[] = [];
  if (queue.syntax !== undefined) {
    const { at } = queue.syntax;
    confirm.push(at === undefined ? renderCopy(t.syntaxNoAt) : renderCopy(t.syntax, at));
  } else {
    const statuses = legacyQueueStatus.keys.flatMap((status) => {
      const count = rows.filter((row) => row.status === status).length;
      return count === 0
        ? []
        : [renderCopy(t.status, { status: legacyQueueStatus.label(status), count })];
    });
    const summary = queue.format === "table" ? t.table : t.json;
    // 一件也没有时，「建议」后面没有状态可写，句子写不完，换成一句话。
    found.push(
      rows.length === 0
        ? renderCopy(t.empty, { file: queue.format === "table" ? "队列.md" : "队列.json" })
        : renderCopy(summary, { count: rows.length, statuses: statuses.join("、") }),
    );
    const last = rows.at(-1)?.id;
    if (last !== undefined) {
      fix.push(renderCopy(queue.format === "table" ? t.fixTable : t.fixJson, { last }));
    }
  }
  if (queue.alsoTable) found.push(renderCopy(t.alsoTable));
  if (queue.format === "table" && rows.length > 0) confirm.push(renderCopy(t.everyRow));
  // 同一种说法的几件并成一行，列出编号
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    for (const check of row.checks) {
      const said = describeLegacyQueueCheck(check);
      groups.set(said, [...(groups.get(said) ?? []), row.id]);
    }
  }
  for (const [said, ids] of groups) {
    confirm.push(renderCopy(t.group, { ids: listText(ids), text: said }));
  }
  confirm.push(...problems.map(describeLegacyQueueProblem));
  return checkOf("queue", { found, fix, confirm });
}

function stageNameCheck(scan: DoctorScan): DoctorCheck {
  const t = text.stageName;
  const renamed = "修复";
  const pages = scan.pages.pages.filter(
    ({ result }) => result.kind === "converted" && result.oldStage === renamed,
  );
  const queueRows =
    scan.queue.kind === "found"
      ? scan.queue.table.rows.filter((row) => row.old.stage === renamed)
      : [];
  const found: string[] = [];
  if (pages.length > 0) {
    const ids = pages.map((page) => page.legacyId);
    found.push(renderCopy(t.pages, { count: pages.length, ids: listText(ids) }));
  }
  if (queueRows.length > 0) found.push(renderCopy(t.queue, { count: queueRows.length }));
  if (found.length === 0) {
    return checkOf("stageName", {
      found: scan.location.source === undefined ? [] : [renderCopy(t.none)],
    });
  }
  return checkOf("stageName", { found, fix: [renderCopy(t.fix)] });
}

/** 「例如」后面写几个。 */
const examples = 3;

/** 页面写成日期文件夹加文件名，不带 .json，不同文件夹里的同名页才分得开。 */
const pageName = (path: string) => path.replace(/\.json$/u, "");

function pagesCheck(scan: DoctorScan): DoctorCheck {
  const { pages } = scan;
  const t = text.pages;
  if (!pages.exists) {
    return checkOf("pages", {
      found: scan.location.source === undefined ? [] : [renderCopy(t.none)],
    });
  }
  const found: string[] = [];
  const confirm: string[] = [];
  const stageCounts = stage.keys.flatMap((key) => {
    const count = pages.rounds.filter((round) => round.stages[0] === key).length;
    return count === 0 ? [] : [renderCopy(t.stage, { stage: stage.label(key), count })];
  });
  const unknown = pages.rounds.filter((round) => round.stages.length === 0).length;
  if (unknown > 0)
    stageCounts.push(renderCopy(t.stage, { stage: renderCopy(t.unknownStage), count: unknown }));
  found.push(
    pages.pages.length === 0
      ? renderCopy(t.noPages)
      : renderCopy(t.summary, {
          pages: pages.pages.length,
          rounds: pages.rounds.length,
          stages: stageCounts.join("、"),
        }),
  );
  const converted = pages.pages.flatMap((page) =>
    page.result.kind === "converted" ? [{ page, problems: page.result.problems }] : [],
  );
  const withProblems = converted.filter((entry) => entry.problems > 0);
  if (converted.length > 0) {
    found.push(
      renderCopy(t.converted, {
        clean: converted.length - withProblems.length,
        problems: withProblems.length,
      }),
    );
  }
  if (pages.htmlOnly.length > 0) {
    const files = pages.htmlOnly.map((page) => page.path);
    found.push(renderCopy(t.htmlOnly, { count: files.length, files: listText(files) }));
    const embeds = pages.htmlOnly.filter((page) => page.embedsData).map((page) => page.path);
    if (embeds.length > 0) found.push(renderCopy(t.embeds, { files: listText(embeds) }));
    const unknownHtml = pages.htmlOnly.filter((page) => page.stage === undefined);
    if (unknownHtml.length > 0) {
      confirm.push(
        renderCopy(t.htmlUnknown, { files: listText(unknownHtml.map((page) => page.path)) }),
      );
    }
  }
  const referenced = pages.pages.reduce((sum, page) => sum + page.images.referenced, 0);
  found.push(renderCopy(t.images, { count: pages.images, referenced }));
  if (pages.facts.length > 0) {
    found.push(
      renderCopy(t.facts, {
        count: pages.facts.length,
        files: pages.facts.slice(0, examples).join("、"),
      }),
    );
  }
  if (pages.others.length > 0) {
    found.push(
      renderCopy(t.others, {
        count: pages.others.length,
        files: pages.others.slice(0, examples).join("、"),
      }),
    );
  }
  if (withProblems.length > 0) {
    const list = withProblems.map(({ page, problems }) =>
      renderCopy(t.pageProblems, { page: pageName(page.path), count: problems }),
    );
    confirm.push(renderCopy(t.problems, { count: withProblems.length, pages: listText(list) }));
  }
  for (const page of pages.pages) {
    const { result } = page;
    if (result.kind === "failed") {
      confirm.push(renderCopy(t.failed, { page: page.path, message: result.message }));
    } else if (result.kind === "syntax") {
      confirm.push(
        result.at === undefined
          ? renderCopy(t.syntaxNoAt, { page: page.path })
          : renderCopy(t.syntax, { page: page.path, ...result.at }),
      );
    }
  }
  const missing = pages.pages.flatMap((page) =>
    page.images.missing.map((image) => `${page.folder}/${image}`),
  );
  if (missing.length > 0) {
    confirm.push(renderCopy(t.missingImages, { count: missing.length, files: listText(missing) }));
  }
  const mixed = pages.rounds.filter((round) => round.stages.length > 1).map((round) => round.key);
  if (mixed.length > 0) confirm.push(renderCopy(t.mixed, { rounds: listText(mixed) }));
  const fix = [renderCopy(t.fix), renderCopy(t.fixBlobs)];
  return checkOf("pages", { found, fix, confirm });
}

function landIssueText(issue: LandIssue): string[] {
  const t = text.landRecords;
  switch (issue.kind) {
    case "plan":
      return issue.problems.length === 0
        ? [renderCopy(t.planMissing)]
        : issue.problems.map((problem) => describeLandPlanProblem(problem).message);
    case "tidyMissing":
    case "changesMissing":
    case "reviewMissing":
      return [renderCopy(t[issue.kind])];
    case "redOnly":
    case "greenOnly":
      return [renderCopy(t[issue.kind], { names: issue.names.join("、") })];
    case "badFile":
      return [renderCopy(t.badFile, { file: issue.file })];
  }
}

function landCheck(scan: DoctorScan): DoctorCheck {
  const { land } = scan;
  const t = text.landRecords;
  if (!land.exists) {
    return checkOf("landRecords", {
      found: scan.location.source === undefined ? [] : [renderCopy(t.none)],
    });
  }
  const found: string[] = [];
  const fix: string[] = [];
  const names = land.records.map((record) => record.name);
  found.push(renderCopy(t.summary, { count: names.length, names: listText(names) }));
  for (const record of land.records) {
    for (const issue of record.issues) {
      for (const said of landIssueText(issue)) {
        found.push(renderCopy(t.record, { name: record.name, text: said }));
      }
    }
    if (record.extra.length > 0) {
      found.push(renderCopy(t.extra, { name: record.name, files: listText(record.extra) }));
    }
    if (record.pages.length === 0) found.push(renderCopy(t.unmatched, { name: record.name }));
  }
  // 第一期落地记录只进归档包，见第一期计划第 61 步的决定
  if (land.records.length > 0) fix.push(renderCopy(t.fix));
  return checkOf("landRecords", { found, fix });
}

function useCodeCheck(scan: DoctorScan): DoctorCheck {
  const { useCode } = scan;
  const t = text.useCode;
  if (useCode.dir === undefined) return checkOf("useCode", { found: [renderCopy(t.none)] }, "info");
  const found = [renderCopy(t.found, { dir: useCode.dir, count: useCode.files })];
  found.push(
    useCode.coverage === undefined
      ? renderCopy(t.noCoverage)
      : renderCopy(t.coverage, { file: useCode.coverage }),
  );
  return checkOf("useCode", { found }, "info");
}

function skillVersionCheck(scan: DoctorScan): DoctorCheck {
  const { skillVersion, currentVersion: current } = scan;
  const t = text.skillVersion;
  const fix = [renderCopy(t.fix, { current })];
  switch (skillVersion.kind) {
    case "none":
      return checkOf("skillVersion", {});
    case "legacy":
      return checkOf("skillVersion", { found: [renderCopy(t.legacy)], fix });
    case "unreadable":
      return checkOf("skillVersion", { found: [renderCopy(t.unreadable)] });
    case "recorded": {
      const { version } = skillVersion;
      if (!skillVersion.old)
        return checkOf("skillVersion", { found: [renderCopy(t.current, { version })] });
      return checkOf("skillVersion", { found: [renderCopy(t.old, { version, current })], fix });
    }
  }
}

function cacheCheck(scan: DoctorScan): DoctorCheck {
  const { cache } = scan;
  const t = text.cache;
  if (cache.kind === "notMigrated") {
    const found = [renderCopy(t.notMigrated), ...(cache.migrate ? [renderCopy(t.migrate)] : [])];
    return checkOf("cache", {
      found: scan.location.source === undefined && !cache.migrate ? [] : found,
    });
  }
  const found: string[] = [];
  const fix: string[] = [];
  const confirm: string[] = [];
  switch (cache.mainline) {
    case "same":
    case "noBase":
    case "missing":
      found.push(renderCopy(t[cache.mainline]));
      break;
    case "changed":
      found.push(renderCopy(t.changed));
      fix.push(renderCopy(t.changedFix));
      break;
  }
  if (cache.remote) confirm.push(renderCopy(t.remote));
  if (cache.rounds.length > 0) {
    found.push(renderCopy(t.rounds, { count: cache.rounds.length }));
  }
  if (cache.useRuns.length > 0) found.push(renderCopy(t.useRuns, { count: cache.useRuns.length }));
  if (cache.migrate) found.push(renderCopy(t.migrate));
  return checkOf("cache", { found, fix, confirm });
}

/** 十二个检查项的结论，顺序和第四节的表相同。 */
export function doctorChecks(scan: DoctorScan): DoctorCheck[] {
  return [
    identityCheck(scan),
    locationCheck(scan),
    ignoreCheck(scan),
    mainlineCheck(scan),
    decisionsCheck(scan),
    queueCheck(scan),
    stageNameCheck(scan),
    pagesCheck(scan),
    landCheck(scan),
    useCodeCheck(scan),
    skillVersionCheck(scan),
    cacheCheck(scan),
  ];
}
