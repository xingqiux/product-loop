// 左边一栏：按区块分组列出每一条，点过的打勾。能折叠，折叠与否记在界面偏好里。
// 提交区不在这里，它固定在页面底下，折叠时也在。
import { Check, LayoutLeft } from "@untitledui/icons";
import { cx } from "@/lib/cx";
import { useUiStore } from "@/stores/ui";
import { useDraft } from "../draft-store";
import { type Entry, entryDone, type Group, pickLabel } from "../model";

export function Sidebar({
  groups,
  isCurrent,
  onPick,
}: {
  groups: readonly Group[];
  isCurrent: (entry: Entry) => boolean;
  onPick: (entry: Entry) => void;
}) {
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggle = useUiStore((state) => state.toggleSidebar);
  const entries = useDraft((state) => state.entries);
  if (collapsed) {
    return (
      <aside className="flex w-12 shrink-0 flex-col items-center border-r border-secondary py-4">
        <button
          type="button"
          aria-label="展开左边一栏"
          onClick={toggle}
          className="flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
        >
          <LayoutLeft className="size-5" />
        </button>
      </aside>
    );
  }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-secondary">
      <div className="flex items-center justify-between px-4 pt-4 pb-2">
        <button
          type="button"
          aria-label="折叠左边一栏"
          onClick={toggle}
          className="ml-auto flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
        >
          <LayoutLeft className="size-5" />
        </button>
      </div>
      <nav aria-label="这一页的每一条" className="flex-1 overflow-y-auto px-2 pb-4">
        {groups.map((group) => (
          <section key={group.key} className="flex flex-col pt-3">
            {/* 只有一行的分组，块的名字就是那一行，不再重复写一遍。 */}
            {group.entries.length === 1 && group.entries[0]?.label === group.label ? null : (
              <p className="px-2 pb-1 text-label text-quaternary">{group.label}</p>
            )}
            {group.entries.map((entry) => {
              const done = entryDone(entry, entries);
              const current = isCurrent(entry);
              const picked = pickLabel(entry, entries);
              return (
                <button
                  key={`${entry.screen}/${entry.item ?? ""}`}
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => onPick(entry)}
                  className={cx(
                    "flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-ui transition-colors duration-(--duration-hover)",
                    // 当前的位置用这一个蓝（规范：选中、当前的位置只用这一个蓝）。
                    current
                      ? "bg-secondary font-medium text-brand-secondary ring-1 ring-fg-brand-primary ring-inset"
                      : "text-secondary hover:bg-secondary_hover",
                  )}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                    {done ? (
                      <Check className="size-4 text-success-primary" aria-label="已点" />
                    ) : entry.needsPick ? (
                      <span className="size-1.5 rounded-full bg-fg-brand-primary" />
                    ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2">{entry.label}</span>
                    {picked !== undefined && (
                      <span className="text-label font-normal text-tertiary">{picked}</span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>
        ))}
      </nav>
    </aside>
  );
}
