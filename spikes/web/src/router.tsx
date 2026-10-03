import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
})

export const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  // 数据新不新由 TanStack Query 管，路由自己不再缓存加载器的结果（TanStack 文档对两者合用的建议）。
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
