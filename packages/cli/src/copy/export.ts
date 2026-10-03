import { copy } from "@product-loop/model";

// ploop export 和 ploop storage 的文案，见「03 数据模型」第六节和第九节。
// 暂时放在命令行里，以后并进共用定义的文案表。

const dir = "ploop-export-app-20260928T160500Z";

export const exportCopy = {
  help: {
    export: {
      description: copy("导出项目的数据"),
      details: {
        what: copy("写成文件夹：主线、决定、队列和每个阶段的 JSON。"),
        where: copy("默认在集中存储的 exports/ 下新建，不在当前目录留东西。"),
        stamp: copy("默认的文件夹名里，时间是 UTC，以 Z 结尾。"),
        legacy: copy("--legacy 按旧格式写回项目缓存，过渡用法，2026-12-31 删除。"),
      },
      legacy: copy("按旧格式写回项目缓存，供退回旧 skill（过渡用法，2026-12-31 删除）"),
      out: copy("导出到这个文件夹，相对当前目录；不写就用默认的"),
      blocks: {
        exists: { situation: copy("导出的文件夹已经在了"), fix: copy("换一个 --out，或删掉它") },
        noCache: {
          situation: copy("--legacy 时找不到项目缓存"),
          fix: copy("到项目的根目录里运行，不用 --project 写编号"),
        },
      },
      reads: copy("集中存储的主线、决定、队列、阶段、页面和回复"),
      writes: copy("集中存储的 exports/ 下的新文件夹；--out 就写那个文件夹"),
      examples: { plain: copy("ploop export"), legacy: copy("ploop export --legacy") },
      after: copy("--legacy 以后，把 skill 的链接改回旧正文"),
    },
    storage: {
      description: copy("查看集中存储的占用"),
      details: { what: copy("按项目列出附件、没有引用的附件和数据库的大小。") },
      reads: copy("集中存储"),
      writes: copy("不写"),
      examples: { plain: copy("ploop storage") },
      after: copy("没有引用的附件多时，运行 ploop backup gc"),
    },
  },
  output: {
    exported: copy("导出了：{dir}，{count} 个文件", { dir, count: 5 }),
    utc: copy("文件夹名里的时间是 UTC。"),
    legacy: copy("按旧格式写回了：{dir}", { dir: ".product-loop" }),
    legacyNext: copy("把 skill 的链接改回旧正文"),
    file: copy("  {path}", { path: "决定.md" }),
    storage: copy("集中存储的占用：附件 {count} 个，{size}；数据库 {database}", {
      count: 120,
      size: "150.2 MB",
      database: "3.1 MB",
    }),
    projectRow: copy("  {project}  附件 {count} 个，{size}", {
      project: "待办工具（app）",
      count: 80,
      size: "96.0 MB",
    }),
    unreferenced: copy("没有引用的附件 {count} 个，{size}", {
      count: 3,
      size: "1.2 MB",
    }),
    unreferencedNote: copy("超过七天的，ploop backup gc 会删除。"),
  },
  errors: {
    exists: {
      message: copy("{dir} 已经在了，没有导出。", { dir }),
      hint: copy("用 --out 写一个新的文件夹，或者先删掉它。"),
    },
    noCache: {
      message: copy("--legacy 要写回项目缓存，这里找不到项目缓存。"),
      hint: copy("到项目的根目录里运行 ploop export --legacy。"),
    },
  },
};
