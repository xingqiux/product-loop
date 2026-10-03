// 项目页、队列、主线、决定共用的页头：项目名、现在停在哪、四个标签。见「06 工作台」第三节。
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight } from "@untitledui/icons";
import { AppHeader } from "@/components/app-header";
import { AppLink } from "@/components/app-link";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/base/buttons/button";
import { cx } from "@/lib/cx";
import { useDocumentTitle } from "@/lib/document-title";
import { statusQuery } from "@/lib/queries";
import { roundHref, roundState } from "@/lib/rounds";
import { unmigratedText } from "@/lib/skill-state";

const stages = ["构思", "使用", "检查", "落地", "提升"] as const;

export type Tab = "overview" | "queue" | "mainline" | "decisions";

const tabs: readonly { key: Tab; label: string; to: string }[] = [
  { key: "overview", label: "概览", to: "/p/$project" },
  { key: "queue", label: "队列", to: "/p/$project/queue" },
  { key: "mainline", label: "主线", to: "/p/$project/mainline" },
  { key: "decisions", label: "决定", to: "/p/$project/decisions" },
];

type Skill = NonNullable<ReturnType<typeof useProjectStatus>["data"]>["data"]["skill"];

function useProjectStatus(pid: string) {
  return useQuery(statusQuery(pid));
}

/**
 * skill 一行：版本；旧的或没迁移的标出来（S1 第 4 步），不写命令。
 * 和首页那一行同一种说法。
 */
function SkillLine({ skill }: { skill: Skill }) {
  const doctor = skill.doctor !== null;
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt className="shrink-0 whitespace-nowrap text-quaternary">skill</dt>
      <dd className={cx(doctor && "text-warning-primary")}>
        {skill.doctor === "迁移未完成"
          ? unmigratedText
          : skill.doctor === "停在旧版本"
            ? `旧版，现在是 ${skill.current}`
            : skill.version}
      </dd>
    </div>
  );
}

export function ProjectHeader({ pid, tab }: { pid: string; tab: Tab }) {
  const status = useProjectStatus(pid);
  const data = status.data?.data;
  const round = data?.round ?? null;
  const waiting = data?.waitingPages[0];
  // 标签页写项目名，概览以外的再写是哪一页。
  useDocumentTitle(
    data?.project.name ?? pid,
    tabs.find((item) => item.key === tab && item.key !== "overview")?.label,
  );
  return (
    <>
      <AppHeader
        crumbs={[
          <AppLink key="all" to="/" className="hover:underline">
            所有项目
          </AppLink>,
        ]}
      />
      <div className="border-b border-secondary">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 pt-8">
          {/* 三行各在固定的位置：项目名和按钮一行，位置和阶段条一行，页签一行。有没有页在等，只影响右上角的按钮。 */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
              <h1 className="flex min-w-0 items-center gap-3 text-title break-all">
                {data?.project.name ?? pid}
                {round !== null && <StateBadge state={roundState(round.status)} />}
              </h1>
              {/* 有页在等（要点的或只看的）才有这个按钮，没有页就没有要打开的。 */}
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
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              {data !== undefined && (
                <dl className="flex min-w-0 flex-1 basis-72 flex-wrap gap-x-5 gap-y-0.5 text-meta text-tertiary">
                  <div className="flex min-w-0 gap-1.5">
                    {/* 名字不折行，长路径只折值：不然半屏宽度下「目录」两个字被挤成竖排（S22）。 */}
                    <dt className="shrink-0 whitespace-nowrap text-quaternary">目录</dt>
                    <dd className="min-w-0 font-mono break-all">{data.project.roots[0]}</dd>
                  </div>
                  <SkillLine skill={data.skill} />
                </dl>
              )}
              {/* 阶段条只是告诉用户走到哪一步，不能点，所以不画成页签：一行字，当前的一步是蓝色加点。 */}
              <ol aria-label="阶段" className="flex items-center gap-1 text-meta whitespace-nowrap">
                {stages.map((stage, index) => (
                  <li key={stage} className="flex items-center gap-1">
                    {index > 0 && <ChevronRight className="size-3.5 text-fg-quaternary" />}
                    <span
                      aria-current={round?.stage === stage ? "step" : undefined}
                      className={cx(
                        "flex items-center gap-1.5",
                        round?.stage === stage
                          ? "font-medium text-brand-secondary"
                          : "text-tertiary",
                      )}
                    >
                      {round?.stage === stage && (
                        <span className="size-1.5 rounded-full bg-fg-brand-primary" />
                      )}
                      {stage}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
          <nav aria-label="项目" className="flex gap-6">
            {tabs.map((item) => (
              <AppLink
                key={item.key}
                to={item.to}
                params={{ project: pid }}
                className={cx(
                  "border-b-2 pb-2.5 text-ui",
                  item.key === tab
                    ? "border-fg-brand-primary font-medium text-brand-secondary"
                    : "border-transparent text-tertiary hover:text-secondary",
                )}
              >
                {item.label}
              </AppLink>
            ))}
          </nav>
        </div>
      </div>
    </>
  );
}
