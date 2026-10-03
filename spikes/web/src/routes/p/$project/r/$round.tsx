import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, notFound } from '@tanstack/react-router'
import { AnimatePresence, motion } from 'motion/react'
import { z } from 'zod'
import { AppLink, RawRouterAriaLink } from '../../../../components/AppLink'
import { projectQuery } from '../../../../lib/data'
import { probe } from '../../../../lib/probe'

// 「当前看的是哪一条」放在查询参数里，刷新、前进后退、把地址发给自己都能回到原处。
// Zod 4 实现了 Standard Schema，直接交给 validateSearch，不用 @tanstack/zod-adapter（它只支持 Zod 3）。
const roundSearchSchema = z.object({
  item: z.string().min(1).optional(),
})

export const Route = createFileRoute('/p/$project/r/$round')({
  validateSearch: roundSearchSchema,
  loader: async ({ context, params, preload }) => {
    probe('loader:round', { round: params.round, preload })
    const project = await context.queryClient.ensureQueryData(projectQuery(params.project))
    if (!project?.rounds.some((round) => round.id === params.round)) throw notFound()
  },
  errorComponent: ({ error }) => (
    <p data-testid="route-error" role="alert" className="p-8 text-sm text-red-700">
      这一页的地址参数不对：{error instanceof Error ? error.message : String(error)}
    </p>
  ),
  component: RoundPage,
})

const itemLinkClass = ({ isCurrent, isHovered }: { isCurrent: boolean; isHovered: boolean }) =>
  `block rounded-md px-2 py-1.5 text-sm outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 ${
    isCurrent ? 'is-current bg-brand-50 font-medium text-brand-700' : isHovered ? 'bg-gray-100' : 'text-gray-700'
  }`

function RoundPage() {
  const { project: projectId, round: roundId } = Route.useParams()
  const { item } = Route.useSearch()
  const { data: project } = useSuspenseQuery(projectQuery(projectId))
  const round = project?.rounds.find((r) => r.id === roundId)
  if (!round) return null

  const items = round.items
  const current = item !== undefined && items.includes(item) ? item : (items[0] ?? '')
  const index = items.indexOf(current)
  const previous = items[index - 1]
  const next = items[index + 1]

  return (
    <div className="grid min-h-[calc(100dvh-4.5rem)] grid-cols-[13rem_1fr]">
      <nav aria-label="这一页的事" className="space-y-1 border-r border-gray-200 p-3">
        <AppLink
          to="/p/$project"
          params={{ project: projectId }}
          className="mb-2 block px-2 text-xs text-gray-500 outline-none data-hovered:text-gray-900"
        >
          ← 回到项目
        </AppLink>
        {items.map((it) => (
          <AppLink
            key={it}
            to="/p/$project/r/$round"
            params={{ project: projectId, round: roundId }}
            search={{ item: it }}
            data-testid={`item-link-${it}`}
            className={itemLinkClass}
          >
            {it}
          </AppLink>
        ))}
      </nav>

      <div className="space-y-6 p-8">
        <dl className="grid w-fit grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt className="text-gray-500">项目（路径参数）</dt>
          <dd data-testid="param-project" className="font-medium">
            {projectId}
          </dd>
          <dt className="text-gray-500">轮次（路径参数）</dt>
          <dd data-testid="param-round" className="font-medium">
            {roundId}
          </dd>
          <dt className="text-gray-500">当前这一条（查询参数 item）</dt>
          <dd data-testid="search-item" className="font-medium">
            {item ?? '（未指定）'}
          </dd>
        </dl>

        {/* 换一屏：Motion 的进出场。系统开了「减少动态效果」时，MotionConfig 只保留透明度的变化。 */}
        <AnimatePresence mode="wait">
          <motion.section
            key={current}
            data-testid="screen"
            data-item={current}
            initial={{ opacity: 0, x: 32 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -32 }}
            transition={{ duration: 0.45, ease: [0.2, 0, 0, 1] }}
            className="max-w-xl rounded-xl border border-gray-200 p-6 shadow-xs"
          >
            <p className="text-xs text-gray-500">
              {round.stage} · 第 {index + 1} 条，共 {items.length} 条
            </p>
            <h2 className="mt-1 text-lg font-semibold">{current}</h2>
            <p className="mt-2 text-sm leading-6 text-gray-600">
              右边一次只摆一屏。换一条时，旧的一屏向左淡出，新的一屏从右边淡入。
            </p>
          </motion.section>
        </AnimatePresence>

        <div className="flex gap-2">
          {previous !== undefined && (
            <AppLink
              to="/p/$project/r/$round"
              params={{ project: projectId, round: roundId }}
              search={{ item: previous }}
              data-testid="prev"
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:bg-gray-50"
            >
              上一条
            </AppLink>
          )}
          {next !== undefined && (
            <AppLink
              to="/p/$project/r/$round"
              params={{ project: projectId, round: roundId }}
              search={{ item: next }}
              data-testid="next"
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm text-white outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:bg-brand-700"
            >
              下一条
            </AppLink>
          )}
        </div>

        {/* 探针：不加修正的 createLink，指向当前页，用来确认 className 函数会不会被拼坏 */}
        <div hidden>
          <RawRouterAriaLink
            to="/p/$project/r/$round"
            params={{ project: projectId, round: roundId }}
            search={{ item }}
            data-testid="probe-raw-createlink"
            className={({ isCurrent }) => (isCurrent ? 'probe-current' : 'probe-other')}
          >
            探针
          </RawRouterAriaLink>
        </div>
      </div>
    </div>
  )
}
