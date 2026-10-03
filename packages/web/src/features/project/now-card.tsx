// 第二块：现在。当前的阶段、在等的页、这个阶段拿出来的事做到哪里。见「06 工作台」第三节。
import { beijingMinute } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight } from "@untitledui/icons";
import { Button } from "@/components/ui/base/buttons/button";
import { cx } from "@/lib/cx";
import { roundQuery, statusQuery } from "@/lib/queries";
import { roundHref, roundName, versionIdleText } from "@/lib/rounds";

type Detail = NonNullable<ReturnType<typeof useRound>["data"]>["data"];
type Item = Detail["items"][number];

function useRound(pid: string, label: string | undefined) {
  return useQuery({ ...roundQuery(pid, label ?? ""), enabled: label !== undefined });
}

const groups = [
  { key: "done", label: "做完的", dot: "bg-fg-success-primary" },
  { key: "doing", label: "进行中的", dot: "bg-fg-brand-primary" },
  { key: "returned", label: "要退回的", dot: "bg-fg-warning-primary" },
] as const;

/**
 * 阶段没收尾时结果还是空的，做完的事已经分出来：队列里已完成的进「做完的」，别的进「进行中的」。
 * 收尾以后按记下的结果分。
 */
function groupOf(item: Item): (typeof groups)[number]["key"] | undefined {
  if (item.result === null) return item.item.status === "已完成" ? "done" : "doing";
  if (item.result === "做完") return "done";
  if (item.result === "退回") return "returned";
  return undefined;
}

export function NowCard({ pid }: { pid: string }) {
  const status = useQuery(statusQuery(pid));
  const round = status.data?.data.round ?? null;
  const waiting = status.data?.data.waitingPages[0];
  const detail = useRound(pid, round?.label);
  return (
    <section className="flex flex-col gap-4 rounded-xl p-5 ring-1 ring-secondary">
      <h2 className="text-ui font-semibold">现在</h2>
      {round === null ? (
        <p className="text-ui text-tertiary">
          {status.data === undefined ? "" : versionIdleText(status.data.data.version.version)}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-secondary px-4 py-3 ring-1 ring-secondary">
            <div className="flex flex-col gap-0.5">
              <p className="text-ui font-semibold">{roundName(round)}</p>
              <p className="text-meta text-tertiary">
                {waiting === undefined
                  ? `${beijingMinute(new Date(round.startedAt))} 开始`
                  : `${beijingMinute(new Date(waiting.presentedAt))} 给出`}
              </p>
            </div>
            {waiting !== undefined && (
              <Button
                color="primary"
                iconTrailing={ArrowRight}
                href={roundHref(pid, waiting.round)}
              >
                打开这一页
              </Button>
            )}
          </div>
          {detail.data !== undefined && <Items items={detail.data.data.items} />}
        </>
      )}
    </section>
  );
}

function Items({ items }: { items: readonly Item[] }) {
  if (items.length === 0) return null;
  // 三组一组一段往下排：句子按整张卡的宽度换行，不再挤在三分之一宽的窄列里。
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group) => {
        const list = items.filter((item) => groupOf(item) === group.key);
        // 没有的不写，不写「进行中的 0」。
        if (list.length === 0) return null;
        return (
          <div key={group.key} className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-meta text-tertiary">
              <span className={cx("size-1.5 rounded-full", group.dot)} />
              {group.label}
              <span className="tabular-nums">{list.length}</span>
            </p>
            {list.map((item) => (
              <div key={item.item.id} className="flex flex-col gap-0.5">
                <p className="text-ui">{item.item.content}</p>
                {item.note !== null && <p className="text-meta text-tertiary">{item.note}</p>}
                {item.returnedTo !== null && (
                  <p className="text-meta text-tertiary">退回到{item.returnedTo}</p>
                )}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
