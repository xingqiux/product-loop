import { defineEnum, type KeyOf } from "@product-loop/model";

// 迁移检查的检查项和结论，见「08 版本与迁移」第四节的表。检查项的顺序和表相同。
// 输出和 --json 里写中文，代码里用英文键，见约定 0002 第 1 条。

/** 第四节表里的十二个检查项。 */
export const doctorItem = defineEnum({
  identity: "身份",
  location: "位置",
  ignore: "忽略规则",
  mainline: "主线",
  decisions: "决定",
  queue: "队列",
  stageName: "阶段名",
  pages: "旧页面",
  landRecords: "落地记录",
  useCode: "使用代码",
  skillVersion: "skill 版本",
  cache: "缓存",
});
export type DoctorItem = KeyOf<typeof doctorItem>;

/**
 * 一项的结论，按要紧的程度从低到高排。
 * - ok：没有要做的事。
 * - info：只报告，不改，例如使用代码。
 * - fix：有要迁移的内容，--fix 按第四节的做法处理，不用判断。
 * - confirm：有要 AI 确认的地方，确认以后 --fix 才能执行。
 */
export const doctorStatus = defineEnum({
  ok: "通过",
  info: "只报告",
  fix: "要迁移",
  confirm: "要确认",
});
export type DoctorStatus = KeyOf<typeof doctorStatus>;

/** 旧文件在哪里：三种旧布局，见 project/old-layout.ts。 */
export const legacyLayout = defineEnum({
  projectCache: "项目缓存",
  docs: "docs 下",
  folder: "旧文件夹",
});

/** 一个检查项的结论：发现了什么、--fix 做什么、要 AI 确认什么，每样一句一行。 */
export type DoctorCheck = {
  readonly item: DoctorItem;
  readonly status: DoctorStatus;
  readonly found: readonly string[];
  readonly fix: readonly string[];
  readonly confirm: readonly string[];
};

/** 按三组行定结论：有要确认的是 confirm，有要迁移的是 fix，都没有时看 quiet。 */
export function checkOf(
  item: DoctorItem,
  lines: {
    readonly found?: readonly string[];
    readonly fix?: readonly string[];
    readonly confirm?: readonly string[];
  },
  quiet: DoctorStatus = "ok",
): DoctorCheck {
  const found = lines.found ?? [];
  const fix = lines.fix ?? [];
  const confirm = lines.confirm ?? [];
  const status = confirm.length > 0 ? "confirm" : fix.length > 0 ? "fix" : quiet;
  return { item, status, found, fix, confirm };
}
