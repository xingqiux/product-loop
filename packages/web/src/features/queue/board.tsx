// 队列看板，见「06 工作台」第五节和场景 S9。
// 等待的事放在上面，写明依赖和属于哪个阶段；其余按阶段分五列，每列先摆八件；停滞的淡一些。
// 列头写这一列自己的件数，另有几件在上面等待；两个数加起来就是首页和概览写的那个数，见 count.ts。
// 点一张小卡出展示卡片：各项属性、状态变化、出现阶段。卡片换列时移过去。
// 卡上写事项的内容，不写编号。
import { beijingMinute } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { Notice } from "@/components/notice";
import { FromLine } from "@/features/round/from-line";
import { Sheet } from "@/features/round/sheet";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";
import { queueBoardQuery, queueItemQuery } from "@/lib/queries";
import { roundHref, roundNameOf } from "@/lib/rounds";
import { cardSurface, showsStatus, statusTone } from "./card-look";
import { columnHead, waitingIn } from "./count";
import { queueAttrs } from "./sheet-attrs";

type Board = Awaited<
  ReturnType<NonNullable<ReturnType<typeof queueBoardQuery>["queryFn"]>>
>["data"];
type Item = Board["waiting"][number];

const perColumn = 8;

function ItemCard({
  item,
  onOpen,
  showStage = false,
}: {
  item: Item;
  onOpen: () => void;
  /** 等待区的小卡不在阶段列里，卡上写明属于哪个阶段。 */
  showStage?: boolean;
}) {
  const head = showsStatus(item.status) || showStage || item.stale;
  return (
    <motion.button
      layout
      layoutId={item.id}
      transition={motionTokens.card}
      type="button"
      data-item={item.id}
      onClick={onOpen}
      className={cx("w-full rounded-lg p-3 text-left", cardSurface(item.stale))}
    >
      <span className="flex flex-col gap-1">
        {head && (
          <span className="flex justify-between gap-2 text-label">
            <span className={statusTone.get(item.status)}>
              {showsStatus(item.status) ? item.status : ""}
            </span>
            <span className="flex gap-2 text-tertiary">
              {showStage && <span>{item.stage}</span>}
              {item.stale && <span>停滞</span>}
            </span>
          </span>
        )}
        <span className="text-ui">{item.content}</span>
        {item.status === "等待" && item.dependsOn !== undefined && (
          <span className="text-meta text-tertiary">{item.dependsOn}</span>
        )}
      </span>
    </motion.button>
  );
}

/** 展示卡片下面的来源、状态变化和出现阶段，打开时才读。 */
function Detail({ pid, qid }: { pid: string; qid: string }) {
  const detail = useQuery(queueItemQuery(pid, qid));
  if (detail.isError) {
    return (
      <Notice kind="error" size="inline" error={detail.error} onRetry={() => void detail.refetch()}>
        读不到这件事的记录。
      </Notice>
    );
  }
  if (detail.data === undefined) {
    return (
      <Notice kind="loading" size="inline">
        正在读取
      </Notice>
    );
  }
  const { item, events, appearances } = detail.data.data;
  return (
    <div className="flex flex-col gap-5">
      {item.fromLine !== undefined && (
        <FromLine pid={pid} submission={item.fromLine.submission} line={item.fromLine.line} />
      )}
      <div className="grid gap-5 md:grid-cols-2">
        <section className="flex flex-col gap-2">
          <p className="text-meta text-tertiary">状态变化</p>
          <ol className="flex flex-col gap-1.5 text-ui">
            {events.map((event) => (
              <li key={`${event.at}-${event.from ?? ""}-${event.to}`} className="flex gap-3">
                <span className="shrink-0 text-meta text-tertiary tabular-nums">
                  {beijingMinute(new Date(event.at))}
                </span>
                <span>
                  {event.from === undefined
                    ? `加入队列，${event.to}`
                    : `${event.from} → ${event.to}`}
                  {event.round !== undefined && (
                    <span className="ml-2 text-meta text-tertiary">{roundNameOf(event.round)}</span>
                  )}
                  {event.note !== undefined && (
                    <span className="block text-meta text-tertiary">{event.note}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </section>
        {appearances.length > 0 && (
          <section className="flex flex-col gap-2">
            <p className="text-meta text-tertiary">出现阶段</p>
            <ul className="flex flex-col gap-1.5 text-ui">
              {appearances.map((seen) => (
                <li key={`${seen.page}-${seen.card}`}>
                  <a
                    href={`${roundHref(pid, seen.round)}?item=${encodeURIComponent(seen.card)}`}
                    className="text-brand-secondary hover:underline"
                  >
                    {roundNameOf(seen.round)}
                  </a>
                  <span className="ml-2">{seen.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

export function QueueBoard({ pid }: { pid: string }) {
  const board = useQuery(queueBoardQuery(pid));
  const [at, setAt] = useState<number | undefined>();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  if (board.isError) {
    return (
      <Notice kind="error" error={board.error} onRetry={() => void board.refetch()}>
        读不到队列。
      </Notice>
    );
  }
  if (board.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  const { waiting, columns } = board.data.data;
  const all = [...waiting, ...columns.flatMap((column) => column.items)];
  const open = (item: Item) => setAt(all.indexOf(item));
  const sheets = all.map((item) => ({
    title: item.content,
    attrs: queueAttrs(item),
    list: item.subItems,
    listLabel: "子项",
    foot: <Detail pid={pid} qid={item.id} />,
  }));
  return (
    <LayoutGroup>
      {/* 列数跟着这一块自己的宽度走，半屏的窗口里不挤成窄条，也不出横向滚动条。 */}
      <div className="@container flex flex-col gap-5">
        {waiting.length > 0 && (
          <section className="flex flex-col gap-2 rounded-xl bg-secondary p-3">
            <p className="text-meta text-tertiary">等待 {waiting.length}</p>
            <div className="grid gap-2 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-4">
              {waiting.map((item) => (
                <ItemCard key={item.id} item={item} onOpen={() => open(item)} showStage />
              ))}
            </div>
          </section>
        )}
        <div className="grid items-start gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
          {columns.map((column) => {
            const more = column.items.length - perColumn;
            const shown = expanded.has(column.stage)
              ? column.items
              : column.items.slice(0, perColumn);
            return (
              <section
                key={column.stage}
                className="flex min-w-0 flex-col gap-2 rounded-xl bg-secondary p-3"
              >
                <p className="flex justify-between text-meta text-tertiary">
                  <span>{column.stage}</span>
                  <span
                    className={cx(
                      "tabular-nums",
                      column.items.length + waitingIn(waiting, column.stage) === 0 &&
                        "text-quaternary",
                    )}
                  >
                    {columnHead(column.items.length, waitingIn(waiting, column.stage))}
                  </span>
                </p>
                {shown.map((item) => (
                  <ItemCard key={item.id} item={item} onOpen={() => open(item)} />
                ))}
                {more > 0 && !expanded.has(column.stage) && (
                  <button
                    type="button"
                    onClick={() => setExpanded(new Set([...expanded, column.stage]))}
                    className="inline-flex min-h-6 items-center text-meta text-brand-secondary hover:underline"
                  >
                    还有 {more} 件
                  </button>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <Sheet items={sheets} at={at} onAt={setAt} />
    </LayoutGroup>
  );
}
