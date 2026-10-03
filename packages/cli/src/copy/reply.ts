import { copy } from "@product-loop/model";
import { transitionalDate } from "./help.ts";

// ploop reply wait|show|handle|ingest 的文案，见「04 命令行」第八节和 S17。
// 暂时放在命令行里，以后并进共用定义的文案表。

const page = "第 1 版的落地阶段的第 3 页";
const replyFile = ".product-loop/rounds/v1-落地-1/reply.md";
const imageDir = ".product-loop/rounds/v1-落地-1/reply-img/";

export const replyCopy = {
  help: {
    description: copy("回复的等待、查看和处理"),
    wait: {
      description: copy("等用户提交回复"),
      details: {
        prints: copy("提交后打印回复的每一行，并下载回复里的图。"),
        noReplay: copy("没有在等的页时报没有，不重放处理完的旧回复。"),
      },
      timeout: copy("最多等多少秒，写 0 表示一直等；不写就是 540 秒"),
      blocks: {
        timeout: {
          situation: copy("到了时限，用户还没提交，退出码 7"),
          fix: copy("再运行一次同样的命令"),
        },
        gone: {
          situation: copy("等的时候页被撤回或阶段已收尾，退出码 8"),
          fix: copy("运行 ploop status"),
        },
      },
      reads: copy("集中存储的页面和回复"),
      writes: copy("项目缓存里这个阶段的 reply.md 和 reply-img/"),
      examples: {
        plain: copy("ploop reply wait"),
        forever: copy("ploop reply wait --timeout 0"),
      },
      after: copy("ploop reply handle，给每一行定去处"),
    },
    show: {
      description: copy("查看一份回复的每一行"),
      details: { images: copy("同时下载回复里的图。") },
      submission: copy("回复的编号；不写就是最近的一份"),
      reads: copy("集中存储的回复"),
      writes: copy("项目缓存里这份回复所在阶段的 reply.md 和 reply-img/"),
      examples: { plain: copy("ploop reply show"), byId: copy("ploop reply show 12") },
      after: copy("ploop reply handle <行> <去处> <说明>"),
    },
    handle: {
      description: copy("给回复的行定去处"),
      details: {
        destination: copy("去处写主线、决定、队列、当场做、不处理之一。"),
        detail: copy("说明随去处：主线写改的部分，队列写 Q12 或新事的内容。"),
        restage: copy("队列写已有的编号时，加 --stage 就是把它改标到那个阶段，编号不变。"),
        evidence: copy("当场做写证据，不处理写原因。"),
        decision: copy("决定的三项写 --decision、--reason、--case。"),
        file: copy("--file 的文件是数组，每项写 line、to 和去处要的字段："),
        fileMainline: copy("主线写 part，决定写 decision、reason、case，"),
        fileQueue: copy("队列写 id（可加 stage），或写 item（content、stage），"),
        fileRest: copy("当场做写 evidence，不处理写 reason。"),
      },
      line: copy("第几行"),
      destination: copy("去处：主线、决定、队列、当场做、不处理"),
      detail: copy("说明：随去处而定，写法见「细节」"),
      file: copy("多行处理的 JSON 文件，格式见「细节」"),
      submission: copy("回复的编号；不写就是最近的一份"),
      readImages: copy("这些行带的图已经读过"),
      decision: copy("去处是决定时，决定写什么；也可以写在第三个参数里"),
      reason: copy("去处是决定时，原因"),
      case: copy("去处是决定时，案例"),
      stage: copy("去处是队列时，要做它的阶段：放进新的一件，或把已有的一件改标到这个阶段"),
      revision: copy("去处是主线时，主线的第几次修订；不写就是最新的一次"),
      blocks: {
        images: {
          situation: copy("这一行带图，没有写 --read-images"),
          fix: copy("先读 reply-img/ 里的图，再加 --read-images"),
        },
        mainline: {
          situation: copy("去处是主线，主线还没有新的修订"),
          fix: copy("先改主线.md，再处理这一行"),
        },
      },
      reads: copy("集中存储的回复，--file 写的文件"),
      writes: copy("回复各行的去处，当场建出的决定和队列事项；主线.md 有改动先交成新修订"),
      examples: {
        none: copy('ploop reply handle 3 不处理 "已经在第一屏"'),
        queue: copy('ploop reply handle 4 队列 "看板按阶段分列" --stage 落地'),
        restage: copy("ploop reply handle 4 队列 Q12 --stage 落地"),
        decision: copy(
          'ploop reply handle 5 决定 --decision "看板放首页" --reason "每次都要看" --case "打开就看到"',
        ),
        file: copy("ploop reply handle --file destinations.json"),
      },
      after: copy("还有没处理的行就接着处理；都处理完再给出下一页"),
    },
    ingest: {
      description: copy(`收下贴回的回复，${transitionalDate} 删除`),
      details: { split: copy("用户在对话里贴回的回复，按旧格式拆成一行一行。") },
      file: copy("回复文字所在的文件，写 - 就从标准输入读"),
      reads: copy("这个文件，集中存储的在等的页"),
      writes: copy("集中存储的回复，项目缓存里这个阶段的 reply.md"),
      examples: { plain: copy("ploop reply ingest reply.txt") },
      after: copy("ploop reply handle，给每一行定去处"),
    },
  },
  output: {
    received: copy("收到了回复：{page}，{count} 行", { page, count: 4 }),
    ingested: copy("收下了回复：{page}，{count} 行", { page, count: 4 }),
    shown: copy("回复 {id}：{page}，{count} 行，还没处理 {pending} 行", {
      id: 12,
      page,
      count: 4,
      pending: 2,
    }),
    none: copy("这个项目还没有回复。"),
    source: copy("来源：{source}，提交于 {at}", { source: "工作台", at: "2026-09-28 16:05" }),
    row: copy("第 {line} 行  {where}{kind}{extra}", {
      line: 1,
      where: "疑问「导出格式」  ",
      kind: "只写了备注",
      extra: "：先放第一屏",
    }),
    /** 卡片写标题，编号只在 --json 里。 */
    card: copy("「{title}」", { title: "导出格式" }),
    cardNth: copy("「{title}」（第 {n} 张）", { title: "导出格式", n: 2 }),
    where: copy("{section}{card}  ", { section: "疑问", card: "「导出格式」" }),
    section: copy("{section}  ", { section: "看板" }),
    option: copy(" {option}", { option: "b" }),
    queue: copy(" {queue}", { queue: "Q2" }),
    note: copy("：{note}", { note: "先放第一屏" }),
    image: copy("  图：{path}", { path: `${imageDir}1-1.png` }),
    actorCli: copy("命令行"),
    actorWeb: copy("工作台"),
    handled: copy("  去处：{destination}（{by}）", { destination: "队列 Q4", by: "后端" }),
    to: {
      mainline: copy("主线修订 {revision} 的{part}", { revision: 3, part: "场景" }),
      decision: copy("决定 {id}", { id: 7 }),
      queue: copy("队列 {id}", { id: "Q4" }),
      doneHere: copy("当场做，{evidence}", { evidence: "改了标题" }),
      noAction: copy("不处理，{reason}", { reason: "已经在第一屏" }),
    },
    saved: copy("回复的副本：{file}", { file: replyFile }),
    images: copy("图下载到了：{dir}", { dir: imageDir }),
    noCache: copy("没有项目缓存，回复的副本和图都没有写。"),
    stillWaiting: copy("还没有回复：{page}，等了 {seconds} 秒", { page, seconds: 540 }),
    retry: copy("连不上后端：{message}。{seconds} 秒后重试。", {
      message: "连接被拒绝",
      seconds: 2,
    }),
    handledHead: copy("处理了 {count} 行：回复 {submission}，{round}", {
      count: 2,
      submission: 12,
      round: "第 1 版的落地阶段",
    }),
    decisionMade: copy("建了决定 {id}：{decision}", { id: 7, decision: "看板放首页" }),
    queued: copy("放进队列 {id}：{content}", { id: "Q5", content: "看板按阶段分列" }),
    restored: copy("捞回待办 {id}：{content}", { id: "Q2", content: "提交以后写明回复被取走了" }),
    restaged: copy("改标了 {id}：{stage}阶段，{content}", {
      id: "Q4",
      stage: "落地",
      content: "看板按阶段分列",
    }),
    remaining: copy("还没处理：{lines}", { lines: "第 3 行、第 5 行" }),
    lineRef: copy("第 {line} 行", { line: 3 }),
    allHandled: copy("这份回复的每一行都有了去处。"),
    text: copy("## 回复的原文"),
    /** 处理回复的提醒，写在正文里，不放进下一步。 */
    readImages: copy("第 {lines} 行带图：先读 reply-img/，处理时加 --read-images。", {
      lines: "1、3",
    }),
    /** 去处和说明要 AI 定，写不成一条能直接运行的命令，所以写在正文里，不放进下一步。 */
    handleNext: copy("ploop reply handle {line} <去处> <说明>", { line: 1 }),
    handleFile: copy("ploop reply handle --file <文件>"),
  },
  /** 下一步，每条是一条能直接运行的完整命令。 */
  next: {
    again: copy("ploop reply wait"),
    status: copy("ploop status"),
  },
  errors: {
    noWaiting: {
      message: copy("现在没有在等回复的页。"),
      hint: copy("先运行 ploop page present，给出一页要用户点的页。"),
    },
    /** 有过回复，也都处理完了：不再把旧回复当成新回复返回。 */
    noWaitingHandled: {
      message: copy("现在没有在等回复的页，上一份回复也处理完了。"),
      hint: copy("要再看上一份回复，运行 ploop reply show。"),
    },
    /** 有只看的页，没有要用户点的页：只看的页不等回复，见决定 204。 */
    viewOnly: {
      message: copy("现在没有要用户点的页：{round}给出的页只给用户看，不等回复。", {
        round: "第 1 版的使用阶段",
      }),
      hint: copy("用户看过以后，运行 ploop round close 收尾，不用等回复。"),
    },
    noReply: {
      message: copy("这个项目还没有回复。"),
      hint: copy("先运行 ploop reply wait，等用户提交。"),
    },
    handleArgs: {
      message: copy("没有写要处理的行。"),
      hint: copy("写 ploop reply handle <行> <去处> <说明>，或用 --file 写文件。"),
    },
    handleBoth: {
      message: copy("--file 和逐行的参数只能写一样。"),
      hint: copy("多行用 --file，一行用 ploop reply handle <行> <去处> <说明>。"),
    },
    destination: {
      message: copy("去处「{text}」不是五种之一。", { text: "以后" }),
      hint: copy("去处写主线、决定、队列、当场做、不处理之一。"),
    },
    detailMissing: {
      message: copy("去处是{destination}时要写说明。", { destination: "不处理" }),
      hint: copy("{hint}", { hint: "不处理写原因，例如 已经在第一屏。" }),
    },
    detailHints: {
      mainline: copy("主线写改的是哪一样，例如 场景。"),
      queue: copy(
        "队列写已有的编号，例如 Q12，或新事的内容加 --stage；编号加 --stage 是改标阶段。",
      ),
      doneHere: copy("当场做写完成的证据，例如 改了标题。"),
      noAction: copy("不处理写原因，例如 已经在第一屏。"),
    },
    /** --file 写的既不是数组也不是对象。 */
    fileShape: {
      message: copy("{file} 里要写一个数组，每项处理一行；只处理一行时也可以写一个对象。", {
        file: "destinations.json",
      }),
      hint: copy("每项写 line、to 和去处要的字段。哪些字段运行 ploop reply handle --help 查看。"),
    },
    /** 后端报的位置换成第几行的写法，文件里没写行号时按第几项。 */
    at: {
      line: copy("第 {line} 行", { line: 3 }),
      item: copy("文件里第 {n} 项", { n: 2 }),
      field: copy("{line}的 {field}", { line: "第 3 行", field: "--stage" }),
    },
    /** 决定三项缺了，写明每一项怎么给。 */
    decisionHint: copy(
      "去处是决定要写三项：--decision、--reason、--case。用 --file 时写 decision、reason、case。",
    ),
    /** 队列里放进新的一件，阶段没写。 */
    stageMissing: {
      message: copy("{line}要放进队列的是新的一件事，没写要做它的阶段。", { line: "第 3 行" }),
      hint: copy(
        "加 --stage <阶段名>，写五个阶段之一。用 --file 时写 item.stage。已有的事写它的编号，例如 Q12。",
      ),
    },
    /** 后端只给了泛泛的怎么改时，换成它。 */
    entryHint: copy("运行 ploop reply handle --help，查看每种去处要写哪几项。"),
    lineInvalid: {
      message: copy("行号要写从 1 起的整数，这里是「{text}」。", { text: "abc" }),
      hint: copy("运行 ploop reply show，查看每一行的行号。"),
    },
    fileUnreadable: {
      message: copy("{file} 读不出来：{reason}。", {
        file: "destinations.json",
        reason: "文件不存在",
      }),
      hint: copy("写对文件的路径，相对当前目录或项目缓存。"),
    },
    fileJson: {
      message: copy("{file} 不是合法的 JSON：{reason}。", {
        file: "destinations.json",
        reason: "Unexpected token",
      }),
      hint: copy("文件里写一个数组，每项写 line、to 和去处要的字段。"),
    },
    download: {
      message: copy("图 {hash} 没有下载下来：{reason}。", { hash: "3f2a9c1b", reason: "404" }),
      hint: copy("运行 ploop reply show，再下载一次。"),
    },
    empty: {
      message: copy("{file} 是空的。", { file: "reply.txt" }),
      hint: copy("把用户在对话里贴回的文字写进这个文件。"),
    },
  },
};
