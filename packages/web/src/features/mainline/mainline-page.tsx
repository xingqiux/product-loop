// 主线页，见「06 工作台」第六节和场景 S10。
// 全文：右边是主线十个部分的目录，每个部分写最近一次改它的是哪次修订、哪天、哪个阶段，点了滚到那一节。能切到历史的修订。
// 比较：选两次修订逐行对比。场景：每个场景一行，步骤摊开成一串格子。
import { useQuery } from "@tanstack/react-query";
import { Markdown } from "@/components/markdown";
import { Notice } from "@/components/notice";
import { Segmented } from "@/components/segmented";
import { TextDiff } from "@/components/text-diff";
import { cx } from "@/lib/cx";
import { scrollBehavior } from "@/lib/motion";
import {
  mainlineDiffQuery,
  mainlinePartsQuery,
  mainlineRevisionQuery,
  mainlineRevisionsQuery,
  scenesQuery,
} from "@/lib/queries";
import { revisionDay, revisionMinute } from "./revision";

export type MainlineView = "text" | "diff" | "scenes";

export type MainlineSearch = {
  readonly view: MainlineView;
  readonly rev: number | undefined;
  readonly from: number | undefined;
  readonly to: number | undefined;
};

const selectClass =
  "rounded-md bg-primary px-2 py-1 text-ui ring-1 ring-secondary focus:outline-none focus:ring-2 focus:ring-brand";

/** 全文按 Markdown 画：标题、列表、表格、加粗和行内代码。二级标题带着行号当锚点，目录据此滚过去。 */
function Article({ text }: { text: string }) {
  return <Markdown text={text} className="min-w-0" />;
}

function TextView({ pid, rev }: { pid: string; rev: number }) {
  const revision = useQuery(mainlineRevisionQuery(pid, rev));
  const parts = useQuery(mainlinePartsQuery(pid));
  const revisions = useQuery(mainlineRevisionsQuery(pid));
  if (revision.isError) {
    return (
      <Notice kind="error" error={revision.error} onRetry={() => void revision.refetch()}>
        读不到修订 {rev}。
      </Notice>
    );
  }
  if (revision.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  const { text, parsed } = revision.data.data;
  const changes = parts.data?.data ?? [];
  // 目录里每个部分写最近一次改它的修订：哪天、哪个阶段。
  const saidOf = (n: number, round: string | null) => {
    const found = revisions.data?.data.find((r) => r.revision === n);
    return found === undefined
      ? `修订 ${n}`
      : revisionDay({ revision: n, createdAt: found.createdAt, round });
  };
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[1fr_16rem] lg:gap-10">
      <Article text={text} />
      {/* 窄的时候目录排到全文上面，收成一排按钮，只留名字；宽的时候在右边，每个部分再写一行改它的修订。 */}
      <aside className="flex flex-col gap-1 rounded-xl p-4 ring-1 ring-secondary max-lg:order-first max-lg:flex-row max-lg:flex-wrap max-lg:items-center max-lg:gap-2 max-lg:p-3 lg:sticky lg:top-6">
        <p className="pb-2 text-meta text-tertiary max-lg:pb-0 max-lg:pr-1">目录</p>
        {parsed.parts.map((entry) => {
          const change = changes.find((c) => c.part === entry.part);
          return (
            <button
              key={entry.part}
              type="button"
              disabled={!entry.present}
              onClick={() => {
                if (entry.present)
                  document
                    .getElementById(`line-${entry.heading.line}`)
                    ?.scrollIntoView({ behavior: scrollBehavior() });
              }}
              className="flex flex-col rounded-md px-2 py-1.5 text-left enabled:hover:bg-secondary max-lg:bg-secondary"
            >
              <span className={cx("text-ui", !entry.present && "text-quaternary")}>
                {entry.part}
              </span>
              <span className="text-label text-tertiary max-lg:hidden">
                {!entry.present || change?.revision == null
                  ? ""
                  : saidOf(change.revision, change.round)}
              </span>
            </button>
          );
        })}
      </aside>
    </div>
  );
}

function DiffView({ pid, from, to }: { pid: string; from: number; to: number }) {
  const diff = useQuery(mainlineDiffQuery(pid, from, to));
  if (diff.isError) {
    return (
      <Notice kind="error" error={diff.error} onRetry={() => void diff.refetch()}>
        读不到这两次修订的比较。
      </Notice>
    );
  }
  if (diff.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  const same = diff.data.data.rows.every((row) => row.k === "same" || row.k === "gap");
  return same ? (
    <Notice kind="empty">这两次修订全文相同。</Notice>
  ) : (
    <TextDiff rows={diff.data.data.rows} />
  );
}

function ScenesView({ pid }: { pid: string }) {
  const scenes = useQuery(scenesQuery(pid));
  if (scenes.isError) {
    return (
      <Notice kind="error" error={scenes.error} onRetry={() => void scenes.refetch()}>
        读不到场景。
      </Notice>
    );
  }
  if (scenes.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  if (scenes.data.data.length === 0) return <Notice kind="empty">没有场景</Notice>;
  return (
    <div className="flex flex-col gap-4">
      {scenes.data.data.map((scene) => (
        <section
          key={scene.id}
          className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-secondary"
        >
          <header className="flex flex-wrap items-baseline gap-2">
            <span className="text-meta text-tertiary">{scene.id}</span>
            <h3 className="text-heading">{scene.name}</h3>
            {scene.who !== null && <span className="text-meta text-tertiary">{scene.who}</span>}
            <span className="ml-auto text-label text-quaternary">
              修订 {scene.firstRevision} 起
            </span>
          </header>
          <ol className="grid gap-2 md:grid-cols-3 xl:grid-cols-4">
            {scene.steps.map((step) => (
              <li key={step.step} className="flex flex-col gap-1 rounded-lg bg-secondary p-3">
                <span className="text-label text-tertiary">第 {step.step} 步</span>
                <span className="text-ui">{step.do}</span>
                <span className="text-meta text-tertiary">→ {step.expect}</span>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}

export function MainlinePage({
  pid,
  search,
  onSearch,
}: {
  pid: string;
  search: MainlineSearch;
  onSearch: (next: Partial<MainlineSearch>) => void;
}) {
  const revisions = useQuery(mainlineRevisionsQuery(pid));
  if (revisions.isError) {
    return (
      <Notice kind="error" error={revisions.error} onRetry={() => void revisions.refetch()}>
        读不到主线。
      </Notice>
    );
  }
  if (revisions.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  const list = revisions.data.data;
  if (list.length === 0) return <Notice kind="empty">没有主线</Notice>;
  const latest = list.at(-1)?.revision ?? 1;
  const rev = search.rev ?? latest;
  const to = search.to ?? latest;
  const from = search.from ?? Math.max(1, to - 1);
  const picker = (value: number, onPick: (value: number) => void, name: string) => (
    <select
      aria-label={name}
      value={value}
      onChange={(e) => onPick(Number(e.target.value))}
      className={selectClass}
    >
      {[...list].reverse().map((r) => (
        <option key={r.revision} value={r.revision}>
          {revisionMinute(r)}
        </option>
      ))}
    </select>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          label="主线视图"
          value={search.view}
          options={[
            ["text", "全文"],
            ["diff", "原文比较"],
            ["scenes", "场景"],
          ]}
          onChange={(view) => onSearch({ view })}
        />
        {search.view === "text" && picker(rev, (value) => onSearch({ rev: value }), "修订")}
        {search.view === "diff" && (
          <>
            {picker(from, (value) => onSearch({ from: value }), "起点修订")}
            <span className="text-meta text-tertiary">改成</span>
            {picker(to, (value) => onSearch({ to: value }), "终点修订")}
          </>
        )}
      </div>
      {search.view === "text" && <TextView pid={pid} rev={rev} />}
      {search.view === "diff" && <DiffView pid={pid} from={from} to={to} />}
      {search.view === "scenes" && <ScenesView pid={pid} />}
    </div>
  );
}
