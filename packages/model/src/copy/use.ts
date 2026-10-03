import type { UseRunCheckKind } from "../use-run.ts";
import { type CopyEntry, copy } from "./define.ts";

// 使用代码的输出格式：JSON Schema 里每个字段的说明，和格式本身查不出、要对照几个字段才能查的问题。
// ploop use schema 把说明原样打印给 AI 看，所以说明也放在文案表里，跑写作校验。

/** JSON Schema 的标题和每个字段的说明。 */
const schema = {
  title: copy("使用代码的输出"),
  run: copy("使用代码写进 PLOOP_USE_OUT 目录的 use-run.json。截图也放在这个目录里。"),
  schemaVersion: copy("输出格式的版本，现在是 1。"),
  startedAt: copy("开始运行的时间，写带时区的 ISO 8601。"),
  finishedAt: copy("运行结束的时间，写带时区的 ISO 8601。"),
  environment: copy("环境说明，例如浏览器、窗口大小、用了哪些假的外部服务。"),
  scenes: copy("这次运行走到的场景，每个场景一项。"),
  scene: copy("场景编号，和主线里的相同，例如 S14。"),
  steps: copy("这个场景的每一步。要看排版的步骤，在几个宽度下各写一项。"),
  step: copy("步号，和主线里这个场景的步骤编号相同，从 1 数。"),
  width: copy("截图时窗口的宽度，单位是像素。命令行的场景不写。"),
  do: copy("这一步做什么，照抄主线。"),
  expect: copy("这一步该看到什么，照抄主线。"),
  result: copy("结果。分不清是产品坏了还是环境坏了时，写「环境」。"),
  screenshot: copy("截图的路径，相对 PLOOP_USE_OUT 目录，只收 PNG。"),
  facts: copy("量到的事实，例如顶栏的文字、选项的个数。"),
  error: copy("没有通过时写原因：断在哪里、为什么没走，或者环境出了什么问题。"),
};

/** 要对照几个字段才能查出的问题，键是 use-run.ts 里的种类。 */
const check = {
  errorMissing: copy("结果是「{result}」的步骤要写 error，说明原因。", { result: "断了" }),
  errorOnPass: copy("结果是「通过」的步骤不写 error。"),
  widthMissing: copy("带截图的步骤要写 width，也就是截图时窗口的宽度。"),
  duplicateStep: copy("场景 {scene} 的第 {step} 步写了不止一项。", { scene: "S14", step: 2 }),
  duplicateStepAtWidth: copy("场景 {scene} 的第 {step} 步在宽度 {width} 下写了不止一项。", {
    scene: "S14",
    step: 2,
    width: 420,
  }),
  duplicateScene: copy("场景 {scene} 写了不止一项，每个场景只写一项。", { scene: "S14" }),
} satisfies Record<UseRunCheckKind, CopyEntry>;

export const useCopy = { schema, check };
