import { createLink, type LinkComponent } from '@tanstack/react-router'
import { Link as AriaLink } from 'react-aria-components'

// 自己写的链接：用 TanStack Router 的 createLink 包住 React Aria 的 Link。
// to / params / search 按路由树检查类型；渲染、键盘、焦点、悬停这些交互状态仍由 React Aria 负责。
const RouterAriaLink = createLink(AriaLink)

// activeProps 默认给一个空对象，原因：链接指向当前页、又没给 activeProps 时，
// TanStack 会把 className 拼成 `${className} active`（@tanstack/react-router dist/esm/link.js 的 applyLinkState）。
// React Aria 的 className 可以是函数（按悬停、按下、当前页等状态算类名），一拼就成了函数源码的字符串。
// 给了空的 activeProps，函数原样交给 React Aria；「是不是当前页」用 React Aria 的 isCurrent（来自 aria-current）判断。
const NO_ACTIVE_PROPS = {}

export const AppLink: LinkComponent<typeof AriaLink> = (props) => (
  <RouterAriaLink activeProps={NO_ACTIVE_PROPS} {...props} />
)

// 只给检查用：不加上面那条修正的 createLink，用来证明这个坑在当前版本里确实存在。
export const RawRouterAriaLink = RouterAriaLink
