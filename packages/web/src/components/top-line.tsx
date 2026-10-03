// 顶上一行，见第二期计划第 9 步：连不上本机服务、备份的警告。平常不显示。
// 备份的警告写两句：出了什么问题，怎么办。怎么办是用户要读的，写出来，不藏在悬停里（键盘和触屏看不到悬停）。
// 备份的警告只在首页和项目页显示，可以关掉，七天内不再出现，见 lib/backup-notice.ts。
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";
import { backupNoticeHidden, showsBackupNotice } from "@/lib/backup-notice";
import { backupWarningsOf, projectsQuery } from "@/lib/queries";
import { useConnection } from "@/stores/connection";
import { useUiStore } from "@/stores/ui";

export function TopLine() {
  const status = useConnection((state) => state.status);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const dismissedAt = useUiStore((state) => state.backupDismissedAt);
  const dismiss = useUiStore((state) => state.dismissBackup);
  const projects = useQuery({ ...projectsQuery, select: backupWarningsOf });
  const lost = status === "lost";
  const backup =
    showsBackupNotice(pathname) && !backupNoticeHidden(dismissedAt, Date.now())
      ? (projects.data ?? [])
      : [];
  const lines = lost ? [{ message: "连不上，重连中", hint: undefined }] : backup;
  if (lines.length === 0) return null;
  return (
    <div
      role="status"
      className="flex items-start justify-between gap-4 border-b border-secondary bg-secondary px-6 py-2 text-meta"
    >
      <div>
        {lines.map((line) => (
          <p key={line.message} className="text-warning-primary">
            {line.message}
            {line.hint !== undefined && <span className="ml-2 text-tertiary">{line.hint}</span>}
          </p>
        ))}
      </div>
      {!lost && (
        <button
          type="button"
          onClick={dismiss}
          className="inline-flex min-h-6 min-w-6 shrink-0 items-center justify-center text-tertiary hover:text-secondary"
        >
          关闭
        </button>
      )}
    </div>
  );
}
