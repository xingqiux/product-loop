import { beijingDay } from "@product-loop/model";
import { roundNameOf } from "@/lib/rounds";

type QueueItemView = {
  readonly stage: string;
  readonly status: string;
  readonly statusNote?: string | undefined;
  readonly proposer: string;
  readonly proposedIn?: string | undefined;
  readonly createdAt: string;
  readonly dependsOn?: string | undefined;
  readonly acceptance?: string | undefined;
  readonly evidence?: string | undefined;
  readonly source?: string | undefined;
  readonly note?: string | undefined;
};

/**
 * 展示卡片里一件队列事项的属性表。编号不写在表里；
 * 提出时的阶段写阶段的名字。没有值的属性整行不写，不补一句「无」。
 * 备注是内容放不下的细节，摆在第一行，紧接着标题里的内容；备注里的换行照样分段。
 */
export function queueAttrs(item: QueueItemView): readonly (readonly [string, string])[] {
  const optional = (name: string, value: string | undefined): (readonly [string, string])[] =>
    value === undefined || value.trim() === "" ? [] : [[name, value]];
  return [
    ...optional("备注", item.note),
    ["阶段", item.stage],
    ["状态", item.statusNote === undefined ? item.status : `${item.status}，${item.statusNote}`],
    [
      "提出",
      `${item.proposer}${item.proposedIn === undefined ? "" : `，${roundNameOf(item.proposedIn)}`}`,
    ],
    ["加入时间", beijingDay(new Date(item.createdAt))],
    ...optional("依赖", item.dependsOn),
    ...optional("验收标准", item.acceptance),
    ...optional("完成证据", item.evidence),
    ...optional("来源", item.source),
  ];
}
