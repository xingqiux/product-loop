// 按键的两条规定，见「06 工作台」第四节：
// 1. 光标在输入框、列表里时，左右键归它们，不换屏。
// 2. 弹窗或展示卡片开着时，左右键归弹窗，不换屏。
// 点了选项以后光标在单选组里，按场景 S3 右键要换到下一屏，所以单选组只留上下键换选项。
// 为此在捕获阶段先拿到左右键，不让单选组收到。
import { useEffect } from "react";

const owners =
  "input:not([type=radio]):not([type=checkbox]), textarea, select, [contenteditable], [role=listbox], [role=grid], [role=tablist], [role=slider]";

export function useArrowKeys(onStep: (delta: -1 | 1) => void, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.defaultPrevented
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(owners)) return;
      if (document.querySelector("[role=dialog]") !== null) return;
      event.preventDefault();
      event.stopPropagation();
      onStep(event.key === "ArrowLeft" ? -1 : 1);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onStep, enabled]);
}
