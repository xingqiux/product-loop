import type { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  type NavigateOptions,
  Outlet,
  type ToOptions,
  useRouter,
} from '@tanstack/react-router'
import { MotionConfig } from 'motion/react'
import { RouterProvider as AriaRouterProvider, Button } from 'react-aria-components'
import { AppLink } from '../components/AppLink'
import { useUiStore } from '../stores/ui'

declare module 'react-aria-components' {
  interface RouterConfig {
    // href 保持 string，不按 React Aria 文档写成 ToOptions['to']：那只是路由模板（'/p/$project'），填不了具体地址。
    routerOptions: Omit<NavigateOptions, keyof ToOptions | 'href'>
  }
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <p className="p-8 text-sm text-gray-500">找不到这一页。</p>,
})

// 以协议或 // 开头的是站外地址，原样交给浏览器。
const EXTERNAL_HREF = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i

function RootLayout() {
  const router = useRouter()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)

  return (
    // React Aria 的链接（Untitled UI 的按钮、导航也一样）只认 href 字符串，这里把跳转交给 TanStack Router。
    // navigate 用 { href }（TanStack 文档：「导航到一个已经拼好的地址」），它会把 ?查询参数 和 #锚点 拆出来。
    // React Aria 文档写的是 { to }：TanStack 先把整串当路径（参数 round 成了 'v2-检查-1?item=F-1'），
    // 写进浏览器地址以后再按真实地址重新解析，所以最终也跳对了（见 DocsWiringProbe 和 verify 的探针），但中间状态是错的。
    <AriaRouterProvider
      navigate={(href, options) => {
        void router.navigate({ ...options, href })
      }}
      useHref={(href) => {
        // React Aria 对每个能当链接的条目都会调 useHref，没有 href 时传的是空串，直接返回，省掉一次路由匹配。
        if (href === '' || EXTERNAL_HREF.test(href)) return href
        // buildLocation 在运行时也认 { href }，但它的类型里没有这个字段，所以自己拆成 to / search / hash。
        const url = new URL(href, window.location.href)
        return router.buildLocation({
          to: url.pathname,
          search: router.options.parseSearch(url.search),
          hash: url.hash.slice(1),
        }).publicHref
      }}
    >
      <MotionConfig reducedMotion="user">
        <div className="flex min-h-dvh bg-white text-gray-900 antialiased">
          <aside
            data-testid="sidebar"
            data-collapsed={collapsed ? 'true' : 'false'}
            className={`shrink-0 border-r border-gray-200 bg-gray-50/60 ${collapsed ? 'w-16' : 'w-60'}`}
          >
            <div className="flex h-12 items-center justify-between gap-2 border-b border-gray-200 px-3">
              {!collapsed && <span className="text-sm font-semibold">工作台</span>}
              <Button
                data-testid="toggle-sidebar"
                onPress={toggleSidebar}
                className="rounded-md px-2 py-1 text-xs text-gray-600 outline-none data-focus-visible:ring-2 data-focus-visible:ring-brand-500 data-hovered:bg-gray-200/70"
              >
                {collapsed ? '展开' : '折叠'}
              </Button>
            </div>
            {!collapsed && (
              <nav aria-label="全局" className="space-y-1 p-3 text-sm">
                <AppLink
                  to="/"
                  activeOptions={{ exact: true }}
                  className={({ isCurrent, isHovered }) =>
                    `block rounded-md px-2 py-1.5 ${isCurrent ? 'bg-brand-50 font-medium text-brand-700' : isHovered ? 'bg-gray-100' : 'text-gray-700'}`
                  }
                >
                  所有项目
                </AppLink>
                <p className="px-2 pt-4 text-xs leading-5 text-gray-500">
                  这一栏折叠与否存在 Zustand，经持久化中间件写进浏览器本地，读写都兜住异常。
                </p>
              </nav>
            )}
          </aside>
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
        </div>
      </MotionConfig>
    </AriaRouterProvider>
  )
}
