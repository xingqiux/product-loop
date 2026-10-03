import { useRouter } from '@tanstack/react-router'
import { RouterProvider as AriaRouterProvider, Link } from 'react-aria-components'

// 探针：React Aria 文档给 TanStack Router 的接法——navigate 用 { to }、useHref 用 buildLocation({ to })。
// 只包住下面这一个链接，用来检查 href 带查询参数时的表现。应用本身用的是 __root.tsx 里的 { href } 接法。
export function DocsWiringProbe({ href, testId }: { href: string; testId: string }) {
  const router = useRouter()
  return (
    <AriaRouterProvider
      navigate={(to, options) => {
        void router.navigate({ ...options, to })
      }}
      useHref={(to) => router.buildLocation({ to }).href}
    >
      <Link href={href} data-testid={testId} className="text-gray-500 outline-none data-hovered:underline">
        探针：同一个地址，按 React Aria 文档的 {'{ to }'} 接法跳
      </Link>
    </AriaRouterProvider>
  )
}
