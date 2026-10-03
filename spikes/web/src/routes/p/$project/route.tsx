import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound, Outlet } from '@tanstack/react-router'
import { projectQuery } from '../../../lib/data'

// /p/$project 的外框：项目页、每一轮的页面（以后还有队列、主线、决定）都套在里面。
export const Route = createFileRoute('/p/$project')({
  loader: async ({ context, params }) => {
    const project = await context.queryClient.ensureQueryData(projectQuery(params.project))
    if (!project) throw notFound()
  },
  component: ProjectLayout,
})

function ProjectLayout() {
  const { project: projectId } = Route.useParams()
  const { data: project } = useSuspenseQuery(projectQuery(projectId))
  if (!project) return null

  return (
    <div>
      <header className="border-b border-gray-200 px-8 py-4">
        <p className="text-xs text-gray-500">项目</p>
        <h1 data-testid="project-name" className="text-lg font-semibold tracking-tight">
          {project.name}
        </h1>
      </header>
      <Outlet />
    </div>
  )
}
