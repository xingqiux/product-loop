// 阶段在页面上的写法和状态。接口里的枚举是中文，这里照中文比较。
// 对用户显示的文字不用「轮」，也不显示 v2-落地-1 这样的标识，见决定 211。
import type { StageLabel } from "@product-loop/model";

type Round = {
  readonly version: number;
  readonly stage: StageLabel;
  readonly seq: number;
  readonly status: string;
};

/** 阶段的状态在页面上的说法：等用户回复、进行中、已收尾。 */
export type RoundState = "waiting" | "working" | "closed";

export function roundState(status: string): RoundState {
  if (status === "等用户回复") return "waiting";
  if (status === "已收尾") return "closed";
  return "working";
}

export const roundStateText: Record<RoundState, string> = {
  waiting: "等用户回复",
  working: "进行中",
  closed: "已收尾",
};

/**
 * 这一版还没开始第一个阶段时的写法。有历史的项目（第 1 版已经走完）写清是哪一版还没开始阶段，
 * 不能让人以为整个项目没开始。
 */
export function versionIdleText(version: number): string {
  return `第 ${version} 版，还没开始阶段`;
}

/** 阶段第二次起才写次数：（第 2 次）。 */
function againOf(seq: number): string {
  return seq > 1 ? `（第 ${seq} 次）` : "";
}

/** 对用户写的一次阶段：第 2 版的落地阶段。同一版里同一阶段做了第二次，写第 2 版的落地阶段（第 2 次）。 */
export function roundName(round: Pick<Round, "version" | "stage" | "seq">): string {
  return `第 ${round.version} 版的${round.stage}阶段${againOf(round.seq)}`;
}

/** 上下文已经说清是哪一版时的写法：落地阶段，第二次起写落地阶段（第 2 次）。 */
export function stageName(round: Pick<Round, "stage" | "seq">): string {
  return `${round.stage}阶段${againOf(round.seq)}`;
}

/** 从阶段的标识里取出版本、阶段名和第几次：v2-落地-3。认不出时返回 undefined。 */
export function parseRoundLabel(
  label: string,
): Pick<Round, "version" | "stage" | "seq"> | undefined {
  const match = /^v(\d+)-(构思|使用|检查|落地|提升)-(\d+)$/u.exec(label);
  if (match === null) return undefined;
  return { version: Number(match[1]), stage: match[2] as StageLabel, seq: Number(match[3]) };
}

/** 阶段的标识转成上下文已经说清是哪一版时的名字：落地阶段。认不出时原样交回。 */
export function stageNameOf(label: string): string {
  const round = parseRoundLabel(label);
  return round === undefined ? label : stageName(round);
}

/** 阶段的标识转成对用户写的名字。认不出时原样交回。 */
export function roundNameOf(label: string): string {
  const round = parseRoundLabel(label);
  return round === undefined ? label : roundName(round);
}

/** 一个阶段的页面的地址，标识只在地址里出现。 */
export function roundHref(pid: string, label: string): string {
  return `/p/${encodeURIComponent(pid)}/r/${encodeURIComponent(label)}`;
}
