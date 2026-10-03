import { renderCopy } from "@product-loop/model";
import { doctorCopy as text } from "../copy/doctor.ts";
import type { Report } from "../output.ts";
import { doctorChecks } from "./checks.ts";
import { type DoctorCheck, doctorItem, doctorStatus, legacyLayout } from "./items.ts";
import type { DoctorScan } from "./scan.ts";

// 迁移检查报告：把扫描结果写成命令的输出，见「04 命令行」第五节和「08 版本与迁移」第四节。
// 文字输出第一行写结果，接着写旧文件在哪里和一句总结，再按十二个检查项逐项写。
// 每一项先写「检查项：结论」，下面缩进写发现、--fix 和确认三组行。--json 时写 DoctorJson。

/** 机读结果里的一个检查项，检查项和结论写中文。 */
type DoctorCheckJson = {
  readonly item: string;
  readonly status: string;
  readonly found: readonly string[];
  readonly fix: readonly string[];
  readonly confirm: readonly string[];
};

/** 机读结果里的数目，给以后的命令和走查汇总用。 */
export type DoctorCounts = {
  /** 页面数据的页数。 */
  readonly pages: number;
  /** 转换以后可以直接导入的页数。 */
  readonly convertible: number;
  /** 转换以后还有要改的地方的页数。 */
  readonly withProblems: number;
  /** 转不了的页数，包括不是合法 JSON 的。 */
  readonly unconvertible: number;
  readonly htmlOnly: number;
  readonly rounds: number;
  readonly images: number;
  readonly decisions: number;
  /** 要 AI 确认的决定行数，不算没有读的行。 */
  readonly decisionsToConfirm: number;
  readonly queue: number;
  readonly queueToConfirm: number;
  readonly landRecords: number;
};

export type DoctorJson = {
  readonly root: string;
  readonly from?: string;
  /** 这次迁移的旧文件。没有找到时没有。 */
  readonly source?: {
    readonly layout: string;
    readonly dir: string;
    readonly entries: readonly string[];
  };
  readonly checks: readonly DoctorCheckJson[];
  readonly counts: DoctorCounts;
};

export function doctorCounts(scan: DoctorScan): DoctorCounts {
  const { pages, decisions, queue } = scan;
  const results = pages.pages.map((page) => page.result);
  const converted = results.flatMap((result) => (result.kind === "converted" ? [result] : []));
  const rows = decisions.kind === "found" ? decisions.file.rows : [];
  const queueRows = queue.kind === "found" ? queue.table.rows : [];
  const withProblems = converted.filter((result) => result.problems > 0).length;
  return {
    pages: pages.pages.length,
    convertible: converted.length - withProblems,
    withProblems,
    unconvertible: results.length - converted.length,
    htmlOnly: pages.htmlOnly.length,
    rounds: pages.rounds.length,
    images: pages.images,
    decisions: rows.length,
    decisionsToConfirm: rows.filter((row) =>
      row.problems.some((problem) => problem.kind !== "laterWithoutCase"),
    ).length,
    queue: queueRows.length,
    queueToConfirm: queueRows.filter((row) => row.checks.length > 0).length,
    landRecords: scan.land.records.length,
  };
}

function checkLines(check: DoctorCheck): string[] {
  const head = renderCopy(text.head, {
    item: doctorItem.label(check.item),
    status: doctorStatus.label(check.status),
  });
  const body = [
    ...check.found.map((line) => renderCopy(text.found, { text: line })),
    ...check.fix.map((line) => renderCopy(text.fix, { text: line })),
    ...check.confirm.map((line) => renderCopy(text.confirm, { text: line })),
  ];
  return [head, ...body.map((line) => `  ${line}`)];
}

/** 总结和下一步：有要确认的先确认，再 --fix。什么都没找到时提示开工或用 --from。 */
function summaryOf(
  scan: DoctorScan,
  checks: readonly DoctorCheck[],
): { summary: string; next: string[]; clean: boolean } {
  const confirm = checks.filter((check) => check.status === "confirm").length;
  const fix = checks.filter((check) => check.status === "fix").length;
  if (confirm > 0) {
    return {
      summary: renderCopy(text.summary.confirm, { confirm, fix }),
      next: [renderCopy(text.next.confirm), renderCopy(text.next.fix)],
      clean: false,
    };
  }
  if (fix > 0) {
    return {
      summary: renderCopy(text.summary.fix, { fix }),
      next: [renderCopy(text.next.fix)],
      clean: false,
    };
  }
  if (scan.location.source === undefined && scan.identity.kind === "missing") {
    return {
      summary: renderCopy(text.summary.fresh),
      next: [renderCopy(text.next.fresh), renderCopy(text.next.from)],
      clean: false,
    };
  }
  return {
    summary: renderCopy(text.summary.clean),
    next: [renderCopy(text.next.clean)],
    clean: true,
  };
}

/**
 * 把一次迁移检查写成命令的输出。只读，不改任何文件。
 * checks 是按迁移对照改写过的结论，不给时按扫描结果算。lines 写在总结后面，例如写好的迁移对照。
 * 没有要迁移也没有要确认的地方时，文字只写一行「没有要迁移的地方」，写 verbose 才把每个检查项列出来。
 * --json 不受影响，检查项都在里面。
 */
export function renderDoctorReport(
  scan: DoctorScan,
  options: {
    readonly checks?: readonly DoctorCheck[];
    readonly lines?: readonly string[];
    readonly verbose?: boolean;
  } = {},
): Report<DoctorJson> {
  const checks = options.checks ?? doctorChecks(scan);
  const { source } = scan.location;
  const { summary, next, clean } = summaryOf(scan, checks);
  const brief = clean && options.verbose !== true && (options.lines ?? []).length === 0;
  const sourceLine =
    source === undefined
      ? []
      : [renderCopy(text.source, { dir: source.dir, layout: legacyLayout.label(source.kind) })];
  const data: DoctorJson = {
    root: scan.root,
    ...(scan.from === undefined ? {} : { from: scan.from }),
    ...(source === undefined
      ? {}
      : {
          source: {
            layout: legacyLayout.label(source.kind),
            dir: source.dir,
            entries: source.entries,
          },
        }),
    checks: checks.map((check) => ({
      ...check,
      item: doctorItem.label(check.item),
      status: doctorStatus.label(check.status),
    })),
    counts: doctorCounts(scan),
  };
  return {
    kind: "doctor.report",
    data,
    lines: brief
      ? [summary]
      : [
          renderCopy(text.title, { root: scan.root }),
          ...sourceLine,
          summary,
          ...(options.lines ?? []),
          ...checks.flatMap((check) => ["", ...checkLines(check)]),
        ],
    next,
    warnings: [],
  };
}
