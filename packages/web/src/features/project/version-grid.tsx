// 第一块：进度，版本和阶段。每版一行，五个阶段五列，每个阶段一个小方块。见「06 工作台」第三节。

import { beijingDay } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { XClose } from "@untitledui/icons";
import { useState } from "react";
import { Link as AriaLink } from "react-aria-components";
import { Notice } from "@/components/notice";
import { type Look, RoundMark } from "@/components/round-mark";
import { Dialog, Modal, ModalOverlay } from "@/components/ui/application/modals/modal";
import { Tooltip } from "@/components/ui/base/tooltip/tooltip";
import { versionsQuery } from "@/lib/queries";
import { roundHref, roundName, roundState, stageName } from "@/lib/rounds";
import { stageCellOf } from "@/lib/stage-cell";

const stages = ["构思", "使用", "检查", "落地", "提升"] as const;

const looks: Record<Look, { label: string; className: string }> = {
  waiting: { label: "等用户回复", className: "bg-fg-brand-primary" },
  working: { label: "进行中", className: "bg-primary ring-2 ring-inset ring-fg-brand-primary" },
  closed: { label: "已收尾", className: "bg-fg-quaternary" },
  unfinished: { label: "未收尾", className: "bg-fg-warning-primary" },
};

type Versions = NonNullable<ReturnType<typeof useVersions>["data"]>["data"];
type Round = Versions[number]["rounds"][number];

function useVersions(pid: string) {
  return useQuery(versionsQuery(pid));
}

/** 方块的样子。不是最近一个阶段、又没收尾的，算未收尾。 */
function lookOf(round: Round, latest: string | undefined): Look {
  const state = roundState(round.status);
  if (state === "closed") return "closed";
  if (round.label !== latest) return "unfinished";
  return state === "waiting" ? "waiting" : "working";
}

/** 这一版从哪天起。迁移进来的第 1 版建得比它的阶段晚，取两者中早的。 */
function startOf(version: Versions[number]): Date {
  const times = [version.startedAt, ...version.rounds.map((round) => round.startedAt)];
  return new Date(Math.min(...times.map((time) => new Date(time).getTime())));
}

export function VersionGrid({ pid }: { pid: string }) {
  const versions = useVersions(pid);
  const list = versions.data?.data ?? [];
  const latest = list.at(-1)?.rounds.at(-1)?.label;
  // 最近的一版在最上面，和首页、决定页一样，最近的在前。
  const newestFirst = [...list].reverse();
  return (
    <section className="flex flex-col gap-4 rounded-xl p-4 ring-1 ring-secondary wide:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-ui font-semibold">进度</h2>
        <div className="flex flex-wrap gap-4 text-meta text-tertiary">
          {(Object.keys(looks) as Look[]).map((look) => (
            <span key={look} className="flex items-center gap-1.5">
              <RoundMark look={look} size="sm" className={looks[look].className} />
              {looks[look].label}
            </span>
          ))}
        </div>
      </div>
      {versions.isError ? (
        <Notice
          kind="error"
          size="block"
          error={versions.error}
          onRetry={() => void versions.refetch()}
        >
          读不到版本。
        </Notice>
      ) : versions.isPending ? (
        <Notice kind="loading" size="block">
          正在读取
        </Notice>
      ) : list.length === 0 ? null : (
        // 五个阶段的列平分剩下的宽度，方块在格子里换行，所以半屏的窗口里也不出横向滚动条。
        <div className="overflow-hidden rounded-lg ring-1 ring-secondary">
          <table className="w-full table-fixed text-left">
            <thead className="bg-secondary text-meta text-tertiary">
              <tr>
                <th className="w-24 px-2 py-2 font-normal wide:w-40 wide:px-3">版本</th>
                {stages.map((stage) => (
                  <th
                    key={stage}
                    className="border-l border-secondary px-2 py-2 font-normal wide:px-3"
                  >
                    {stage}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {newestFirst.map((version) => (
                <tr key={version.version} className="align-top">
                  <td className="px-2 py-3 wide:px-3">
                    <p className="text-ui font-semibold">第 {version.version} 版</p>
                    <p className="text-meta text-tertiary">{beijingDay(startOf(version))} 起</p>
                    {version.summary !== null && (
                      <p className="mt-1 text-meta text-tertiary">{version.summary}</p>
                    )}
                  </td>
                  {stages.map((stage) => {
                    const rounds = version.rounds.filter((round) => round.stage === stage);
                    return (
                      <td key={stage} className="border-l border-secondary px-2 py-3 wide:px-3">
                        <StageCell
                          pid={pid}
                          version={version.version}
                          stage={stage}
                          rounds={rounds}
                          latest={latest}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RoundBlock({ pid, round, look }: { pid: string; round: Round; look: Look }) {
  const name = roundName(round);
  return (
    <Tooltip
      title={name}
      description={
        round.summary ?? `${looks[look].label}，${beijingDay(new Date(round.startedAt))} 开始`
      }
    >
      {/* 进到历史的一次阶段只有这一个入口，至少 24 像素见方，手指和鼠标都点得中。 */}
      <AriaLink
        href={roundHref(pid, round.label)}
        aria-label={name}
        aria-description={looks[look].label}
        className="block rounded-md outline-focus-ring focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <RoundMark look={look} size="md" className={looks[look].className} />
      </AriaLink>
    </Tooltip>
  );
}

/**
 * 一版里一个阶段的格子：最近的几次是方块，下面写次数。多于五次时次数写成「全部 N 次」，
 * 点开列出每一次，每一次都能点进去。
 */
function StageCell({
  pid,
  version,
  stage,
  rounds,
  latest,
}: {
  pid: string;
  version: number;
  stage: string;
  rounds: readonly Round[];
  latest: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (rounds.length === 0) return null;
  const { shown, many, countText } = stageCellOf(rounds);
  return (
    <>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((round) => (
          <RoundBlock key={round.label} pid={pid} round={round} look={lookOf(round, latest)} />
        ))}
      </div>
      {many ? (
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="mt-1 inline-flex min-h-6 items-center text-meta text-brand-secondary hover:underline"
        >
          {countText}
        </button>
      ) : (
        <p className="mt-2 text-meta text-tertiary">{countText}</p>
      )}
      {many && (
        <ModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable>
          <Modal className="max-w-md">
            <Dialog aria-label={`第 ${version} 版的${stage}阶段，全部 ${rounds.length} 次`}>
              <div className="flex flex-col gap-4 p-6">
                <header className="flex items-start gap-3">
                  <h3 className="flex-1 text-heading">
                    第 {version} 版的{stage}阶段
                  </h3>
                  <span className="text-meta text-tertiary tabular-nums">{rounds.length} 次</span>
                  <button
                    type="button"
                    aria-label="关掉"
                    onClick={() => setOpen(false)}
                    className="flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
                  >
                    <XClose className="size-5" />
                  </button>
                </header>
                <ol className="flex max-h-[60vh] flex-col divide-y divide-secondary overflow-y-auto">
                  {[...rounds].reverse().map((round) => {
                    const look = lookOf(round, latest);
                    return (
                      <li key={round.label}>
                        <AriaLink
                          href={roundHref(pid, round.label)}
                          className="flex min-h-10 items-center gap-3 py-2 text-ui outline-focus-ring hover:underline focus-visible:outline-2 focus-visible:outline-offset-2"
                        >
                          <RoundMark look={look} size="sm" className={looks[look].className} />
                          <span className="flex-1">{stageName(round)}</span>
                          <span className="text-meta text-tertiary">{looks[look].label}</span>
                          <span className="w-24 text-right text-meta text-tertiary tabular-nums">
                            {beijingDay(new Date(round.startedAt))}
                          </span>
                        </AriaLink>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </Dialog>
          </Modal>
        </ModalOverlay>
      )}
    </>
  );
}
