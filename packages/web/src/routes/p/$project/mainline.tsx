// 主线页，见第二期计划第 20 步。地址里记着怎么看、看哪一版、比较哪两版。
import { createFileRoute } from "@tanstack/react-router";
import { MainlinePage, type MainlineView } from "@/features/mainline/mainline-page";
import { ProjectShell } from "@/features/project/project-shell";

type Search = {
  view?: string | undefined;
  rev?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
};

const revisionOf = (value: unknown) =>
  typeof value === "string" && /^[1-9]\d*$/u.test(value) ? value : undefined;
const views: readonly MainlineView[] = ["text", "diff", "scenes"];

export const Route = createFileRoute("/p/$project/mainline")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    view: views.find((view) => view === search.view),
    rev: revisionOf(search.rev),
    from: revisionOf(search.from),
    to: revisionOf(search.to),
  }),
  component: Page,
});

const numberOf = (value: string | undefined) => (value === undefined ? undefined : Number(value));

function Page() {
  const { project } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ProjectShell pid={project} tab="mainline">
      <MainlinePage
        pid={project}
        search={{
          view: views.find((view) => view === search.view) ?? "text",
          rev: numberOf(search.rev),
          from: numberOf(search.from),
          to: numberOf(search.to),
        }}
        onSearch={(next) =>
          void navigate({
            search: (prev) => ({
              ...prev,
              ...Object.fromEntries(
                Object.entries(next).map(([key, value]) => [
                  key,
                  value === undefined ? undefined : String(value),
                ]),
              ),
            }),
            replace: true,
          })
        }
      />
    </ProjectShell>
  );
}
