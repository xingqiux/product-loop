import { renamedStages, type Stage, stage } from "./names.ts";
import { err, ok, type Result } from "./result.ts";
import { formatRoundName, parseRoundName } from "./round-name.ts";

// 阶段的标识 `v2-落地-3`：版本、阶段名、这一版里这个阶段的第几次，用短横连起来。
// 只在地址、文件夹名和 --json 里出现；对用户显示的文字写「第 2 版的落地阶段」，见 round-name.ts。
// 每一版每个阶段都从 1 数，见「00 总览」第一节（决定 169）。

export type RoundLabel = {
  readonly version: number;
  readonly stage: Stage;
  readonly seq: number;
};

/**
 * - shape：整体的样子不对，例如少了一段、数字前面补了 0、用了全角横线、首尾带空格。
 * - stage：阶段名不是五个中文阶段名之一，例如写成了英文键 `land`。
 * - renamedStage：用了改过名的阶段，例如「修复」，现在叫「落地」。
 * - zero：版本或次数写了 0，两者都从 1 数。
 */
export type RoundLabelError = "shape" | "stage" | "renamedStage" | "zero";

const labelPattern = /^v(?<version>0|[1-9]\d*)-(?<stage>[^-\s]+)-(?<seq>0|[1-9]\d*)$/u;

export function formatRoundLabel(round: RoundLabel): string {
  return `v${round.version}-${stage.label(round.stage)}-${round.seq}`;
}

export function parseRoundLabel(text: string): Result<RoundLabel, RoundLabelError> {
  const groups = labelPattern.exec(text)?.groups;
  if (!groups) return err("shape");
  const version = Number(groups.version);
  const seq = Number(groups.seq);
  const stageLabel = groups.stage ?? "";
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(seq)) return err("shape");
  const key = stage.key(stageLabel);
  if (key === undefined) return err(renamedStages.has(stageLabel) ? "renamedStage" : "stage");
  if (version === 0 || seq === 0) return err("zero");
  return ok({ version, stage: key, seq });
}

/** 阶段的标识转成叫法，例如 v2-落地-3 转成第 2 版的落地阶段（第 3 次）。读不出时原样交回。 */
export function roundNameOfLabel(label: string): string {
  const parsed = parseRoundLabel(label);
  return parsed.ok ? formatRoundName(parsed.value) : label;
}

/** 一页的叫法，页所在阶段用标识给出：v2-落地-3 加 2 转成第 2 版的落地阶段（第 3 次）的第 2 页。 */
export function pageNameOfLabel(label: string, seq: number): string {
  return `${roundNameOfLabel(label)}的第 ${seq} 页`;
}

// 旧编号是迁移前页面数据的文件名，例如 `fix-13`、`land-15-plan`、`think-2-v2`。
// 只用于展示和查找，见「08 版本与迁移」第五节。

/** 旧文件名的前缀对应的阶段。report 的阶段不定，要看页面数据里的 stage。 */
const legacyPrefixStage: ReadonlyMap<string, Stage | undefined> = new Map<
  string,
  Stage | undefined
>([
  ["think", "think"],
  ["use", "use"],
  ["check", "check"],
  ["land", "land"],
  ["fix", "land"],
  ["improve", "improve"],
  ["report", undefined],
]);

export type LegacyRoundId = {
  /** 原样的旧编号。 */
  readonly id: string;
  readonly prefix: string;
  readonly n: number;
  /** 同一个阶段的另一页或重做的一版，例如 `land-15-plan` 的 plan、`think-2-v2` 的 v2。 */
  readonly suffix?: string;
  /** 页面数据和日期文件夹对不上时，旧编号带上文件夹，例如 `2026-09-20/think-29`。 */
  readonly folder?: string;
  /** 前缀是 report 时没有，阶段要从页面数据取。 */
  readonly stage?: Stage;
};

const legacyPattern =
  /^(?:(?<folder>\d{4}-\d{2}-\d{2})\/)?(?<prefix>[a-z]+)-(?<n>\d+)(?:-(?<suffix>[a-z0-9]+))?$/u;

export function parseLegacyRoundId(text: string): Result<LegacyRoundId, "shape"> {
  const groups = legacyPattern.exec(text)?.groups;
  const prefix = groups?.prefix ?? "";
  if (!groups || !legacyPrefixStage.has(prefix)) return err("shape");
  const n = Number(groups.n);
  if (!Number.isSafeInteger(n)) return err("shape");
  const legacyStage = legacyPrefixStage.get(prefix);
  return ok({
    id: text,
    prefix,
    n,
    ...(groups.suffix === undefined ? {} : { suffix: groups.suffix }),
    ...(groups.folder === undefined ? {} : { folder: groups.folder }),
    ...(legacyStage === undefined ? {} : { stage: legacyStage }),
  });
}

/**
 * 命令的参数里指一个阶段：对用户写的叫法、阶段的标识或迁移前的文件名都收，
 * 只写阶段名（落地、落地阶段）指这一版里最近一次的那个阶段。
 */
export type RoundRef =
  | { readonly kind: "label"; readonly label: RoundLabel }
  | { readonly kind: "legacy"; readonly legacy: LegacyRoundId }
  | { readonly kind: "stage"; readonly stage: Stage };

/** unknown：三种写法都不是。以 v 加数字开头的按标识报具体的错，以「第」开头的按叫法报。 */
export type RoundRefError = RoundLabelError | "unknown";

export function parseRoundRef(text: string): Result<RoundRef, RoundRefError> {
  const label = parseRoundLabel(text);
  if (label.ok) return ok({ kind: "label", label: label.value });
  const name = parseRoundName(text);
  if (name.ok) return ok({ kind: "label", label: name.value });
  const key = stage.key(text.trim().replace(/阶段$/u, ""));
  if (key !== undefined) return ok({ kind: "stage", stage: key });
  const legacy = parseLegacyRoundId(text);
  if (legacy.ok) return ok({ kind: "legacy", legacy: legacy.value });
  if (/^v\d/u.test(text)) return err(label.error);
  return err(/^第/u.test(text.trim()) ? name.error : "unknown");
}
