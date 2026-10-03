// 找不到的页：地址里的项目、阶段或页不存在，或者根本不是这个软件的地址。
// 有页头，有回到上一层的入口，不是一行裸字。
import { AppHeader } from "@/components/app-header";
import { AppLink } from "@/components/app-link";
import { Notice } from "@/components/notice";
import { useDocumentTitle } from "@/lib/document-title";

export function NotFound({
  crumbs = [],
  project,
}: {
  crumbs?: readonly React.ReactNode[];
  /** 找不到的是这个项目里的东西时写项目的编号，入口回到这个项目；不写就回到所有项目。 */
  project?: string;
}) {
  useDocumentTitle("找不到这一页");
  return (
    <>
      <AppHeader crumbs={crumbs} />
      <main className="mx-auto max-w-6xl">
        <Notice
          kind="empty"
          action={
            project === undefined ? (
              <AppLink to="/" className="text-ui text-brand-secondary hover:underline">
                回到所有项目
              </AppLink>
            ) : (
              <AppLink
                to="/p/$project"
                params={{ project }}
                className="text-ui text-brand-secondary hover:underline"
              >
                回到这个项目
              </AppLink>
            )
          }
        >
          找不到这一页。
        </Notice>
      </main>
    </>
  );
}
