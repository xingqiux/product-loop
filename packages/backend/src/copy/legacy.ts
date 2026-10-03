import { copy } from "@product-loop/model";

// 迁移的归档、导入和完成的文案，见「08 版本与迁移」第四节和第一期计划第 61 步。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const project = "app";
const path = "walk/2026-09-20/think-27.json";
const rerun = copy("重新运行 ploop doctor --fix，命令会重新打包。");

export const legacyCopy = {
  archive: {
    hashInvalid: {
      message: copy("请求里要写归档包的 SHA-256，这里是「{text}」。", { text: "abc" }),
      hint: copy("写六十四位小写十六进制。"),
    },
    hashMismatch: {
      message: copy("归档包的哈希对不上：请求里写的是 {expected}，收到的是 {actual}。", {
        expected: "3f2a9c1b",
        actual: "7d41e0aa",
      }),
      hint: rerun,
    },
    unreadable: {
      message: copy("归档包读不出来：{reason}。", { reason: "unexpected end of file" }),
      hint: rerun,
    },
    noManifest: {
      message: copy("归档包里没有文件清单 .ploop-manifest.json，或者清单写坏了。"),
      hint: rerun,
    },
    missing: { message: copy("清单里的 {path} 不在归档包里。", { path }), hint: rerun },
    extra: { message: copy("归档包里的 {path} 不在清单里。", { path }), hint: rerun },
    changed: {
      message: copy("归档包里的 {path} 和清单写的字节数或哈希不同。", { path }),
      hint: rerun,
    },
  },
  state: {
    completed: {
      message: copy("项目「{project}」已经迁移完成了。", { project }),
      hint: copy("不用再迁移。运行 ploop status，查看下一步。"),
    },
    notArchived: {
      message: copy("项目「{project}」还没有归档，不能导入。", { project }),
      hint: copy("运行 ploop doctor --fix，命令会先上传归档包。"),
    },
    imported: {
      message: copy("项目「{project}」已经导入过旧数据了。", { project }),
      hint: copy("运行 ploop doctor --fix，接着核对数量并完成迁移。"),
    },
    notImported: {
      message: copy("项目「{project}」还没有导入旧数据，不能完成迁移。", { project }),
      hint: copy("运行 ploop doctor --fix。"),
    },
    versionMissing: {
      message: copy("项目「{project}」没有进行中的第 1 版，旧的阶段没有地方放。", { project }),
      hint: copy("迁移要在刚登记的项目上做。运行 ploop doctor，查看项目的情况。"),
    },
  },
  counts: {
    item: {
      rounds: copy("阶段"),
      pages: copy("页面"),
      decisions: copy("决定"),
      queue: copy("队列事项"),
      images: copy("截图"),
    },
    mismatch: {
      message: copy("{item}的数量对不上：旧文件里有 {expected}，导入了 {actual}。", {
        item: "页面",
        expected: 12,
        actual: 11,
      }),
      hint: copy(
        "导入的数据已经整批撤回。查 migrate/ 里的对照，改好以后重新运行 ploop doctor --fix。",
      ),
    },
  },
  import: {
    blobMissing: {
      message: copy("附件 {hash} 还没有上传。", { hash: "3f2a9c1b" }),
      hint: copy("重新运行 ploop doctor --fix，命令会先上传截图。"),
    },
    imageUnlisted: {
      message: copy("旧页面 {page} 引用的截图 {path} 没有交来哈希。", {
        page: "2026-09-20/think-27",
        path: "img/home.png",
      }),
      hint: copy("截图要放在页面数据所在的日期文件夹里。放好以后重新运行 ploop doctor --fix。"),
    },
    pageWhere: copy("{page} → {where}", { page: "2026-09-20/think-27", where: "asks[0].title" }),
    queueDoing: {
      message: copy("{id} 的状态是进行中，迁移以后没有开着的阶段。", { id: "Q12" }),
      hint: copy("在队列迁移对照里改成待办或已完成。"),
    },
    queueField: {
      message: copy("{id} 是{status}，要写{field}。", {
        id: "Q12",
        status: "已完成",
        field: "完成证据",
      }),
      hint: copy("在队列迁移对照里补上这一格。"),
    },
    queueDuplicate: {
      message: copy("队列事项的编号 {id} 重复了。", { id: "Q12" }),
      hint: copy("重新运行 ploop doctor，命令会重新编号。"),
    },
  },
  complete: {
    reason: copy("迁移完成，旧的阶段都在这一版里"),
  },
};
