// 自己写的链接：用 TanStack Router 的 createLink 包住 React Aria 的 Link，见「02 技术选型」第十节。
// to、params、search 按路由树检查类型；键盘、焦点、悬停仍由 React Aria 负责。
import { createLink, type LinkComponent } from "@tanstack/react-router";
import { Link as AriaLink } from "react-aria-components";

const RouterAriaLink = createLink(AriaLink);

// 总是给 activeProps。不给时，链接指向当前页，TanStack 会把 className 拼成「原来的 active」。
// React Aria 的 className 可以是函数，一拼就成了函数源码的字符串。
// 是不是当前页用 React Aria 的 isCurrent 判断。
const noActiveProps = {};

export const AppLink: LinkComponent<typeof AriaLink> = (props) => (
  <RouterAriaLink activeProps={noActiveProps} {...props} />
);
