// 阶段状态的小标签：浅底加细框，字和圆点带颜色（配色 a）。
import { cx } from "@/lib/cx";
import { type RoundState, roundStateText } from "@/lib/rounds";

const dot: Record<RoundState, string> = {
  waiting: "bg-fg-brand-primary",
  working: "bg-fg-quaternary",
  closed: "bg-fg-quaternary",
};

const text: Record<RoundState, string> = {
  waiting: "text-brand-secondary",
  working: "text-secondary",
  closed: "text-tertiary",
};

export function StateBadge({ state }: { state: RoundState }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center gap-1.5 rounded-md bg-secondary px-1.5 py-0.5 text-label whitespace-nowrap ring-1 ring-secondary ring-inset",
        text[state],
      )}
    >
      <span className={cx("size-1.5 rounded-full", dot[state])} />
      {roundStateText[state]}
    </span>
  );
}
