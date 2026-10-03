// 页头和阶段条：第几版的哪个阶段、给出的日期，这个阶段有几页；阶段条是五个阶段各走了几次、队列里各有几件。
// 状态都按现在的数据算，同一屏上的页头、阶段条写的是同一个状态。日期取这一页给出的那一天，迁移进来的历史页
// 存下的填充部分是迁移那天算的，不用它。
// 页签上的「已撤回」只写在别的页上，正在看的这一页由提交区写，不写两遍。
import { beijingDay, type StageLabel } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { RoundMark } from "@/components/round-mark";
import { StateBadge } from "@/components/state-badge";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";
import { statusQuery, versionsQuery } from "@/lib/queries";
import { roundName, roundState, roundStateText, stageNameOf } from "@/lib/rounds";
import { stageCellOf } from "@/lib/stage-cell";
import { usePage } from "../context";
import { stripColumns } from "../model";

type RoundView = {
  readonly version: number;
  readonly stage: StageLabel;
  readonly seq: number;
  readonly status: string;
  readonly label: string;
};
type PageRef = { readonly id: number; readonly seq: number; readonly status: string };

// 和项目页的版本格同一套：等用户回复实心蓝，进行中空心蓝框，已收尾实心灰，符号见 RoundMark。
const blockTone = {
  waiting: "bg-fg-brand-primary",
  working: "bg-primary ring-2 ring-inset ring-fg-brand-primary",
  closed: "bg-fg-quaternary",
} as const;

export function PageHead({
  round,
  pages,
  onPage,
}: {
  round: RoundView;
  pages: readonly PageRef[];
  onPage: (seq: number) => void;
}) {
  const { pid, page } = usePage();
  const { header, strip } = page.fill;
  const day = beijingDay(new Date(page.presentedAt));
  const versions = useQuery(versionsQuery(pid));
  const status = useQuery(statusQuery(pid));
  const columns = stripColumns(
    strip.stages,
    { versions: versions.data?.data, queue: status.data?.data.queue },
    round.version,
  );
  return (
    <div className="flex flex-col gap-3 border-b border-secondary pb-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-title">{roundName(round)}</h1>
        <StateBadge state={roundState(round.status)} />
        <span className="text-meta text-tertiary">{day}</span>
        {pages.length > 1 && (
          <nav aria-label="这个阶段的几页" className="ml-auto flex items-center gap-1.5">
            {pages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPage(p.seq)}
                aria-current={p.id === page.id ? "page" : undefined}
                className={cx(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1 text-ui ring-1 transition-colors duration-(--duration-hover)",
                  p.id === page.id
                    ? "bg-primary font-medium text-primary ring-2 ring-fg-brand-primary"
                    : "text-tertiary ring-secondary hover:bg-secondary_hover hover:text-secondary",
                )}
              >
                第 {p.seq} 页
                {p.status === "已撤回" && p.id !== page.id && (
                  <span className="text-label font-normal text-quaternary">已撤回</span>
                )}
              </button>
            ))}
          </nav>
        )}
      </div>
      <ol className="grid grid-cols-5 gap-2">
        {columns.map((stage) => {
          // 一个阶段做过很多次时只摆最近几次和正在看的这一次，其余写成次数，和项目页的进度格子一样。
          const { shown, many } = stageCellOf(stage.rounds, (r) => r.label === header.round);
          return (
            <li
              key={stage.stage}
              className={cx(
                "flex flex-col gap-1 rounded-lg px-3 py-1.5 ring-1",
                stage.stage === header.stage ? "ring-fg-brand-primary" : "ring-secondary",
              )}
            >
              <span className="flex items-baseline justify-between text-label">
                <span
                  className={
                    stage.stage === header.stage ? "text-brand-secondary" : "text-secondary"
                  }
                >
                  {stage.stage}
                </span>
                {/* 件数的算法和首页、概览相同，零也写 0。 */}
                <span className="text-quaternary tabular-nums">队列 {stage.queue}</span>
              </span>
              <span className="flex flex-wrap gap-1">
                {shown.map((r) => (
                  <motion.span
                    key={r.label}
                    layout
                    transition={motionTokens.stage}
                    title={`${stageNameOf(r.label)}，${roundStateText[roundState(r.status)]}`}
                    className={cx(
                      "rounded-sm",
                      r.label === header.round &&
                        "outline-2 outline-offset-1 outline-fg-brand-primary",
                    )}
                  >
                    <RoundMark
                      look={roundState(r.status)}
                      size="sm"
                      className={blockTone[roundState(r.status)]}
                    />
                  </motion.span>
                ))}
              </span>
              {many && (
                <span className="text-label text-quaternary">共 {stage.rounds.length} 次</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
