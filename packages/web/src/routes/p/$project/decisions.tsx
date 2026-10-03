// 决定页，见第二期计划第 20 步。
import { createFileRoute } from "@tanstack/react-router";
import { DecisionsPage } from "@/features/decisions/decisions-page";
import { ProjectShell } from "@/features/project/project-shell";

export const Route = createFileRoute("/p/$project/decisions")({
  component: Page,
});

function Page() {
  const { project } = Route.useParams();
  return (
    <ProjectShell pid={project} tab="decisions">
      <DecisionsPage pid={project} />
    </ProjectShell>
  );
}
