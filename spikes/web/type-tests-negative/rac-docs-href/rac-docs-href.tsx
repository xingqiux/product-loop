// 反例：照 React Aria 文档给 TanStack Router 的写法，把 RouterConfig 的 href 声明成 ToOptions['to']。
// 结果 href 只能填路由模板（'/p/$project'），填不了具体地址（'/p/产品循环'），带查询参数的更不行。
// verify 期望这个工程的类型检查失败，以此说明这条写法不能照搬。
import type { ToOptions } from '@tanstack/react-router'
import { Link } from 'react-aria-components'

declare module 'react-aria-components' {
  interface RouterConfig {
    href: ToOptions['to']
  }
}

export const concrete = <Link href="/p/产品循环">具体地址</Link>
