import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Link } from 'react-aria-components'
import { AppLink } from '../components/AppLink'
import { projectsQuery } from '../lib/data'

export const Route = createFileRoute('/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery),
  component: HomePage,
})

function HomePage() {
  const { data: projects } = useSuspenseQuery(projectsQuery)

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <h1 className="text-xl font-semibold tracking-tight">所有项目</h1>
      <p className="mt-1 text-sm text-gray-500">
        每行两个链接：左边是只给 href 的 React Aria 链接，右边是 createLink 包出来、带类型的链接。
      </p>
      <ul className="mt-6 divide-y divide-gray-200 border-y border-gray-200">
        {projects.map((project) => (
          <li key={project.id} className="flex items-center justify-between py-3">
            <div className="flex items-baseline gap-2">
              {/* 只给 href 字符串，和 Untitled UI 组件里的链接一样，经 React Aria 的 RouterProvider 交给 TanStack Router */}
              <Link
                href={`/p/${project.id}`}
                data-testid={`rac-link-${project.id}`}
                className="font-medium text-gray-900 outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:text-brand-700"
              >
                {project.name}
              </Link>
              <span className="text-xs text-gray-500">{project.roundCount} 轮</span>
            </div>
            <AppLink
              to="/p/$project"
              params={{ project: project.id }}
              data-testid={`app-link-${project.id}`}
              className="text-sm text-brand-600 outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:underline"
            >
              进入
            </AppLink>
          </li>
        ))}
      </ul>
      <p className="mt-8 flex items-center gap-2 text-xs text-gray-500">
        <span data-testid="brand-chip" className="inline-block size-3 rounded-sm bg-brand-600" />
        品牌色来自自己的 @theme 变量 --color-brand-600
      </p>
    </div>
  )
}
