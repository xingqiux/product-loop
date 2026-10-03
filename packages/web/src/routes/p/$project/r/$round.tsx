// 每个阶段的页面。地址里的 item 是看哪一条，page 是这个阶段的第几页。
import { createFileRoute } from "@tanstack/react-router";
import { RoundView } from "@/features/round/shell/round-view";

type Search = { item?: string | undefined; page?: string | undefined };

export const Route = createFileRoute("/p/$project/r/$round")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    item: typeof search.item === "string" ? search.item : undefined,
    page:
      typeof search.page === "string" && /^[1-9]\d*$/u.test(search.page) ? search.page : undefined,
  }),
  component: RoundPage,
});

function RoundPage() {
  const { project, round } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <RoundView
      pid={project}
      round={round}
      pageSeq={search.page === undefined ? undefined : Number(search.page)}
      item={search.item}
      onNavigate={(next) =>
        void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
      }
    />
  );
}
