import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { shouldRetry } from "@/lib/api";
import { parseSearch, stringifySearch } from "@/lib/search";
import { routeTree } from "./routeTree.gen";

export const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetry } },
});

export const router = createRouter({
  routeTree,
  context: { queryClient },
  parseSearch,
  stringifySearch,
  defaultPreload: "intent",
  // 数据新不新由 TanStack Query 管，路由不再缓存加载的结果。
  defaultPreloadStaleTime: 0,
  scrollRestoration: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
