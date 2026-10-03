import { copy } from "@product-loop/model";

// 登记在后端的规则的报错：message 写什么不对，hint 写怎么改，见「04 命令行」第六节。
// 规则查什么、依据是什么写在 model 的 rulesCopy.about 里，维护说明的规则表由它生成。
// 暂时放在后端。以后并进 model 的文案表，由 allCopy() 汇总，跑写作校验。

export const backendRulesCopy = {
  /** 规矩 round.batch.covered：这个阶段拿出来的事，每一件都出现在某张卡上。 */
  batchCovered: {
    message: copy("这个阶段拿出来的 {id}「{content}」没有出现在任何一张卡上。", {
      id: "Q12",
      content: "队列看板上的事按阶段分组",
    }),
    hint: copy(
      "在处理它的卡或更改上写 queue，列出 {id}。这个阶段不做它，就用 ploop queue drop 取消并写原因，或者用 ploop queue wait 改成等待并写明依赖。",
      { id: "Q12" },
    ),
  },
  /** 规矩 page.oneWaiting：同一项目同一时间只有一页在等用户点。 */
  oneWaiting: {
    message: copy("{round}的第 {page} 页还在等用户点，同一时间只能有一页在等。", {
      round: "第 2 版的检查阶段",
      page: 2,
    }),
    hint: copy(
      "先运行 ploop reply wait 取回用户的回复。要换掉那一页，运行 ploop page withdraw 撤回它，再给出这一页。",
    ),
  },
  /** 规矩 page.cards.none：要用户点的页至少有一张卡。 */
  cardsNone: {
    message: copy("这一页要用户点，却一张卡都没有，用户没有可点的内容。"),
    hint: copy("按这个阶段的定义写卡片，运行 ploop page schema 查看。只给用户看的页加 --view。"),
  },
  /** 规矩 blob.present：页面引用的每张截图都已上传。 */
  blobPresent: {
    message: copy("截图 {path} 还没有上传到附件库。", { path: "img/before.png" }),
    hint: copy("确认这个文件在工作区里，再运行 ploop page present，命令会先上传页面引用的截图。"),
  },
  /** 规矩 reply.line.handled：给出信息和开始阶段以前，每一行回复都有了去处。 */
  lineHandled: {
    message: copy("{round}的回复还有几行没有处理：{lines}。", {
      round: "第 1 版的构思阶段（第 3 次）",
      lines: "第 3 行、第 5 行",
    }),
    hint: copy("运行 ploop reply show 看这几行，再用 ploop reply handle 给每一行定去处。"),
  },
  /** 规矩 reply.images.read：处理带图的行时，要确认已经读过图。 */
  imagesRead: {
    message: copy("第 {line} 行带了 {count} 张图，还没有确认读过。", { line: 3, count: 2 }),
    hint: copy("运行 ploop reply show 下载这一行的图，读完再加 --read-images 处理。"),
  },
  /** 规矩 align.unclear.reworded：上一份回复点了不明白的术语，这一页要换讲法。 */
  /** 规矩 screens.coverChanged：检查阶段的元素清单盖住这一版新出现和变过的每一屏。 */
  coverChanged: {
    message: copy("这一版 {scene} 第 {step} 步的屏新出现或变过，元素清单里没有它。", {
      scene: "S3",
      step: 2,
    }),
    hint: copy("在 screens 里加这一屏，where 写场景编号和步号，逐样写它是什么、回答什么问题。"),
  },
  unclearReworded: {
    message: copy("用户在 {round} 点了不明白的「{name}」，这一页的意思和例子都没变。", {
      round: "v1-构思-3",
      name: "端口文件",
    }),
    hint: copy("换一种讲法：改写意思，或者换一个这个项目里的例子。"),
  },
};
