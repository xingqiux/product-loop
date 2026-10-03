// 所有项目的看板，见「06 工作台」第二节和第三期计划第 3 步。每个项目一行。
// 有页在等的排最前，其余按最近的改动排，顺序由后端定，页面上不写这条规则。

import { pagePurpose } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ArrowRight } from "@untitledui/icons";
import { AppHeader } from "@/components/app-header";
import { AppLink } from "@/components/app-link";
import { Notice } from "@/components/notice";
import { StateBadge } from "@/components/state-badge";
import { Button } from "@/components/ui/base/buttons/button";
import { cx } from "@/lib/cx";
import { useDocumentTitle } from "@/lib/document-title";
import { projectsQuery } from "@/lib/queries";
import { roundHref, roundName, roundState, versionIdleText } from "@/lib/rounds";
import { unmigratedText } from "@/lib/skill-state";
import { sinceText } from "@/lib/time";
import { useWide } from "@/lib/use-media";

export const Route = createFileRoute("/")({
  component: ProjectsPage,
});

type Status = NonNullable<ReturnType<typeof useProjects>["data"]>["data"][number];

/** 有要用户点的页在等。只看的页不等回复，不算（决定 204）。 */
function waitsForUser(status: Status): boolean {
  return status.waitingPages.some((page) => page.purpose === pagePurpose.label("ask"));
}

/** skill 比现在的旧，或者有还没用上的规则：这一行要标出来。 */
function skillIsOlder(status: Status): boolean {
  return status.skill.doctor !== null || status.skill.newerRules;
}

function useProjects() {
  return useQuery(projectsQuery);
}

const stages = ["构思", "使用", "检查", "落地", "提升"] as const;

function ProjectsPage() {
  const projects = useProjects();
  const wide = useWide();
  useDocumentTitle("所有项目");
  return (
    <>
      {/* 页头不重复写页面标题：面包屑只写上一层，首页没有上一层。 */}
      <AppHeader crumbs={[]} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <div className="flex flex-col gap-1">
          <h1 className="text-title">所有项目</h1>
        </div>
        {projects.isPending ? (
          <Notice kind="loading">正在读取</Notice>
        ) : projects.isError ? (
          <Notice kind="error" error={projects.error} onRetry={() => void projects.refetch()}>
            读不到项目。
          </Notice>
        ) : projects.data.data.length === 0 ? (
          <Notice kind="empty" size="block">
            没有项目
          </Notice>
        ) : (
          <>
            <Attention list={projects.data.data} />
            {wide ? (
              <ProjectTable list={projects.data.data} />
            ) : (
              <ProjectCards list={projects.data.data} />
            )}
          </>
        )}
      </main>
    </>
  );
}

/** 顶上一行只写要用户动手的事，没有就不出现。 */
function Attention({ list }: { list: readonly Status[] }) {
  const waiting = list.filter(waitsForUser).length;
  const doctor = list.filter((status) => status.skill.doctor !== null).length;
  if (waiting === 0 && doctor === 0) return null;
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-secondary px-4 py-3 text-ui ring-1 ring-secondary">
      {waiting > 0 && (
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-fg-brand-primary" />
          {waiting} 个项目有页在等
        </span>
      )}
      {doctor > 0 && (
        <span className="flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-fg-warning-primary" />
          {doctor} 个项目的 skill 停在旧版本
        </span>
      )}
    </div>
  );
}

/** 一个阶段的队列里有几件，停了七天以上的另外标在下面。 */
function queueOf(status: Status, stage: (typeof stages)[number]) {
  const entry = status.queue.find((item) => item.stage === stage);
  return { count: entry?.count ?? 0, stale: entry?.stale ?? 0 };
}

/** 项目名，名字和目录的最后一段不同时，再写一行目录。 */
function ProjectName({ status }: { status: Status }) {
  const { project } = status;
  const dir = (project.roots[0] ?? "").split("/").at(-1);
  return (
    <>
      <AppLink
        to="/p/$project"
        params={{ project: project.id }}
        className="inline-flex min-h-6 min-w-6 items-center font-semibold break-all text-primary hover:underline"
      >
        {project.name}
      </AppLink>
      {dir !== project.name && <p className="font-mono text-meta break-all text-tertiary">{dir}</p>}
    </>
  );
}

/** 停在哪：第几版、哪个阶段、状态；有页在等时，下面是直达那一页的按钮。 */
function Situation({ status }: { status: Status }) {
  const { project, round, waitingPages, skill } = status;
  const waiting = waitingPages[0];
  return (
    <div className="flex flex-col items-start gap-2">
      {skill.doctor === "迁移未完成" ? (
        <p>{unmigratedText}</p>
      ) : round === null ? (
        <p>{versionIdleText(status.version.version)}</p>
      ) : (
        <p className="flex flex-wrap items-center gap-2">
          {roundName(round)}
          <StateBadge state={roundState(round.status)} />
        </p>
      )}
      {waiting !== undefined && (
        <Button
          size="sm"
          color="primary"
          iconTrailing={ArrowRight}
          href={roundHref(project.id, waiting.round)}
        >
          打开这一页
        </Button>
      )}
    </div>
  );
}

/** 宽屏：一个项目一行。阶段的五列是队列里的件数，列头上有「队列」一层。 */
function ProjectTable({ list }: { list: readonly Status[] }) {
  const now = new Date();
  // 每个项目的 skill 都是新的时，这一列每行都一样，没有信息，整列不出现。
  const showSkill = list.some(skillIsOlder);
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">
      <table className="w-full text-left text-ui">
        <thead className="bg-secondary text-meta text-tertiary">
          <tr>
            <th rowSpan={2} className="px-5 py-2.5 align-bottom font-normal">
              项目
            </th>
            <th rowSpan={2} className="px-3 py-2.5 align-bottom font-normal">
              停在哪
            </th>
            <th colSpan={stages.length} className="px-1 pt-2.5 pb-1 text-center font-normal">
              队列
            </th>
            {showSkill && (
              <th rowSpan={2} className="px-3 py-2.5 align-bottom font-normal">
                skill
              </th>
            )}
            <th
              rowSpan={2}
              className="px-5 py-2.5 text-right align-bottom font-normal whitespace-nowrap"
            >
              最近改动
            </th>
          </tr>
          <tr>
            {stages.map((stage) => (
              <th key={stage} className="w-12 px-1 pb-2.5 text-center font-normal">
                {stage}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-secondary">
          {list.map((status) => (
            <ProjectRow key={status.project.id} status={status} now={now} showSkill={showSkill} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({ status, now, showSkill }: { status: Status; now: Date; showSkill: boolean }) {
  const unmigrated = status.skill.doctor === "迁移未完成";
  return (
    <tr className="align-middle">
      <td className="px-5 py-4">
        <ProjectName status={status} />
      </td>
      <td className="px-3 py-4">
        <Situation status={status} />
      </td>
      {unmigrated ? (
        <td colSpan={stages.length} />
      ) : (
        stages.map((stage) => {
          const { count, stale } = queueOf(status, stage);
          return <QueueCell key={stage} count={count} stale={stale} />;
        })
      )}
      {showSkill && (
        <td className="px-3 py-4 whitespace-nowrap">
          {skillIsOlder(status) && <SkillCell status={status} />}
        </td>
      )}
      <td className="px-5 py-4 text-right whitespace-nowrap text-tertiary tabular-nums">
        {sinceText(new Date(status.lastChangedAt), now)}
      </td>
    </tr>
  );
}

/** 一个阶段的件数。停了七天以上的另外标在下面。 */
function QueueCell({ count, stale }: { count: number; stale: number }) {
  return (
    <td className={cx("px-1 py-3 text-center tabular-nums", count === 0 && "text-quaternary")}>
      {count}
      {stale > 0 && <p className="text-label text-warning-primary">停滞 {stale}</p>}
    </td>
  );
}

/** 半屏和更窄：一个项目一张卡，卡里从上到下是项目、停在哪、五个阶段的队列、skill。 */
function ProjectCards({ list }: { list: readonly Status[] }) {
  const now = new Date();
  return (
    <ul className="flex flex-col gap-3">
      {list.map((status) => (
        <li
          key={status.project.id}
          className="flex flex-col gap-3 rounded-xl p-4 ring-1 ring-secondary"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <ProjectName status={status} />
            </div>
            <span className="shrink-0 text-meta text-tertiary tabular-nums">
              {sinceText(new Date(status.lastChangedAt), now)}
            </span>
          </div>
          <Situation status={status} />
          {status.skill.doctor === "迁移未完成" ? null : (
            <div className="flex flex-col gap-1.5">
              <p className="text-meta text-tertiary">队列</p>
              <div className="grid grid-cols-5 gap-2">
                {stages.map((stage) => {
                  const { count, stale } = queueOf(status, stage);
                  return (
                    <div key={stage} className="rounded-lg px-3 py-1.5 ring-1 ring-secondary">
                      <p className={cx("text-ui tabular-nums", count === 0 && "text-quaternary")}>
                        {count}
                      </p>
                      <p className="text-meta text-tertiary">{stage}</p>
                      {stale > 0 && <p className="text-label text-warning-primary">停滞 {stale}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {skillIsOlder(status) && (
            <div className="flex items-baseline gap-3 text-meta">
              <span className="shrink-0 text-tertiary">skill</span>
              <SkillCell status={status} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * skill 比现在的旧时写「旧版」和现在的版本号，没迁移的写未迁移（S1 第 4 步）。
 * 不写命令，也不写去哪里处理，处理由那个项目会话里的 AI 做。平时新的不写，见 skillIsOlder。
 */
function SkillCell({ status }: { status: Status }) {
  const { skill } = status;
  const unmigrated = skill.doctor === "迁移未完成";
  return (
    <div className="flex flex-col items-start gap-1">
      <span className="w-fit rounded-md bg-secondary px-1.5 py-0.5 text-label whitespace-nowrap text-warning-primary ring-1 ring-secondary ring-inset">
        {unmigrated
          ? unmigratedText
          : `${skill.doctor === "停在旧版本" ? "旧版" : skill.version}，现在是 ${skill.current}`}
      </span>
    </div>
  );
}
