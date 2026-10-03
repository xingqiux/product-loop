// skill 的问题页，见「06 工作台」第七节和场景 S11。
// 第一部分是各项目报上来的问题，一条一行，按下出展示卡片。卡片只读：状态由维护 skill 的会话用命令改
// （决定 225 把维护命令限定在产品循环自己的项目里，网页上人人可改不合），工作台只看。
// 第二部分是三类信号，由后端从数据里算出，点项目名进到项目页。
import type { skillIssueStatus } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { AppLink } from "@/components/app-link";
import { Notice } from "@/components/notice";
import { RowButton, rowClass } from "@/components/row-button";
import { Sheet } from "@/features/round/sheet";
import { cx } from "@/lib/cx";
import { skillIssuesQuery, skillSignalsQuery } from "@/lib/queries";
import { roundNameOf } from "@/lib/rounds";
import { sinceText } from "@/lib/time";

type Label = (typeof skillIssueStatus.labels)[number];

function useIssues() {
  return useQuery(skillIssuesQuery);
}

const tone = new Map<string, string>([
  ["新", "text-brand-secondary"],
  ["已理解", "text-secondary"],
  ["已确认", "text-secondary"],
  ["已改", "text-success-primary"],
  ["不改", "text-tertiary"],
]);

function StatusBadge({ status }: { status: Label }) {
  return (
    <span
      className={cx(
        "inline-flex rounded-md bg-secondary px-1.5 py-0.5 text-label whitespace-nowrap ring-1 ring-secondary ring-inset",
        tone.get(status),
      )}
    >
      {status}
    </span>
  );
}

function IssuesPart() {
  const issues = useIssues();
  const [at, setAt] = useState<number | undefined>();
  // 最近报上来的在最上面，和首页、决定页一样。按编号排，改状态时不换位置。
  const list = [...(issues.data?.data ?? [])].sort((a, b) => b.id - a.id);
  const now = new Date();
  const sheets = list.map((issue) => ({
    title: issue.issueClass,
    attrs: [
      ["项目", issue.project],
      ...(issue.round === null ? [] : [["阶段", roundNameOf(issue.round)] as const]),
      ["方面", issue.aspect],
      ["状态", issue.status],
      [
        "报告者",
        issue.skillVersion === null
          ? issue.reporter
          : `${issue.reporter}，skill ${issue.skillVersion}`,
      ],
      ["原始情况", issue.example],
      ...(issue.note === null ? [] : [["维护者的回复", issue.note] as const]),
      ...(issue.fixedIn === null ? [] : [["改的版本", issue.fixedIn] as const]),
    ] as const,
  }));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-title">skill 的问题</h1>
      </div>
      {issues.isError ? (
        <Notice kind="error" error={issues.error} onRetry={() => void issues.refetch()}>
          读不到问题。
        </Notice>
      ) : issues.data === undefined ? (
        <Notice kind="loading">正在读取</Notice>
      ) : list.length === 0 ? (
        // 没有行就不摆只有表头的空表。
        <Notice kind="empty">没有问题</Notice>
      ) : (
        <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">
          <table className="w-full text-left text-ui">
            <thead className="bg-secondary text-meta text-tertiary">
              <tr>
                <th className="px-4 py-2 font-normal">项目</th>
                <th className="px-3 py-2 font-normal">阶段</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">方面</th>
                <th className="px-3 py-2 font-normal">类别</th>
                <th className="px-3 py-2 font-normal whitespace-nowrap">状态</th>
                <th className="px-4 py-2 text-right font-normal whitespace-nowrap">最近改动</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-secondary">
              {list.map((issue, index) => (
                <tr key={issue.id} data-issue={issue.id} className={cx("align-top", rowClass)}>
                  <td className="px-4 py-3 font-semibold">
                    <RowButton onOpen={() => setAt(index)}>{issue.project}</RowButton>
                  </td>
                  <td className="px-3 py-3 text-secondary">
                    {issue.round === null ? "–" : roundNameOf(issue.round)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-secondary">{issue.aspect}</td>
                  <td className="px-3 py-3">{issue.issueClass}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={issue.status} />
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap text-tertiary tabular-nums">
                    {sinceText(new Date(issue.updatedAt), now)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Sheet items={sheets} at={at} onAt={setAt} />
    </section>
  );
}

/** 一个项目的链接，点了进项目页。 */
function ProjectLink({ id, name }: { id: string; name?: string }) {
  return (
    <AppLink
      to="/p/$project"
      params={{ project: id }}
      className="inline-flex min-h-6 min-w-6 items-center font-semibold text-primary hover:underline"
    >
      {name ?? id}
    </AppLink>
  );
}

/** 一类情况。没有这类情况时整块不出现，不写「没有」。 */
function Block({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h3 className="text-ui font-semibold">{title}</h3>
      </div>
      <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">{children}</div>
    </section>
  );
}

const head = "bg-secondary text-meta text-tertiary";

function SignalsPart() {
  const signals = useQuery(skillSignalsQuery);
  const now = new Date();
  if (signals.isError) {
    return (
      <Notice kind="error" error={signals.error} onRetry={() => void signals.refetch()}>
        读不到这些情况。
      </Notice>
    );
  }
  if (signals.data === undefined) return <Notice kind="loading">正在读取</Notice>;
  const { blockedRules, outdatedProjects, stalledRounds, stalledQueueItems } = signals.data.data;
  if (
    blockedRules.length +
      outdatedProjects.length +
      stalledRounds.length +
      stalledQueueItems.length ===
    0
  ) {
    return null;
  }
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-heading">信号</h2>
      </div>
      <Block title="被拦规矩" count={blockedRules.length}>
        <table className="w-full text-left text-ui">
          <thead className={head}>
            <tr>
              <th className="px-4 py-2 font-normal">规矩</th>
              <th className="px-3 py-2 font-normal whitespace-nowrap">次数</th>
              <th className="px-3 py-2 font-normal">项目</th>
              <th className="px-4 py-2 font-normal">最近报错</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary">
            {blockedRules.map((item) => (
              <tr key={item.rule} className="align-top">
                {/* 规矩写它查什么的一句话，不写 land.steps 这样的编号；登记表里没有的是旧版本留下的。 */}
                <td className="px-4 py-3 wrap-anywhere">{item.summary ?? "旧版本的规矩"}</td>
                <td className="px-3 py-3 tabular-nums">{item.count}</td>
                <td className="px-3 py-3">
                  <span className="flex flex-wrap gap-x-3">
                    {item.projectIds.map((id) => (
                      <ProjectLink key={id} id={id} />
                    ))}
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary wrap-anywhere">
                  {item.latestMessage}
                  <span className="block text-meta text-tertiary">
                    {sinceText(new Date(item.latestAt), now)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      <Block title="旧版项目" count={outdatedProjects.length}>
        <table className="w-full text-left text-ui">
          <thead className={head}>
            <tr>
              <th className="px-4 py-2 font-normal">项目</th>
              <th className="px-3 py-2 font-normal">skill 版本</th>
              <th className="px-4 py-2 font-normal">情况</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary">
            {outdatedProjects.map((item) => (
              <tr key={item.project}>
                <td className="px-4 py-3">
                  <ProjectLink id={item.project} name={item.name} />
                </td>
                <td className="px-3 py-3 text-tertiary tabular-nums">{item.skillVersion ?? "–"}</td>
                <td className="px-4 py-3 text-warning-primary">{item.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      {/* 阶段和队列里的事不是同一种东西，各一块，一列里只放一种。 */}
      <Block title="停滞阶段" count={stalledRounds.length}>
        <table className="w-full text-left text-ui">
          <thead className={head}>
            <tr>
              <th className="px-4 py-2 font-normal">项目</th>
              <th className="px-3 py-2 font-normal">阶段</th>
              <th className="px-3 py-2 font-normal whitespace-nowrap">状态</th>
              <th className="px-4 py-2 text-right font-normal whitespace-nowrap">停了</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary">
            {stalledRounds.map((item) => (
              <tr key={`r-${item.round}-${item.project}`}>
                <td className="px-4 py-3">
                  <ProjectLink id={item.project} name={item.name} />
                </td>
                <td className="px-3 py-3">{roundNameOf(item.round)}</td>
                <td className="px-3 py-3 whitespace-nowrap text-secondary">{item.status}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-tertiary tabular-nums">
                  {item.days} 天
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
      <Block title="停滞的事" count={stalledQueueItems.length}>
        <table className="w-full text-left text-ui">
          <thead className={head}>
            <tr>
              <th className="px-4 py-2 font-normal">项目</th>
              <th className="px-3 py-2 font-normal">事项</th>
              <th className="px-3 py-2 font-normal whitespace-nowrap">状态</th>
              <th className="px-4 py-2 text-right font-normal whitespace-nowrap">停了</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-secondary">
            {stalledQueueItems.map((item) => (
              <tr key={`q-${item.item}-${item.project}`}>
                <td className="px-4 py-3">
                  <ProjectLink id={item.project} name={item.name} />
                </td>
                <td className="px-3 py-3">{item.content}</td>
                <td className="px-3 py-3 whitespace-nowrap text-secondary">{item.status}</td>
                <td className="px-4 py-3 text-right whitespace-nowrap text-tertiary tabular-nums">
                  {item.days} 天
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Block>
    </section>
  );
}

export function SkillPage() {
  return (
    <>
      <IssuesPart />
      <SignalsPart />
    </>
  );
}
