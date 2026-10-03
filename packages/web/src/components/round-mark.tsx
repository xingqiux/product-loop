// 一次阶段的状态小方块：颜色加符号，不单靠颜色表示意思（主线的无障碍一节）。
// 等用户回复是钟，进行中是三个点，已收尾是勾，没收尾是感叹号。颜色由调用的地方给。
import { AlertCircle, Check, Clock, DotsHorizontal } from "@untitledui/icons";
import { cx } from "@/lib/cx";

export type Look = "waiting" | "working" | "closed" | "unfinished";

const glyphs = {
  waiting: { icon: Clock, className: "text-white" },
  working: { icon: DotsHorizontal, className: "text-fg-brand-primary" },
  closed: { icon: Check, className: "text-white" },
  unfinished: { icon: AlertCircle, className: "text-white" },
} as const;

const sizes = {
  sm: { box: "size-4 rounded-sm", icon: "size-2.5" },
  md: { box: "size-6 rounded-md", icon: "size-3.5" },
} as const;

/** 方块本身只是图形，状态的文字由外面的提示、图例或读屏用的说明给。 */
export function RoundMark({
  look,
  size,
  className,
}: {
  look: Look;
  size: keyof typeof sizes;
  /** 底色和框线。 */
  className: string;
}) {
  const { icon: Icon, className: glyph } = glyphs[look];
  return (
    <span
      aria-hidden="true"
      className={cx("flex shrink-0 items-center justify-center", sizes[size].box, className)}
    >
      <Icon className={cx(sizes[size].icon, glyph)} strokeWidth={3} />
    </span>
  );
}
