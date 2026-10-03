import { copy } from "@product-loop/model";

// ploop page schema|check|present|withdraw 的文案，见「04 命令行」第二、三、六节和 S16。
// 暂时放在命令行里，以后并进共用定义的文案表。

const round = "第 2 版的检查阶段";
const file = "page.json";

export const pageCopy = {
  help: {
    description: copy("页面数据的定义、校验、给出和撤回"),
    path: copy("页面数据的文件或工作区；不写就读当前阶段的工作区"),
    schema: {
      description: copy("打印页面数据的定义"),
      details: {
        what: copy("打印 JSON Schema，写页面数据时对照。"),
        brief: copy("先看 --brief 的简表，用到哪个字段再看完整的。"),
        stage: copy("不写阶段名，就按当前的阶段。"),
      },
      stage: copy("按这个阶段打印，构思、使用、检查、落地、提升之一"),
      briefOption: copy("只列字段，一行一个，附一句说明"),
      blocksOption: copy("只列线稿能用的积木，一块一行"),
      blocks: {
        noRound: {
          situation: copy("这一版还没有开始任何阶段"),
          fix: copy("写 --stage，或先运行 ploop round start"),
        },
      },
      reads: copy("项目缓存的 project.json"),
      writes: copy("不写"),
      examples: {
        current: copy("ploop page schema > schema.json"),
        stage: copy("ploop page schema --stage 构思"),
        brief: copy("ploop page schema --brief"),
        blocks: copy("ploop page schema --blocks"),
      },
      after: copy("按定义写好页面数据，再运行 ploop page check"),
    },
    example: {
      description: copy("打印一份最小的页面数据"),
      details: {
        what: copy("打印的数据过得了数据定义，可以存成 page.json 再改。"),
        replace: copy("队列编号、场景和步号要换成这个项目里真有的。"),
        stage: copy("不写阶段名，就按当前的阶段。"),
      },
      stage: copy("构思、使用、检查、落地、提升之一"),
      blocks: {
        noRound: {
          situation: copy("没写阶段名，这一版又还没有开始任何阶段"),
          fix: copy("写阶段名，或先运行 ploop round start"),
        },
      },
      reads: copy("项目缓存的 project.json"),
      writes: copy("不写"),
      examples: {
        stage: copy("ploop page example --stage 检查 > page.json"),
        current: copy("ploop page example"),
      },
      after: copy("按项目里的事改好，再运行 ploop page check"),
    },
    check: {
      description: copy("只校验页面数据"),
      details: {
        readOnly: copy("只读：不上传截图，不交主线，不给出这一页。"),
        all: copy("一次列出全部拦截。"),
      },
      blocks: {
        json: {
          situation: copy("页面数据不是合法的 JSON"),
          fix: copy("按报错的行和列改好"),
        },
        rule: {
          situation: copy("页面数据不合规矩"),
          fix: copy("按每条拦截的「怎么改」改好再校验"),
        },
        file: {
          situation: copy("截图或文字来源的文件找不到"),
          fix: copy("改对路径或行号"),
        },
      },
      reads: copy("工作区的 page.json、cards/*.json 和 img/，文字来源写的文件"),
      writes: copy("规矩的命中记录，别的都不写"),
      examples: {
        current: copy("ploop page check"),
        file: copy(`ploop page check ${file}`),
      },
      after: copy("ploop page present"),
    },
    present: {
      description: copy("给出一页信息"),
      details: {
        steps: copy("校验、上传截图、摘录原文、存成一页。"),
        address: copy("最后打印这一页的地址。"),
      },
      view: copy("只给用户看，不要用户点，不等回复；使用阶段的页一律这样"),
      blocks: {
        waiting: {
          situation: copy("已有一页在等用户点"),
          fix: copy("运行 ploop reply wait，或 ploop page withdraw"),
        },
        rule: {
          situation: copy("页面数据不合规矩"),
          fix: copy("按每条拦截的「怎么改」改好再给出"),
        },
        reply: {
          situation: copy("上一个阶段的回复还有行没有处理"),
          fix: copy("先运行 ploop reply show，再用 ploop reply handle 处理"),
        },
      },
      reads: copy("工作区的 page.json、cards/*.json 和 img/，文字来源写的文件"),
      writes: copy("集中存储的页面、卡片、原文摘录和附件；主线.md 有改动时先交成新的一版"),
      examples: {
        current: copy("ploop page present"),
        view: copy("ploop page present --view"),
      },
      after: {
        wait: copy("要用户点的页：ploop reply wait"),
        view: copy("只看的页：ploop round close"),
      },
    },
    withdraw: {
      description: copy("撤回在等的一页"),
      details: {
        clickable: copy("有要用户点的页，撤回它。"),
        viewOnly: copy("没有，就撤回最近的只看的页。"),
      },
      reason: copy("撤回的原因，例如「用户在对话里回答了」"),
      reads: copy("项目缓存的 project.json"),
      writes: copy("集中存储的页面和阶段的状态"),
      examples: {
        plain: copy("ploop page withdraw"),
        reason: copy('ploop page withdraw --reason "用户在对话里回答了"'),
      },
      after: copy("ploop round close"),
    },
  },
  output: {
    passed: copy("通过：{round}的页面数据没有拦截", { round }),
    /** 简表的第一行：星号、怎么看完整的定义、怎么拿例子。 */
    briefNote: copy(
      "{stage}的页面数据，字段名后带 * 的必填。完整的定义运行 ploop page schema，最小的例子运行 ploop page example。",
      { stage: "检查" },
    ),
    presented: copy("给出了：{page}，{purpose}", {
      page: "第 2 版的检查阶段的第 1 页",
      purpose: "要用户点",
    }),
    address: copy("地址：{url}", { url: "http://127.0.0.1:4731/p/app/r/v2-%E6%A3%80%E6%9F%A5-1" }),
    /** 只看的页：不等回复，使用阶段的页都是这样，见决定 204。 */
    viewOnly: copy("这一页只给用户看，不等回复。"),
    cards: copy("卡片：{count} 张", { count: 3 }),
    images: copy("截图：上传了 {uploaded} 张，已有 {kept} 张", { uploaded: 2, kept: 1 }),
    excerpts: copy("原文：摘录了 {count} 段", { count: 1 }),
    withdrawn: copy("撤回了：{page}", { page: "第 2 版的检查阶段的第 1 页" }),
    /** 撤回以后的两条路：用户在对话里回答了，按回答处理；页本身有问题，改好重新给出。 */
    withdrawnNote: copy(
      "用户在对话里回答了，就按回答处理拿出来的事，再收尾。页有问题，就改好重新给出。",
    ),
  },
  errors: {
    /** 位置：数据文件本身写坏时写到行和列，别的写到字段的路径，见「04 命令行」第六节。 */
    atLine: copy("{file} 第 {line} 行第 {column} 列", { file, line: 3, column: 5 }),
    atField: copy("{file} → {field}", { file, field: "asks[0].sources[1]" }),
    syntax: {
      message: copy("页面数据不是合法的 JSON。"),
      hint: copy("按位置改好这一处，再运行一次。"),
    },
    notObject: {
      message: copy("页面数据的最外层要是一个 JSON 对象。"),
      hint: copy("最外层写成一个对象，键是区块名，区块名见 ploop page schema。"),
    },
    unreadable: {
      message: copy("页面数据读不出来：{reason}。", { reason: "没有读它的权限" }),
      hint: copy("确认文件在这个位置，也有权限读它，再运行一次。"),
    },
    /** 文件不存在：写明按哪两个位置找过。 */
    missingFile: {
      message: copy("页面数据读不出来：没有这个文件。"),
      hint: copy("先按当前目录、再按项目缓存找过，试过：{tried}。写对文件的路径。", {
        tried:
          "/work/app/rounds/v2-检查-1/page.json、/work/app/.product-loop/rounds/v2-检查-1/page.json",
      }),
    },
    notFound: {
      message: copy("没有找到页面数据：{path} 下没有 page.json。", {
        path: "rounds/v2-检查-1/",
      }),
      hint: copy(
        "把页面数据写进 {path}page.json，或在命令后面写文件的路径。第一次写，运行 ploop page example 看例子。",
        {
          path: "rounds/v2-检查-1/",
        },
      ),
    },
    /** 几个文件合并时，同一个字段写成了不是列表的值。 */
    mergeClash: {
      message: copy("{field} 在 {first} 和 {second} 里都写了，只有列表能合并。", {
        field: "purpose",
        first: "page.json",
        second: "cards/S3.json",
      }),
      hint: copy("只在一个文件里写这个字段。"),
    },
    noRound: {
      message: copy("这一版还没有开始任何阶段，不知道按哪个阶段。"),
      hint: copy("写 --stage，或先运行 ploop round start <阶段名>。"),
    },
    image: {
      message: copy("截图 {path} 找不到：{reason}。", {
        path: "img/before.png",
        reason: "文件不存在",
      }),
      hint: copy("截图的路径相对 {dir} 来写。", { dir: "rounds/v2-检查-1/" }),
    },
    textFile: {
      message: copy("文字来源 {path} 读不出来：{reason}。", {
        path: "skill/SKILL.md",
        reason: "文件不存在",
      }),
      hint: copy("文字来源的路径相对项目的根目录 {root} 来写。", { root: "/Users/me/proj/app" }),
    },
    textLines: {
      message: copy("文字来源 {path} 只有 {count} 行，写的是第 {lines} 行。", {
        path: "skill/SKILL.md",
        count: 12,
        lines: "12-20",
      }),
      hint: copy("按文件现在的内容改行号。"),
    },
    upload: {
      message: copy("截图 {path} 没有传上去：{reason}", {
        path: "img/before.png",
        reason: "后端返回 500。",
      }),
      hint: copy("运行 ploop backend logs 查看原因。"),
    },
    uploadStatus: copy("后端返回 {status}。", { status: 500 }),
    noWaiting: {
      message: copy("这个项目没有在等的页。"),
      hint: copy("运行 ploop status 查看。"),
    },
  },
};
