// 主线每交一次是一次修订。对用户写的时候不叫「版」，「第 2 版」指产品的版本，见决定 211。
import { beijingDay, beijingMinute } from "@product-loop/model";
import { roundNameOf } from "@/lib/rounds";

type Revision = {
  readonly revision: number;
  /** 交上来的时间。 */
  readonly createdAt: string;
  /** 在哪个阶段里改的，写阶段的标识，例如 v2-落地-1。两个阶段之间交上来的为空。 */
  readonly round: string | null;
};

/** 目录里写的：修订 3，2026-09-29，第 2 版的落地阶段。两个阶段之间交的，没有最后一段。 */
export function revisionDay(revision: Revision): string {
  return revisionParts(revision, beijingDay).join("，");
}

/** 下拉里写的：日期精确到分。 */
export function revisionMinute(revision: Revision): string {
  return revisionParts(revision, beijingMinute).join("，");
}

function revisionParts(revision: Revision, time: (at: Date) => string): string[] {
  return [
    `修订 ${revision.revision}`,
    time(new Date(revision.createdAt)),
    ...(revision.round === null ? [] : [roundNameOf(revision.round)]),
  ];
}
