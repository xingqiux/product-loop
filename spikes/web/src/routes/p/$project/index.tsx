import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Link } from 'react-aria-components'
import { AppLink } from '../../../components/AppLink'
import { DocsWiringProbe } from '../../../components/DocsWiringProbe'
import { projectQuery } from '../../../lib/data'

export const Route = createFileRoute('/p/$project/')({
  component: ProjectPage,
})

function ProjectPage() {
  const { project: projectId } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectQuery(projectId))
  if (!project) return null

  return (
    <div className="max-w-3xl px-8 py-6">
      <h2 className="text-sm font-medium text-gray-500">轮次（数据来自 TanStack Query）</h2>
      <ul data-testid="round-list" className="mt-3 divide-y divide-gray-200 border-y border-gray-200">
        {project.rounds.map((round) => (
          <li key={round.id} className="flex items-center justify-between py-2.5">
            <AppLink
              to="/p/$project/r/$round"
              params={{ project: projectId, round: round.id }}
              search={{ item: round.items[1] ?? round.items[0] }}
              data-testid={`round-link-${round.id}`}
              className="font-medium text-gray-900 outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:text-brand-700"
            >
              {round.id}
            </AppLink>
            <span className="text-xs text-gray-500">{round.stage}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm">
        {/* 手写的 href 带查询参数：检查 RouterProvider 的接法能把 ?item= 拆出来 */}
        <Link
          href={`/p/${projectId}/r/v2-检查-1?item=F-1`}
          data-testid="rac-link-with-query"
          className="text-brand-600 outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:underline"
        >
          直接看 v2-检查-1 的 F-1（React Aria 链接，href 里带查询参数）
        </Link>
      </p>
      <p className="mt-2 text-xs">
        <DocsWiringProbe href={`/p/${projectId}/r/v2-检查-1?item=F-1`} testId="docs-wiring-link" />
      </p>
    </div>
  )
}
