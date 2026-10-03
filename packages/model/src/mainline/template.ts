import { designSpecItem, mainlinePart } from "./parts.ts";

// ploop init 写进项目缓存的主线模板，见「04 命令行」第九节。
// 只写标题：十样的二级标题带编号，设计规范下面是十二样的三级标题，不写示例的正文。
// 这样新项目的主线仍然报出十样都缺，见 S13 第 3 步。场景的标题由 AI 按 `### S1 名字` 写。

/** 主线模板的全文，末尾带换行。 */
export function mainlineTemplate(): string {
  const lines = ["# 主线", ""];
  for (const [i, label] of mainlinePart.labels.entries()) {
    lines.push(`## ${i + 1} ${label}`, "");
    if (label === mainlinePart.label("designSpec")) {
      for (const item of designSpecItem.labels) lines.push(`### ${item}`, "");
    }
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
