// 队列页：五列看板，见「06 工作台」第五节和第二期计划第 19 步。
import { createFileRoute } from "@tanstack/react-router";
import { ProjectShell } from "@/features/project/project-shell";
import { QueueBoard } from "@/features/queue/board";

export const Route = createFileRoute("/p/$project/queue")({
  component: Page,
});

function Page() {
  const { project } = Route.useParams();
  return (
    <ProjectShell pid={project} tab="queue">
      <QueueBoard pid={project} />
    </ProjectShell>
  );
}
