import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  type NavigateOptions,
  Outlet,
  type ToOptions,
  useRouter,
} from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { RouterProvider as AriaRouterProvider } from "react-aria-components";
import { NotFound } from "@/components/not-found";
import { TopLine } from "@/components/top-line";
import { retryDraftNow } from "@/features/round/draft-store";
import { subscribeEvents } from "@/lib/events";
import { useConnection } from "@/stores/connection";

declare module "react-aria-components" {
  interface RouterConfig {
    // href 保持字符串。按 React Aria 文档写成路由模板的类型，具体的地址会全部报错。
    routerOptions: Omit<NavigateOptions, keyof ToOptions | "href">;
  }
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: () => <NotFound />,
});

// 以协议或 // 开头的是站外地址，原样交给浏览器。
const externalHref = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

function RootLayout() {
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  useEffect(
    () =>
      subscribeEvents(queryClient, {
        onStatus: (status) => {
          useConnection.setState({ status });
          // 连上以后，没交上的草稿马上重交。
          if (status === "open") retryDraftNow();
        },
      }),
    [queryClient],
  );
  return (
    // Untitled UI 组件里的链接只给 href 字符串，这里把跳转交给 TanStack Router。
    // navigate 用 { href }，它会拆出查询参数和锚点。
    <AriaRouterProvider
      navigate={(href, options) => {
        void router.navigate({ ...options, href });
      }}
      useHref={(href) => {
        if (href === "" || externalHref.test(href)) return href;
        const url = new URL(href, window.location.href);
        return router.buildLocation({
          to: url.pathname,
          search: router.options.parseSearch(url.search),
          hash: url.hash.slice(1),
        }).publicHref;
      }}
    >
      {/* 系统开了「减少动态效果」时只保留透明度的变化。 */}
      <MotionConfig reducedMotion="user">
        <div className="min-h-dvh bg-primary text-primary">
          <TopLine />
          <Outlet />
        </div>
      </MotionConfig>
    </AriaRouterProvider>
  );
}
