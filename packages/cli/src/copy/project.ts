import { type CopyEntry, copy, type ErrorCopy, type ProjectIdentity } from "@product-loop/model";
import type { OldLayoutKind } from "../project/old-layout.ts";

// 命令行按目录找项目时的报错，见「03 数据模型」第五节和「04 命令行」第六节。
// message 写什么不对，hint 写怎么改，在哪里写进 where。暂时放在命令行里，以后并进共用定义的文案表。

const root = "/Users/me/proj/app";

/** project.json 读不出来、不是 JSON 或者格式不对。它只由命令写，所以怎么改都是运行迁移检查。 */
const identity = {
  unreadable: copy("project.json 读不出来：{reason}。", { reason: "没有读它的权限" }),
  syntax: copy("project.json 不是合法的 JSON。"),
  notObject: copy("project.json 的最外层要是一个 JSON 对象。"),
  missing: copy("project.json 缺少 {field}，应当写{meaning}。", {
    field: "projectId",
    meaning: "项目名，只用小写字母、数字和短横",
  }),
  invalid: copy("project.json 的 {field} 写法不对，应当写{meaning}。", {
    field: "skillVersion",
    meaning: "项目所用的 skill 版本，例如 0.0.1",
  }),
  unknownField: copy("project.json 里有不认识的字段 {field}。", { field: "root" }),
  hint: copy("project.json 只由命令写，不要手改。运行 ploop doctor 做迁移检查。"),
  /** 位置：JSON 写坏了写到行和列，格式不对写到字段。 */
  atLine: copy("{file} 第 {line} 行第 {column} 列", {
    file: `${root}/.product-loop/project.json`,
    line: 3,
    column: 5,
  }),
  atField: copy("{file} → {field}", {
    file: `${root}/.product-loop/project.json`,
    field: "mainlineBase.hash",
  }),
  /** 每个字段应当写什么，接在 missing 和 invalid 的「应当写」后面。 */
  field: {
    schemaVersion: copy("格式版本 1"),
    projectId: copy("项目名，只用小写字母、数字和短横"),
    skillVersion: copy("项目所用的 skill 版本，例如 0.0.1"),
    mainlineBase: copy("主线的基准修订 revision 和全文的 SHA-256 hash"),
  } satisfies Record<keyof ProjectIdentity, CopyEntry>,
};

/** 三种旧布局，见「08 版本与迁移」第四节。{files} 是找到的旧文件，用顿号隔开。 */
const oldLayout = {
  projectCache: {
    message: copy("项目缓存里有 {files}，没有 project.json，迁移还没有完成。", {
      files: "主线.md、决定.md、队列.md、walk/",
    }),
    hint: copy("运行 ploop doctor，按它的报告迁移。"),
  },
  docs: {
    message: copy("产品循环的旧文件还在 docs/ 下，有 {files}。", {
      files: "主线.md、决定.md、队列.md",
    }),
    hint: copy("运行 ploop doctor，按它的报告迁移。"),
  },
  folder: {
    message: copy("这是旧 skill 的产品文档文件夹，里面有 {files}。", {
      files: "主线.md、决定.md、队列.json、walk/、land/",
    }),
    hint: copy("到项目根目录运行 ploop doctor --from {dir}。", {
      dir: "/Users/me/Documents/产品循环/skill自己的产品文档",
    }),
  },
} satisfies Record<OldLayoutKind, ErrorCopy>;

export const projectCopy = {
  /** 从家目录开始找，或者 --project 指到家目录。 */
  home: {
    message: copy("家目录不能当项目根目录，否则项目缓存和集中存储会是同一个文件夹。"),
    hint: copy("要开工就到项目的根目录运行 ploop init，或者用 --project 指定项目。"),
  },
  /** --project 写的既不是路径，也不是项目名。 */
  option: {
    message: copy("--project 的取值「{value}」既不是路径，也不是项目名。", {
      value: "Sketch_Board",
    }),
    hint: copy("路径要含有 /，例如 ./app。项目名只用小写字母、数字和短横，例如 sketch-board。"),
  },
  /** --project 写的路径不存在，或者不是目录。 */
  missingDir: {
    message: copy("目录 {path} 不存在。", { path: `${root}/src` }),
    hint: copy("--project 写项目里任何一个目录的路径，或者写项目名。"),
  },
  /** 往上找到边界也没有项目。 */
  none: {
    message: copy("从 {from} 找到 {to}，都没有项目缓存。", { from: `${root}/src`, to: root }),
    /** 起点就是找的边界，只看了这一个目录。 */
    here: copy("{dir} 里没有 .product-loop/project.json。", { dir: root }),
    hint: copy("要开工就到项目根目录运行 ploop init，或者用 --project 指定项目。"),
  },
  /** 找到的目录不是这个项目登记过的根目录。 */
  unregistered: {
    message: copy("项目缓存里记着项目 {projectId}，集中存储里没有登记它。", {
      projectId: "app",
    }),
    hint: copy(
      "运行 ploop init 重新登记，项目缓存里的主线.md 和各阶段的文件保留。数据库恢复过较早的备份时常有这种情况。",
    ),
  },
  identity,
  oldLayout,
};
