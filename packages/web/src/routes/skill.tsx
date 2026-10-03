// skill 的问题页，见「06 工作台」第七节和第三期计划第 4 步。和项目并列的一个入口，给维护 skill 的人看。
import { createFileRoute } from "@tanstack/react-router";
import { AppHeader } from "@/components/app-header";
import { SkillPage } from "@/features/skill/skill-page";
import { useDocumentTitle } from "@/lib/document-title";

export const Route = createFileRoute("/skill")({
  component: Page,
});

function Page() {
  useDocumentTitle("skill 的问题");
  return (
    <>
      <AppHeader crumbs={[]} />
      <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-10">
        <SkillPage />
      </main>
    </>
  );
}
