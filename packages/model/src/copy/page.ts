import type { FormatChangeKey } from "../page/legacy-format.ts";
import type { RestrictedSection } from "../page/stages.ts";
import { type CopyEntry, copy } from "./define.ts";
import type { ErrorCopy } from "./errors.ts";

// 页面数据报的问题，以及新旧格式的对照，见「07 校验」第二节。报的问题分四种：
// - 定义自己报的：编号和路径的写法、来源和更改的写法、选项和对照表的对应关系。
// - Zod 的通用问题按种类写成中文：缺字段、类型不对、取值不在范围里、不认识的字段，见 field。
// - 这一阶段不能写的区块，见 stage。
// - 写了旧格式的字段和取值，见 format。怎么改取对照表里这一条的说明。

/** 页面数据报的问题和导出定义时用的文字。每一组要么都是报错，要么都是单条的文字。 */
export const pageCopy = {
  cardId: {
    shape: {
      message: copy("卡片编号「{id}」的写法不对。", { id: "Spec_12" }),
      hint: copy("编号用小写英文字母、数字和短横，以字母开头，例如 spec-twelve。"),
    },
    duplicate: {
      message: copy("卡片编号「{id}」已经用在「{first}」上。", {
        id: "spec-twelve",
        first: "主线里缺的设计规范",
      }),
      hint: copy("一页里的卡片编号不能重复。改掉后面的编号，或者删掉它，由命令按标题生成。"),
    },
  },
  queueRef: {
    duplicate: {
      message: copy("队列事项 {id} 在 queue 里写了两次。", { id: "Q12" }),
      hint: copy("每个编号只写一次。"),
    },
  },
  path: {
    img: {
      message: copy("图片的路径「{path}」写法不对。", { path: "file:///Users/me/a.png" }),
      hint: copy(
        "写项目缓存里的相对路径，文件名以 png、jpg、jpeg、webp 或 gif 结尾，例如 img/before.png。",
      ),
    },
    file: {
      message: copy("文件的路径「{path}」写法不对。", { path: "/Users/me/主线.md" }),
      hint: copy("写相对项目根目录的路径，用正斜杠分隔，例如 skill/SKILL.md。"),
    },
  },
  lines: {
    shape: {
      message: copy("行号「{lines}」的写法不对。", { lines: "20-12" }),
      hint: copy("写成 12-20 这样，行号从 1 起，前一个不大于后一个。只摘一行时写 12。"),
    },
    markOutside: {
      message: copy("mark 里的第 {line} 行不在 lines「{lines}」的范围里。", {
        line: 25,
        lines: "12-20",
      }),
      hint: copy("mark 只写 lines 范围里要标出的行号。"),
    },
    markDuplicate: {
      message: copy("mark 里的第 {line} 行写了两次。", { line: 14 }),
      hint: copy("每个行号只写一次。"),
    },
  },
  source: {
    twoForms: {
      message: copy("来源「{name}」同时写了 {first} 和 {second}。", {
        name: "报告网页现在的样子",
        first: "img",
        second: "file",
      }),
      hint: copy(
        "一条来源只用一种写法：界面写 img，文字写 file 和 lines，用户的原话写 quote 和 saw。",
      ),
    },
    textIncomplete: {
      message: copy("来源「{name}」写了 {present}，没有写 {missing}。", {
        name: "正文第九节",
        present: "file",
        missing: "lines",
      }),
      hint: copy("文字的来源同时写 file 和 lines，要标出的行写进 mark，原文由命令摘录。"),
    },
    quoteWithoutSaw: {
      message: copy("来源「{name}」标了 quote，saw 里却没有原话。", { name: "用户昨天说的" }),
      hint: copy("在 saw 里照原样写出用户的话。"),
    },
    outsideNotImage: {
      message: copy("来源「{name}」标了 outside，却不是截图。", { name: "Linear 的队列页" }),
      hint: copy("outside 只用在截图上，表示图来自已有的产品或网上的设计。"),
    },
  },
  card: {
    rowsMissing: {
      message: copy("{section}「{title}」有选项，却没有写 rows。", {
        section: "疑问",
        title: "队列看板放在哪里",
      }),
      hint: copy("rows 写选项之间有差别的地方，每处起一个名称。"),
    },
    diffsCount: {
      message: copy("选项 {key} 的 diffs 有 {diffs} 格，rows 有 {rows} 行。", {
        key: "b",
        diffs: 1,
        rows: 2,
      }),
      hint: copy("diffs 和 rows 一一对应，每格写这个选项在对应一处的做法。"),
    },
    keyShape: {
      message: copy("选项的 key「{key}」写法不对。", { key: "A" }),
      hint: copy("key 写一个小写字母，依次写 a、b、c。"),
    },
    keyDuplicate: {
      message: copy("选项的 key「{key}」在同一张卡上用了两次。", { key: "a" }),
      hint: copy("每个选项用一个不同的小写字母，依次写 a、b、c。"),
    },
    mockCaptionAlone: {
      message: copy("{section}「{title}」写了 mockCaption，却没有 mock。", {
        section: "提升",
        title: "队列看板加一个筛选",
      }),
      hint: copy("mockCaption 是线稿下面的说明。没有线稿就删掉它。"),
    },
  },
  change: {
    noForm: {
      message: copy("更改「{title}」没有写改前改后。", { title: "选项多一格适用场景" }),
      hint: copy(
        "界面的更改写 after，有改前的图再写 before。文字的更改写 textBefore 和 textAfter。",
      ),
    },
    twoForms: {
      message: copy("更改「{title}」同时写了截图和文字的改前改后。", {
        title: "选项多一格适用场景",
      }),
      hint: copy("一条更改只用一种写法：截图写 before 和 after，文字写 textBefore 和 textAfter。"),
    },
    incomplete: {
      message: copy("更改「{title}」写了 {present}，没有写 {missing}。", {
        title: "选项多一格适用场景",
        present: "textBefore",
        missing: "textAfter",
      }),
      hint: copy("截图的更改一定要有 after。文字的更改同时写 textBefore 和 textAfter。"),
    },
  },
  spec: {
    rowCells: {
      message: copy("设计规范「{name}」的第 {row} 行有 {cells} 格，columns 有 {columns} 列。", {
        name: "状态标签",
        row: 2,
        cells: 3,
        columns: 4,
      }),
      hint: copy("每一行的格数和 columns 的列数相同，一行写一条规范。"),
    },
  },
  color: {
    hex: {
      message: copy("色值「{hex}」的写法不对。", { hex: "#12345" }),
      hint: copy("写成 # 加 3、4、6 或 8 位十六进制数，例如 #1f6feb。"),
    },
  },
  /**
   * Zod 的通用问题。field 是出问题的字段名，数组的下标照写，例如 rows[0][1]。
   * expected 和 received 是「文字」「数字」「数组」「对象」这类说法。
   */
  field: {
    root: {
      message: copy("页面数据应写成一个对象，写的是{received}。", { received: "数组" }),
      hint: copy("页面数据写成一个 JSON 对象，每个区块是其中的一个字段。"),
    },
    missing: {
      message: copy("缺少字段 {field}。", { field: "title" }),
      hint: copy("补上 {field}，值写成{expected}。", { field: "title", expected: "文字" }),
    },
    type: {
      message: copy("{field} 应写成{expected}，写的是{received}。", {
        field: "stance",
        expected: "对象",
        received: "文字",
      }),
      hint: copy("把 {field} 改成{expected}。", { field: "stance", expected: "对象" }),
    },
    empty: {
      message: copy("{field} 是空的。", { field: "why" }),
      hint: copy("写上内容。可以不写的字段，没有内容就删掉。"),
    },
    emptyArray: {
      message: copy("{field} 是空数组。", { field: "sources" }),
      hint: copy("至少写一项。可以不写的字段，没有内容就删掉。"),
    },
    tooSmall: {
      message: copy("{field} 写的是 {value}，应{bound}。", {
        field: "step",
        value: 0,
        bound: "大于 0",
      }),
      hint: copy("改成{bound} 的数。", { bound: "大于 0" }),
    },
    value: {
      message: copy("{field} 的取值「{value}」不在可选的范围里。", {
        field: "kind",
        value: "饼图",
      }),
      hint: copy("改成以下之一：{options}。", { options: "流程图、时序图、状态图" }),
    },
    trueOnly: {
      message: copy("{field} 写成了 {value}。", { field: "quote", value: "false" }),
      hint: copy("{field} 只写 true。不是 true 时，删掉这个字段。", { field: "quote" }),
    },
    union: {
      message: copy("{field} 不合任何一种写法。", { field: "toggles[0]" }),
      hint: copy("按其中一种写法改。各种写法见 ploop page schema 的输出。"),
    },
    unknown: {
      message: copy("字段 {field} 不在定义里。", { field: "summary" }),
      hint: copy("删掉 {field}。字段名可以对照 ploop page schema 的输出。", { field: "summary" }),
    },
    invalid: {
      message: copy("{field} 的写法不对。", { field: "values[0]" }),
      hint: copy("对照 ploop page schema 的输出改。"),
    },
  },
  /** 这一阶段不能写的区块。键是区块，哪个阶段能写见 page/stages.ts 的 stageSections。 */
  stage: {
    align: {
      message: copy("{stage}阶段的页面不能有先对齐（align）。", { stage: "检查" }),
      hint: copy("先对齐只在构思阶段写，删掉 align。"),
    },
    scenes: {
      message: copy("{stage}阶段的页面不能有场景清单（scenes）。", { stage: "检查" }),
      hint: copy("场景清单只在构思阶段写。别的阶段提到场景，在卡片的 where 里写场景编号。"),
    },
    spec: {
      message: copy("{stage}阶段的页面不能有设计规范（spec）。", { stage: "检查" }),
      hint: copy("设计规范只在构思阶段写，删掉 spec。"),
    },
    findings: {
      message: copy("{stage}阶段的页面不能有发现问题（findings）。", { stage: "落地" }),
      hint: copy("发现问题只在检查阶段写。别的阶段看到的问题，用 ploop queue add 放进队列。"),
    },
    improvements: {
      message: copy("{stage}阶段的页面不能有提升（improvements）。", { stage: "落地" }),
      hint: copy("提升只在提升阶段写。别的阶段想到的提升，用 ploop queue add 放进队列。"),
    },
    changes: {
      message: copy("{stage}阶段的页面不能有更改（changes）。", { stage: "构思" }),
      hint: copy(
        "更改只在落地阶段写，交给用户验收。别的阶段要做的改动，用 ploop queue add 放进队列。",
      ),
    },
    refs: {
      message: copy("{stage}阶段的页面不能有参考（refs）。", { stage: "提升" }),
      hint: copy("参考只在构思阶段写。别的阶段引用外面的产品，截图写进卡片的来源并标 outside。"),
    },
    screens: {
      message: copy("{stage}阶段的页面不能有元素清单（screens）。", { stage: "构思" }),
      hint: copy("元素清单只在检查阶段写，删掉 screens。"),
    },
  } satisfies Record<RestrictedSection, ErrorCopy>,
  /**
   * 写了旧格式的字段或取值时，什么不对。怎么改分两种：旧字段取对照表里这一条的说明，
   * 也就是 formatChangeCopy 的 note。换了写法的取值用 newValue。
   */
  format: {
    abolished: copy("{field} 是旧格式的字段，已废除。", { field: "queueRow" }),
    commandFilled: copy("{field} 由命令填，页面数据里不写。", { field: "round" }),
    renamed: copy("{field} 是旧格式的字段名，已改名。", { field: "src" }),
    abolishedValue: copy("{field} 的取值「{value}」已废除。", { field: "type", value: "excerpt" }),
    renamedValue: copy("{field} 的取值「{value}」是旧格式的写法。", {
      field: "type",
      value: "image",
    }),
    newValue: copy("改成「{now}」。", { now: "截图" }),
  },
  /** 报错里的几种说法，填进 field 各条的 expected、received 和 bound。 */
  phrase: {
    text: copy("文字"),
    number: copy("数字"),
    integer: copy("整数"),
    decimal: copy("小数"),
    array: copy("数组"),
    object: copy("对象"),
    oneOf: copy("以下之一：{options}", { options: "尺寸、色块、截图" }),
    above: copy("大于 {minimum}", { minimum: 0 }),
    atLeast: copy("不小于 {minimum}", { minimum: 1 }),
  },
  /** 按阶段导出的 JSON Schema 的标题和说明。 */
  schema: {
    title: copy("{stage}阶段的页面数据", { stage: "构思" }),
    description: copy("{stage}阶段的区块：{sections}。", {
      stage: "构思",
      sections: "先对齐、场景清单、设计规范、疑问、参考",
    }),
  },
} satisfies Record<string, Record<string, ErrorCopy> | Record<string, CopyEntry>>;

/** 新格式比旧格式改了什么：note 写改成什么，AI 写了旧的写法时用它提示；basis 写依据。 */
export type FormatChangeCopy = { readonly note: CopyEntry; readonly basis: CopyEntry };

/** 新旧格式对照的每一条，键和 page/legacy-format.ts 里的 key 一一对应。 */
export const formatChangeCopy = {
  cardId: {
    note: copy("卡片和更改，以及场景、规范、先对齐的每一项，都可以写 id。不写的由命令按标题生成。"),
    basis: copy("「07 校验」第二节"),
  },
  queueRow: {
    note: copy('queueRow 改成 queue，写队列事项的编号，例如 ["Q12"]。不再按内容的开头几个字匹配。'),
    basis: copy("「07 校验」第二节"),
  },
  queueRefs: {
    note: copy("场景、规范和先对齐的每一项也可以写 queue，引用这个阶段拿出来的事。"),
    basis: copy("第 20 步的约定：拿出来的事也可能落在这几种上"),
  },
  queueBoard: {
    note: copy("页面上的队列看板由命令从队列数据摆出，删掉这个字段。"),
    basis: copy("「07 校验」第二节"),
  },
  whereScene: {
    note: copy("where 的 scenario 改成 scene，写场景编号，例如 S3。"),
    basis: copy("「07 校验」第二节"),
  },
  whereText: {
    note: copy("场景名和这一步的文字由命令从主线填，删掉 title 和 stepText。"),
    basis: copy("「07 校验」第二节"),
  },
  whereTotals: {
    note: copy("场景的总数和步数由命令从主线算，删掉 scenarios 和 steps。"),
    basis: copy("第 20 步的约定：和 title、stepText 同样由主线得出"),
  },
  screenWhere: {
    note: copy("元素清单的每一屏写 where，scene 写场景编号，step 写步号。"),
    basis: copy("第一期约定第 8 条。必填由第 27 步的规则查，历史页面模式可以跳过"),
  },
  sourceImg: {
    note: copy("来源的 src 改名为 img，值是项目缓存里截图的相对路径。"),
    basis: copy("「07 校验」第二节"),
  },
  imgPath: {
    note: copy("图、证据、更改和场景步骤里的图片路径也写 img，src 不再使用。"),
    basis: copy("第一期计划第 28 步，第 20 步的约定：所有图片的路径用同一个名字"),
  },
  textSource: {
    note: copy("文字的来源不再截成图。写 file 和 lines，要标出的行写进 mark，原文由命令摘录。"),
    basis: copy("「07 校验」第二节"),
  },
  sourceOldForm: {
    note: copy(
      "来源的 label、kind 和 excerpt 不再使用。每条来源写 name 和 saw，再写 img、file 或 quote。",
    ),
    basis: copy("旧格式第五版"),
  },
  cardSaw: {
    note: copy("卡片上的 saw 改写进 sources，一条来源写一样东西。"),
    basis: copy("旧格式第五版"),
  },
  optionSee: {
    note: copy("选项的 see 改成卡上的 rows 和每个选项的 diffs，共同的部分写进 shared。"),
    basis: copy("「07 校验」第二节"),
  },
  hiddenFields: {
    note: copy("side、prior 和 impact 早已不显示，删掉。要说的话写进来源的 saw。"),
    basis: copy("旧格式第三版"),
  },
  excerptEvidence: {
    note: copy("excerpt 证据已删除。原文写成文字的来源，也就是 file 和 lines。"),
    basis: copy("旧格式第三版"),
  },
  rethink: {
    note: copy(
      "回到构思这一区块已删除。觉得主线的定义不对时，用 ploop queue add 放进队列，阶段写构思。",
    ),
    basis: copy("决定 140"),
  },
  header: {
    note: copy("页头和阶段条由命令从状态算出，删掉这个字段。"),
    basis: copy("「07 校验」第二节"),
  },
  roundFields: {
    note: copy("阶段名、次数和日期由命令按这个阶段填，删掉这个字段。"),
    basis: copy("「07 校验」第四节"),
  },
  usage: {
    note: copy("使用区块由命令从使用代码最近一次的运行生成，删掉这个字段。"),
    basis: copy("「07 校验」第二节"),
  },
  land: {
    note: copy("落地的记录由 ploop land 存进集中存储，工程证据由命令摆出，删掉这个字段。"),
    basis: copy("「07 校验」第二节"),
  },
  noLift: {
    note: copy("落地页不再要求提升卡，删掉 noLift。"),
    basis: copy("「07 校验」第四节，决定 137"),
  },
  sceneNumber: {
    note: copy("场景清单的每个场景写 scene，值是场景编号。新场景还没有编号时可以不写。"),
    basis: copy("「07 校验」第四节"),
  },
  stepExpect: {
    note: copy("场景每一步的 see 改名为 expect，写这一步该看到什么。"),
    basis: copy(
      "「10 工程规范与流程」第一节，每个中文术语只对应一个英文词。术语对照里该看到什么写 expect，和主线的解析相同",
    ),
  },
  specFor: {
    note: copy("设计规范的每一项都要写 for，说明用在哪个组件上。"),
    basis: copy("「07 校验」第四节。必填由第 27 步的规则查，历史页面模式可以跳过"),
  },
  evidenceArray: {
    note: copy("evidence 只写成数组，只有一项证据也放进数组。"),
    basis: copy("第 20 步的约定：只有一种写法，报错能指到具体的一项"),
  },
  emptyValues: {
    note: copy("可以不写的字段，不写就删掉，不写空字符串和空数组。"),
    basis: copy("第 20 步的约定：定义是严格的"),
  },
  trueFlags: {
    note: copy("quote、outside、only 和 design 只写 true，不是就删掉。"),
    basis: copy("第 20 步的约定：定义是严格的"),
  },
  hexColor: {
    note: copy("色值写 # 加 3、4、6 或 8 位十六进制数。"),
    basis: copy("第 20 步的约定"),
  },
  evidenceType: {
    note: copy("证据的 type 写中文：尺寸、色块、字号、间距、截图、真组件。"),
    basis: copy("「05 接口」第一节。中文的取值由第 21 步定"),
  },
  specKind: {
    note: copy("设计规范的 kind 写中文：颜色、字号、圆角、间距、动效、表格、文字。"),
    basis: copy("「05 接口」第一节。中文的取值由第 21 步定"),
  },
  motionEffect: {
    note: copy("动效的 effect 写中文：移动、淡入、放大。"),
    basis: copy("「05 接口」第一节。中文的取值由第 21 步定"),
  },
  columnStyle: {
    note: copy("表格一列的 as 写中文：加粗、色块、正例、反例、旧叫法。"),
    basis: copy("「05 接口」第一节。中文的取值由第 21 步定"),
  },
  cellTone: {
    note: copy("状态标签的 tone 写队列的状态：待办、进行中、等待、已完成、已取消。"),
    basis: copy("「05 接口」第一节。五种色调和队列的五种状态一一对应，由第 21 步定"),
  },
} satisfies Record<FormatChangeKey, FormatChangeCopy>;
