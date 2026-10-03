// 整行都能点的表：每行里有一个真正的按钮，Tab 停在按钮上，Enter 和空格都能打开，读屏说它是按钮。
// 按钮的一个伪元素铺满这一行，用鼠标点行上任何地方也是点它。行要给 rowClass，让这一行是定位的参照。
import type { ReactNode } from "react";

/** 放在 tr 上：整行是定位参照，鼠标移上去和键盘停上去时整行有底色和框线，焦点看得见。 */
export const rowClass =
  "relative cursor-pointer hover:bg-secondary_hover has-[button:focus-visible]:bg-secondary_hover has-[button:focus-visible]:outline-2 has-[button:focus-visible]:-outline-offset-2 has-[button:focus-visible]:outline-focus-ring";

export function RowButton({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
      className="text-left outline-none after:absolute after:inset-0 after:content-['']"
    >
      {children}
    </button>
  );
}
