// 开工验证页只在开发时用。生产构建里 import.meta.env.DEV 是 false，下面的动态引入随之去掉，
// 验证页的代码不进构建结果，打开 /proof 就是找不到这一页。
import { createFileRoute, notFound } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

const ProofPage = import.meta.env.DEV
  ? lazy(() => import("@/features/proof/proof-page").then((m) => ({ default: m.ProofPage })))
  : undefined;

export const Route = createFileRoute("/proof")({
  beforeLoad: () => {
    if (ProofPage === undefined) throw notFound();
  },
  component: () =>
    ProofPage === undefined ? null : (
      <Suspense>
        <ProofPage />
      </Suspense>
    ),
});
