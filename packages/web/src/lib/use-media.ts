// 窗口宽度够不够放宽屏的版式。一千一百像素以下退回窄的版式（主线的「布局」一节），
// 半屏的窗口（七百到一千一百像素）也要能用，不出横向滚动。
import { useSyncExternalStore } from "react";

/** 宽屏的版式从这个宽度起。globals.css 里的 wide 变体用同一个数。 */
const wideQuery = "(min-width: 1100px)";

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
  );
}

/** 窗口有一千一百像素宽吗。 */
export function useWide(): boolean {
  return useMedia(wideQuery);
}
