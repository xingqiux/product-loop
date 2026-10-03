import { copy } from "@product-loop/model";

// 收使用记录的文案：报错写什么不对、怎么改，下一步写完整的命令，见「04 命令行」第四到六节。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

const path = "shots/S3-2-1400.png";
const hash = "3f7a";
const rerun = "重跑 ploop use run，或者用 ploop use ingest 重新收下这次的输出。命令会先上传截图。";

export const useRunsCopy = {
  /** 没有开着的阶段。使用记录挂在阶段上，见「03 数据模型」第二节。 */
  noRound: {
    message: copy("项目 {project} 现在没有开着的阶段，使用记录要收进一个阶段里。", {
      project: "app",
    }),
    hint: copy("先运行 ploop round start 使用，再重跑使用代码。"),
  },
  /** 按阶段查最近一次运行时，项目里没有这个阶段。 */
  roundNotFound: {
    message: copy("项目「{project}」没有{round}。", { project: "app", round: "第 2 版的使用阶段" }),
    hint: copy("运行 ploop version show，查看当前这一版有哪几个阶段。"),
  },
  shot: {
    /** use-run.json 写了截图，命令行却没有交这张截图的哈希。 */
    unmapped: {
      message: copy("截图 {path} 没有交哈希。", { path }),
      hint: copy(rerun),
    },
    /** 同一个路径交了两个不同的哈希。 */
    twoHashes: {
      message: copy("截图 {path} 交了两个不同的哈希。", { path }),
      hint: copy("每个路径只交一个哈希，也就是这张截图内容的 SHA-256。"),
    },
    badHash: {
      message: copy("截图 {path} 的哈希「{hash}」写得不对。", { path, hash }),
      hint: copy("写截图内容的 SHA-256，是六十四位小写十六进制。"),
    },
    /** 规矩 use.shots.present：截图都已上传。 */
    missing: {
      message: copy("截图 {path} 还没有上传，它的哈希是 {hash}。", { path, hash }),
      hint: copy(rerun),
    },
    notPng: {
      message: copy("截图 {path} 不是 PNG。", { path }),
      hint: copy("使用代码的截图只收 PNG。改成存 PNG 以后，重跑使用代码。"),
    },
    corrupt: {
      message: copy("截图 {path} 读不出来，文件可能坏了。", { path }),
      hint: copy("重新截这张图，再重跑使用代码。"),
    },
    tooLarge: {
      message: copy("截图 {path} 超过了 {limit} 个像素。", { path, limit: 40_000_000 }),
      hint: copy("只截这一步要看的部分，或者把窗口调小一些。"),
    },
  },
  /** 规矩 use.scene.known 的警告：场景编号和步号要在最新的主线里。 */
  scene: {
    unknown: {
      message: copy("场景 {scene} 不在最新的主线里。", { scene: "S9" }),
      hint: copy("核对使用代码里的场景编号。这是新加的场景时，先把它写进主线.md。"),
    },
    unknownStep: {
      message: copy("主线里的场景 {scene} 没有第 {step} 步。", { scene: "S3", step: 7 }),
      hint: copy("核对使用代码里的步号，它和主线里这个场景的步骤编号相同。"),
    },
  },
};
