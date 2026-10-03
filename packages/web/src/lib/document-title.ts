// 标签页的标题：前面写这一页是哪个项目的什么，后面是产品循环。同时开几个项目的页面时，一眼分得出哪个是哪个。
import { useEffect } from "react";

const app = "产品循环";

/** 把前面几段用空格连起来，没有内容的段跳过。 */
export function titleOf(parts: readonly (string | undefined)[]): string {
  const head = parts.filter((part) => part !== undefined && part !== "").join(" ");
  return head === "" ? app : `${head} - ${app}`;
}

export function useDocumentTitle(...parts: (string | undefined)[]): void {
  const title = titleOf(parts);
  useEffect(() => {
    document.title = title;
  }, [title]);
}
