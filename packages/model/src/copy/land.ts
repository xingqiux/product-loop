import type { RedGreenViolationKind } from "../command-run.ts";
import type { LandPlanProblemKind } from "../land-plan.ts";
import { copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 落地的报错：计划的七节，和同一件功能改动先失败后通过的两次运行。

/** 计划.md 的问题，键是 parseLandPlan 返回的问题种类。 */
const plan = {
  missing: {
    message: copy("计划里没有「{section}」这一节。", { section: "现状" }),
    hint: copy(
      "每节写成一个二级标题，例如「## 现状」。七节的名字见 ploop land plan --help。小改动只写要做的事、功能改动、用什么锁住现有的行为三节也行。",
    ),
  },
  /** 缺了两节以上时合成一条，缺的节名一行一个，写在这句话后面。 */
  missingMany: {
    message: copy("计划缺 {count} 节：", { count: 6 }),
    hint: copy(
      "每节写成一个二级标题，例如「## 现状」。七节的名字见 ploop land plan --help。小改动只写要做的事、功能改动、用什么锁住现有的行为三节也行。",
    ),
  },
  empty: {
    message: copy("计划里「{section}」这一节是空的。", { section: "现状" }),
    hint: copy("在这一节的标题下面写正文。"),
  },
  duplicate: {
    message: copy("计划里「{section}」这一节写了 {count} 次。", { section: "现状", count: 2 }),
    hint: copy("合成一节，只留一个标题。"),
  },
  tidyWord: {
    message: copy("「要不要先重构」这一节没有以「要」或「不要」开头。"),
    hint: copy("第一个词写「要」或「不要」。写「不要」时，接着写理由。"),
  },
  tidyReason: {
    message: copy("计划写了不要重构，但没有写理由，或者理由不到六个字。"),
    hint: copy("在「不要」后面写理由：为什么这一次不碰结构也好改。"),
  },
} satisfies Record<LandPlanProblemKind | "missingMany", ErrorCopy>;

/** 同一件功能改动的失败和通过两次运行对不上，键是 checkRedGreen 返回的种类。 */
const redGreen = {
  commandDiffers: {
    message: copy("通过时运行的命令和失败时的不是同一条。失败时是 {red}，通过时是 {green}。", {
      red: "pnpm vitest run src/list.test.ts",
      green: "pnpm vitest run",
    }),
    hint: copy("用失败时的那条命令重跑 ploop land green。同一条检查先失败后通过，才算数。"),
  },
  redPassed: {
    message: copy("改之前这条检查就通过了，它证明不了这件改动。"),
    hint: copy("换一条改之前会失败的检查，重跑 ploop land red。"),
  },
  greenFailed: {
    message: copy("改之后这条检查仍然没有通过，退出码是 {exitCode}。", { exitCode: 1 }),
    hint: copy("改到检查通过，再运行 ploop land green。"),
  },
  redCommitMissing: {
    message: copy("失败时的运行没有记下当时的提交。"),
    hint: copy("在项目的 git 仓库里运行 ploop land 的各条命令。"),
  },
  greenCommitMissing: {
    message: copy("通过时的运行没有记下当时的提交。"),
    hint: copy("在项目的 git 仓库里运行 ploop land 的各条命令。"),
  },
  sameCommit: {
    message: copy("通过时的提交和失败时的是同一个：{commit}。", { commit: "3f9c2e1" }),
    hint: copy("先提交这件改动，再运行 ploop land green。"),
  },
  commitNotAfter: {
    message: copy("通过时的提交 {green} 不在失败时的提交 {red} 之后。", {
      green: "a1b2c3d",
      red: "3f9c2e1",
    }),
    hint: copy(
      "在失败时的提交之后提交这件改动，再运行 ploop land green。改写过提交历史时，先重跑 ploop land red。",
    ),
  },
} satisfies Record<RedGreenViolationKind, ErrorCopy>;

export const landCopy = {
  plan,
  /** 报错的位置：计划文件和标题所在的行。 */
  planWhere: copy("{file} 第 {lines} 行", { file: "rounds/v2-落地-3/计划.md", lines: "12" }),
  redGreen,
};
