import { renamedStages, type Stage, stage } from "./names.ts";
import { err, ok, type Result } from "./result.ts";
import type { RoundLabel, RoundLabelError } from "./round-label.ts";

// 对用户显示的文字里一个阶段的叫法，见决定 211：不用「轮」，叫「阶段」，不显示 v2-落地-3 这样的写法。
// 例如「第 2 版的落地阶段」，同一版里同一阶段做了第二次，写「第 2 版的落地阶段（第 2 次）」。
// 上下文已经说清是哪一版时可以只写「落地阶段」，见 formatStageName。
// 命令的参数写这个叫法，也收 v2-落地-3，见 parseRoundName 和 round-label.ts 的 parseRoundRef。

type Named = Pick<RoundLabel, "version" | "stage" | "seq">;

/** 一个阶段在文字里的叫法：第 2 版的落地阶段，第二次起写成第 2 版的落地阶段（第 2 次）。 */
export function formatRoundName(round: Named): string {
  return `第 ${round.version} 版的${formatStageName(round)}`;
}

/** 上下文已经说清是哪一版时的叫法：落地阶段，第二次起写成落地阶段（第 2 次）。 */
export function formatStageName(round: Pick<RoundLabel, "stage" | "seq">): string {
  const name = `${stage.label(round.stage)}阶段`;
  return round.seq > 1 ? `${name}（第 ${round.seq} 次）` : name;
}

/**
 * 一页在文字里的叫法：第 2 版的落地阶段的第 2 页。页只用这一种号，是它在这个阶段里的第几页，
 * 项目里全局的页面编号只在 --json 里出现，见审查报告 P07。
 */
export function formatPageName(round: Named, seq: number): string {
  return `${formatRoundName(round)}的第 ${seq} 页`;
}

// 写在命令里时，空格、「的」和括号都可以省，例如 第2版落地阶段、第2版落地阶段第2次。
const namePattern =
  /^第\s*(?<version>0|[1-9]\d*)\s*版\s*(?:的\s*)?(?<stage>[^\s（()]+?)\s*阶段(?:\s*[（(]?\s*第\s*(?<seq>0|[1-9]\d*)\s*次\s*[）)]?)?$/u;

/** 读出对用户写的叫法。写法和 parseRoundLabel 的错误码相同。 */
export function parseRoundName(text: string): Result<RoundLabel, RoundLabelError> {
  const groups = namePattern.exec(text.trim())?.groups;
  if (!groups) return err("shape");
  const version = Number(groups.version);
  const seq = groups.seq === undefined ? 1 : Number(groups.seq);
  const stageLabel = groups.stage ?? "";
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(seq)) return err("shape");
  const key: Stage | undefined = stage.key(stageLabel);
  if (key === undefined) return err(renamedStages.has(stageLabel) ? "renamedStage" : "stage");
  if (version === 0 || seq === 0) return err("zero");
  return ok({ version, stage: key, seq });
}

const labelStage = /^v\d+-(?<stage>[^-\s]+)-\d+$/u;

/** 写错的阶段里的阶段名，标识和叫法两种写法都能读。报「用了改过名的阶段名」时要写出它。 */
export function stageWordOf(text: string): string {
  const trimmed = text.trim();
  return (labelStage.exec(trimmed)?.groups ?? namePattern.exec(trimmed)?.groups)?.stage ?? "";
}
