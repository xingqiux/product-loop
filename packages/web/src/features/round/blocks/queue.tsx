// 队列看板：等待的事放在上面，其余按阶段分五列，停滞的淡一些。
// 点一张小卡出展示卡片，页面上能做的只有「取消这一项」，点了记进草稿。下面一行列出这个阶段做完的事。
// 卡上写事项的内容，不写编号。
import { Check } from "@untitledui/icons";
import { useState } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { cardSurface, showsStatus, statusTone } from "@/features/queue/card-look";
import { columnHead, waitingIn } from "@/features/queue/count";
import { queueAttrs } from "@/features/queue/sheet-attrs";
import { cx } from "@/lib/cx";
import { type Fill, usePage } from "../context";
import { useDraft } from "../draft-store";
import { queueField } from "../model";
import { NoteField } from "../note-field";
import { Sheet, type SheetItem } from "../sheet";

type Item = Fill["queue"]["waiting"][number];

export function QueueBlock() {
  const { page, readOnly } = usePage();
  const { waiting, columns, doneThisRound } = page.fill.queue;
  const entries = useDraft((state) => state.entries);
  const update = useDraft((state) => state.update);
  const [at, setAt] = useState<number | undefined>();
  const all = [...waiting, ...columns.flatMap((column) => column.items)];
  const dropped = (item: Item) => entries[queueField(item.id)]?.pick === "取消";
  const sheet = (item: Item): SheetItem => ({
    title: item.content,
    attrs: queueAttrs(item),
    list: item.subItems,
    listLabel: "子项",
    foot: readOnly ? undefined : (
      <div className="flex flex-col gap-3">
        <Button
          color={dropped(item) ? "primary-destructive" : "secondary"}
          iconLeading={dropped(item) ? Check : undefined}
          className="self-start"
          onClick={() => update(queueField(item.id), { pick: dropped(item) ? undefined : "取消" })}
        >
          取消这一项
        </Button>
        {dropped(item) && (
          <NoteField field={queueField(item.id)} readOnly={false} placeholder="取消的原因" />
        )}
      </div>
    ),
  });
  const card = (item: Item, showStage = false) => (
    <button
      key={item.id}
      type="button"
      onClick={() => setAt(all.indexOf(item))}
      className={cx(
        "flex w-full flex-col gap-1 rounded-lg p-3 text-left",
        cardSurface(item.stale),
        dropped(item) && "line-through opacity-50",
      )}
    >
      {(showsStatus(item.status) || item.stale || showStage) && (
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
    </button>
  );
  return (
    <div className="@container flex flex-col gap-5">
      <header className="flex items-baseline gap-3">
        <h2 className="text-title">队列</h2>
      </header>
      {waiting.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl bg-secondary p-3">
          <p className="text-meta text-tertiary">等待 {waiting.length}</p>
          <div className="grid gap-2 @xl:grid-cols-2 @3xl:grid-cols-3">
            {waiting.map((item) => card(item, true))}
          </div>
        </section>
      )}
      <div className="grid gap-3 @xl:grid-cols-2 @3xl:grid-cols-3 @5xl:grid-cols-5">
        {columns.map((column) => (
          <section
            key={column.stage}
            className={cx(
              "flex min-w-0 flex-col gap-2 rounded-xl bg-secondary p-3",
              column.stage === page.stage && "ring-1 ring-fg-brand-primary",
            )}
          >
            <p className="flex justify-between text-meta text-tertiary">
              <span>{column.stage}</span>
              <span
                className={cx(
                  "tabular-nums",
                  column.items.length + waitingIn(waiting, column.stage) === 0 && "text-quaternary",
                )}
              >
                {columnHead(column.items.length, waitingIn(waiting, column.stage))}
              </span>
            </p>
            {column.items.map((item) => card(item))}
          </section>
        ))}
      </div>
      {doneThisRound.length > 0 && (
        <section className="flex flex-col gap-2 border-t border-secondary pt-4">
          <p className="text-meta text-tertiary">这个阶段做完的</p>
          {/* 横着排成一串，一件一块，证据写在内容下面。 */}
          <ul className="flex flex-wrap gap-2">
            {doneThisRound.map((item) => (
              <li
                key={item.id}
                className="flex max-w-80 flex-col gap-0.5 rounded-lg bg-success-primary px-3 py-2"
              >
                <span className="text-ui">{item.content}</span>
                {item.evidence !== null && (
                  <span className="text-meta text-tertiary">{item.evidence}</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      <Sheet items={all.map(sheet)} at={at} onAt={setAt} />
    </div>
  );
}
