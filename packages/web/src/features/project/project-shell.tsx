// 项目页、队列、主线、决定四页共用的外壳：页头加内容区。项目不存在时整页换成找不到，不让每一块各读一次再各报各的错。
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AppLink } from "@/components/app-link";
import { NotFound } from "@/components/not-found";
import { isNotFound } from "@/lib/api";
import { statusQuery } from "@/lib/queries";
import { ProjectHeader, type Tab } from "./project-header";

export function ProjectShell({
  pid,
  tab,
  children,
}: {
  pid: string;
  tab: Tab;
  children: ReactNode;
}) {
  const status = useQuery(statusQuery(pid));
  if (status.isError && isNotFound(status.error)) {
    return (
      <NotFound
        crumbs={[
          <AppLink key="all" to="/" className="hover:underline">
            所有项目
          </AppLink>,
        ]}
      />
    );
  }
  return (
    <>
      <ProjectHeader pid={pid} tab={tab} />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">{children}</main>
    </>
  );
}
