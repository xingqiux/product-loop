// 加载、空、出错三种状态的同一个样子：一句话，居中，出错的用红字，能重试的带一个「重试」按钮。
// 页面级（整块内容区读不到）、块级（一块里没有内容）和行内（卡片里的一小处）三种大小，不各写各的。
// 连不上本机服务时，加载和出错都只写「连不上本机服务」，不写英文码；后端报的原因写在下面一行，只写一遍。
import type { ReactNode } from "react";
import { Button } from "@/components/ui/base/buttons/button";
import { failureOf, serviceLost } from "@/lib/api";
import { cx } from "@/lib/cx";
import { useConnection } from "@/stores/connection";

export type NoticeKind = "loading" | "empty" | "error";

const sizes = {
  page: "items-center px-6 py-16 text-center text-ui",
  block: "items-center rounded-xl px-4 py-6 text-center text-ui ring-1 ring-secondary",
  inline: "items-start text-meta",
} as const;

/**
 * 这一处该写什么：连不上本机服务时只写这一句，加载时断了线也一样；后端报了错，原因写在下面。
 * 别的情况照调用的一方写的话。
 */
export function noticeView(
  kind: NoticeKind,
  error: unknown,
  connectionLost: boolean,
): { readonly lost: boolean; readonly reason: string | undefined } {
  const failure = kind === "error" ? failureOf(error) : { lost: false, reason: undefined };
  return { lost: failure.lost || (kind === "loading" && connectionLost), reason: failure.reason };
}

export function Notice({
  kind,
  size = "page",
  error,
  onRetry,
  action,
  children,
}: {
  kind: NoticeKind;
  size?: keyof typeof sizes;
  /** 出错时给这个：连不上本机服务就换成一句「连不上本机服务」，后端报了错就把原因写在下面。 */
  error?: unknown;
  /** 出错时给这个，就多一个「重试」按钮。 */
  onRetry?: () => void;
  /** 话下面的一个入口，例如找不到时回到上一层的链接。 */
  action?: ReactNode;
  children: ReactNode;
}) {
  const lostConnection = useConnection((state) => state.status === "lost");
  const { lost, reason } = noticeView(kind, error, lostConnection);
  return (
    <div
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
      className={cx(
        "flex flex-col gap-3",
        sizes[size],
        kind === "error" ? "text-error-primary" : "text-tertiary",
      )}
    >
      <p>{lost ? serviceLost : children}</p>
      {!lost && reason !== undefined && <p className="text-meta text-tertiary">{reason}</p>}
      {kind === "error" && onRetry !== undefined && (
        <Button size="sm" color="secondary" onClick={onRetry}>
          重试
        </Button>
      )}
      {action}
    </div>
  );
}
