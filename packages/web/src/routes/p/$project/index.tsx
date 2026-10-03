// 项目页，见「06 工作台」第三节和第二期计划第 11 步：版本的进度、现在、队列的摘要、主线和决定。
import { createFileRoute } from "@tanstack/react-router";
import { NowCard } from "@/features/project/now-card";
import { ProjectShell } from "@/features/project/project-shell";
import { DecisionsCard, MainlineCard, QueueCard } from "@/features/project/side-cards";
import { VersionGrid } from "@/features/project/version-grid";

export const Route = createFileRoute("/p/$project/")({
  component: ProjectPage,
});

function ProjectPage() {
  const { project } = Route.useParams();
  return (
    <ProjectShell pid={project} tab="overview">
      <VersionGrid pid={project} />
      {/* 宽屏两列，左边现在和主线，右边队列和决定，两边高度差不多；窄屏一列，按 order 的顺序往下排。 */}
      <div className="flex flex-col gap-6 wide:grid wide:grid-cols-[3fr_2fr] wide:items-start">
        <div className="contents wide:flex wide:flex-col wide:gap-6">
          <div className="order-1">
            <NowCard pid={project} />
          </div>
          <div className="order-3">
            <MainlineCard pid={project} />
          </div>
        </div>
        <div className="contents wide:flex wide:flex-col wide:gap-6">
          <div className="order-2">
            <QueueCard pid={project} />
          </div>
          <div className="order-4">
            <DecisionsCard pid={project} />
          </div>
        </div>
      </div>
    </ProjectShell>
  );
}
