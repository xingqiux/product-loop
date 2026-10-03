// 每一页顶上的一栏：产品名和所在的位置。窗口窄时位置那一段收缩，过长的名字截断，产品名和右边的入口不换行。
import { RefreshCw05 } from "@untitledui/icons";
import { Fragment, type ReactNode } from "react";
import { AppLink } from "@/components/app-link";

export function AppHeader({ crumbs }: { crumbs: readonly ReactNode[] }) {
  return (
    <header className="flex h-14 items-center gap-3 border-b border-secondary px-6">
      <AppLink
        to="/"
        className="flex shrink-0 items-center gap-2 text-ui font-semibold whitespace-nowrap text-primary"
      >
        <span className="flex size-6 items-center justify-center rounded-md bg-brand-solid text-white">
          <RefreshCw05 className="size-3.5" />
        </span>
        产品循环
      </AppLink>
      {crumbs.map((crumb, index) => (
        <Fragment key={index}>
          <span className="shrink-0 text-ui text-quaternary">/</span>
          {/* 面包屑里的链接也要有 24 像素高，点得中。 */}
          <span className="min-w-0 truncate text-ui text-secondary [&>a]:inline-block [&>a]:min-w-6 [&>a]:py-0.5">
            {crumb}
          </span>
        </Fragment>
      ))}
      <AppLink
        to="/skill"
        className="ml-auto inline-flex min-h-6 shrink-0 items-center text-ui whitespace-nowrap text-tertiary hover:text-secondary data-[current=true]:hidden"
      >
        skill 的问题
      </AppLink>
    </header>
  );
}
