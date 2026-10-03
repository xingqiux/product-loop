import type { MainlineProblemKind } from "../mainline/problems.ts";
import { copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 解析主线时查出的问题，键是 mainline/problems.ts 里的种类。message 写什么不对，hint 写怎么改。
// 场景和设计规范的写法见「09 skill 与软件」第三节，写作规范一节的写法见 ADR 0001 第 24 条。

const scene = "S14 会话中途接手";

const problem = {
  partDuplicate: {
    message: copy("主线里「{part}」写了 {count} 个二级标题。", { part: "场景清单", count: 2 }),
    hint: copy("合成一节，只留一个标题。解析时只用第一个标题下面的内容。"),
  },
  scenesNone: {
    message: copy("场景清单里没有认出任何场景。"),
    hint: copy(
      "每个场景写一个三级标题，例如「### S14 会话中途接手」。标题下面写谁在什么时候用和编号的步骤。",
    ),
  },
  sceneLegacy: {
    message: copy("场景「{scene}」是旧的写法。", { scene: "回答疑问" }),
    hint: copy(
      "标题改成「### 名字」，下一行写「谁在什么时候用：」，再写编号的步骤。场景编号由命令补上。",
    ),
  },
  sceneIdInvalid: {
    message: copy("场景标题开头的编号「{text}」写得不对。", { text: "S03" }),
    hint: copy(
      "编号写成大写的 S 加数字，数字前面不补 0，例如 S14。新场景可以不写编号，由命令补上。",
    ),
  },
  sceneIdDuplicate: {
    message: copy("{count} 个场景都写了编号 {id}。", { id: "S14", count: 2 }),
    hint: copy("一个编号只对应一个场景。新加的场景删掉编号，由命令补上新的编号。"),
  },
  sceneNameEmpty: {
    message: copy("场景的标题没有写名字。"),
    hint: copy("标题写成「### S14 会话中途接手」这样，编号后面写场景的名字。"),
  },
  sceneWhoMissing: {
    message: copy("场景「{scene}」没有写谁在什么时候用。", { scene }),
    hint: copy("标题下一行写「谁在什么时候用：」加内容。"),
  },
  sceneNoSteps: {
    message: copy("场景「{scene}」没有编号的步骤。", { scene }),
    hint: copy(
      "步骤写成编号列表，每步用「→」分成做什么和该看到什么。不是场景的标题，挪出场景清单。",
    ),
  },
  sceneExtraText: {
    message: copy("场景「{scene}」里有 {count} 行既不是步骤，也不是谁在什么时候用。", {
      scene,
      count: 2,
    }),
    hint: copy("场景里只写谁在什么时候用和编号的步骤。说明写到场景清单的开头，或者并进某一步。"),
  },
  stepArrowMissing: {
    message: copy("场景「{scene}」第 {step} 步没有「→」。", { scene, step: 2 }),
    hint: copy("每步用「→」分成两半：前面写做什么，后面写该看到什么。"),
  },
  stepArrowExtra: {
    message: copy("场景「{scene}」第 {step} 步有 {count} 个「→」。", { scene, step: 2, count: 2 }),
    hint: copy("一步只写一个「→」。一步里有两个动作的，拆成两步。"),
  },
  stepDoEmpty: {
    message: copy("场景「{scene}」第 {step} 步的「→」前面是空的。", { scene, step: 2 }),
    hint: copy("在「→」前面写这一步做什么。"),
  },
  stepExpectEmpty: {
    message: copy("场景「{scene}」第 {step} 步的「→」后面是空的。", { scene, step: 2 }),
    hint: copy("在「→」后面写这一步该看到什么。"),
  },
  stepNumber: {
    message: copy("场景「{scene}」的第 {step} 步编号写成了 {written}。", {
      scene,
      step: 3,
      written: 4,
    }),
    hint: copy("步骤从 1 起连续编号。页面上的位置按步号找步骤，编号要和先后一致。"),
  },
  designSpecDuplicate: {
    message: copy("设计规范里「{item}」写了 {count} 个标题。", { item: "配色", count: 2 }),
    hint: copy("合成一个三级标题。解析时只用第一个标题下面的内容。"),
  },
  designSpecEmpty: {
    message: copy("设计规范里「{item}」的标题下面是空的。", { item: "动效" }),
    hint: copy("写这个部分的值、规则或例子。这个产品没有这个部分的，写「无」和原因。"),
  },
  designSpecNoneReason: {
    message: copy("设计规范里「{item}」写了「无」，没有写原因。", { item: "动效" }),
    hint: copy("在「无」后面写这个产品为什么没有这个部分。"),
  },
  designSpecTable: {
    message: copy("设计规范写成了表格，十二个部分要各写一个三级标题。"),
    hint: copy("表格每一行改成一个三级标题，例如「### 配色」。"),
  },
  writingSpecDuplicate: {
    message: copy("主线里写作规范写了 {count} 节。", { count: 2 }),
    hint: copy("合成一节。解析时只用第一节的停用说法和例外。"),
  },
  writingSpecTable: {
    message: copy("写作规范里有一张表格，表头第一格没有「停用」两个字，认不出停用的说法。"),
    hint: copy("停用的说法写成两列的表格，表头写「停用的说法」和「改成什么」。"),
  },
  writingSpecReplacementEmpty: {
    message: copy("写作规范里停用的说法「{phrase}」没有写改成什么。", { phrase: "工作流" }),
    hint: copy("在第二列写改成什么。写作校验报错时，按它告诉写的人怎么改。"),
  },
  writingSpecEllipsis: {
    message: copy("写作规范里停用的说法「{phrase}」带省略号，这一条没有收下。", {
      phrase: "查……对不对",
    }),
    hint: copy("写作校验按原样查找停用的说法，带省略号的查不到。改成文字里会出现的完整说法。"),
  },
} satisfies Record<MainlineProblemKind, ErrorCopy>;

export const mainlineCopy = {
  problem,
  /** 好几个场景都没有写「谁在什么时候用」时合成一条，怎么改和单个的相同。 */
  sceneWhoMissingMany: copy("{count} 个场景没有写谁在什么时候用：{scenes}。", {
    count: 9,
    scenes: "S1、S2、S3",
  }),
  /** 报错的位置：主线文件和问题所在的行。 */
  where: copy("{file} 第 {lines} 行", { file: "主线.md", lines: "23" }),
};
