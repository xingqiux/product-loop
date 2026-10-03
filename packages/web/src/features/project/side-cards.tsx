// 第三块和第四块：队列的摘要，主线和决定。见「06 工作台」第三节。
import { mainlinePart } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check } from "@untitledui/icons";
import { AppLink } from "@/components/app-link";
import { revisionDay } from "@/features/mainline/revision";
import { cx } from "@/lib/cx";
import {
  decisionsQuery,
  mainlineRevisionsQuery,
  queueBoardQuery,
  queueQuery,
  statusQuery,
} from "@/lib/queries";

const stages = ["构思", "使用", "检查", "落地", "提升"] as const;

function Card({
  title,
  more,
  children,
}: {
  title: string;
  more?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-xl p-5 ring-1 ring-secondary">
      <div className="flex items-center justify-between">
        <h2 className="text-ui font-semibold">{title}</h2>
        {more}
      </div>
      {children}
    </section>
  );
}

function More({ pid, to, label }: { pid: string; to: string; label: string }) {
  return (
    <AppLink
      to={to}
      params={{ project: pid }}
      className="flex min-h-6 items-center gap-1 text-meta text-brand-secondary hover:underline"
    >
      {label}
      <ArrowRight className="size-3.5" />
    </AppLink>
  );
}

export function QueueCard({ pid }: { pid: string }) {
  const status = useQuery(statusQuery(pid));
  const queue = useQuery(queueQuery(pid));
  const counts = status.data?.data.queue ?? [];
  const open = (queue.data?.data ?? []).filter(
    (item) => item.status !== "已完成" && item.status !== "已取消",
  );
  const waiting = open.filter((item) => item.status === "等待");
  const board = useQuery(queueBoardQuery(pid));
  const live =
    board.data === undefined
      ? []
      : [...board.data.data.waiting, ...board.data.data.columns.flatMap((c) => c.items)];
  const stale = live.filter((item) => item.stale);
  const recent = [...open].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);
  return (
    <Card title="队列" more={<More pid={pid} to="/p/$project/queue" label="看板" />}>
      <div className="grid grid-cols-5 gap-2">
        {stages.map((stage) => {
          const count = counts.find((item) => item.stage === stage)?.count ?? 0;
          return (
            <div key={stage} className="rounded-lg px-3 py-2 ring-1 ring-secondary">
              <p className={cx("text-heading tabular-nums", count === 0 && "text-quaternary")}>
                {count}
              </p>
              <p className="text-meta text-tertiary">{stage}</p>
            </div>
          );
        })}
      </div>
      {(waiting.length > 0 || stale.length > 0) && (
        <div className="flex flex-col gap-1.5 text-meta">
          {waiting.length > 0 && (
            <p>
              <span className="mr-2 text-warning-primary">等待</span>
              {waiting.length} 件
            </p>
          )}
          {stale.length > 0 && (
            <p>
              <span className="mr-2 text-warning-primary">停滞</span>
              {stale.length} 件
            </p>
          )}
        </div>
      )}
      {recent.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-secondary pt-4">
          <p className="text-meta text-tertiary">最近加入</p>
          {recent.map((item) => (
            <p key={item.id} className="flex gap-3 text-ui">
              <span className="shrink-0 text-meta text-tertiary">{item.stage}</span>
              <span className="line-clamp-1" title={item.content}>
                {item.content}
              </span>
            </p>
          ))}
        </div>
      )}
    </Card>
  );
}

export function MainlineCard({ pid }: { pid: string }) {
  const status = useQuery(statusQuery(pid));
  const revisions = useQuery(mainlineRevisionsQuery(pid));
  const missing = new Set<string>(status.data?.data.mainline.missingParts ?? []);
  const latest = revisions.data?.data.at(-1);
  return (
    <Card title="主线" more={<More pid={pid} to="/p/$project/mainline" label="读全文" />}>
      {latest !== undefined && <p className="text-meta text-tertiary">{revisionDay(latest)}</p>}
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {(status.data === undefined ? [] : mainlinePart.labels).map((part) => (
          <li key={part} className="flex items-center gap-2 text-ui">
            {missing.has(part) ? (
              <span className="size-3.5 rounded-full ring-1 ring-fg-quaternary ring-inset" />
            ) : (
              <Check className="size-3.5 text-fg-success-primary" />
            )}
            <span className={cx(missing.has(part) && "text-tertiary")}>{part}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function DecisionsCard({ pid }: { pid: string }) {
  const decisions = useQuery(decisionsQuery(pid));
  const recent = [...(decisions.data?.data ?? [])].sort((a, b) => b.id - a.id).slice(0, 5);
  return (
    <Card title="决定" more={<More pid={pid} to="/p/$project/decisions" label="全部" />}>
      {recent.length > 0 && (
        <ul className="flex flex-col gap-2.5">
          {recent.map((decision) => (
            <li key={decision.id} className="flex gap-3 text-ui">
              <span className="w-8 shrink-0 text-meta text-tertiary tabular-nums">
                {decision.id}
              </span>
              <span className="line-clamp-2" title={decision.decision}>
                {decision.decision}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
