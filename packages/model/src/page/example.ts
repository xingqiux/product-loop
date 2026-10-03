import type { Stage } from "../names.ts";

// 每个阶段一份能通过页面数据定义的最小例子，ploop page example 打印它，AI 照着改。
// 例子里的队列编号、场景和步号、文字来源的文件要换成这个项目里真有的；用了图片的字段这里不写，
// 要图时按 ploop page schema --brief 里的说明加上。测试查每份例子都过得了定义，
// 也过得了 ploop page check 的三层校验，后一样在后端的 core/pages/check.test.ts。

const quote = { name: "用户昨天说的", saw: "「看队列要翻很久」", quote: true };

/** 要用户定的事：两个选项、我的看法。 */
const ask = {
  queue: ["Q1"],
  title: "看板放在哪里",
  why: "看板放在每一页的最后，还是单独一页。",
  sources: [quote],
  shared: { text: "两种放法都保留五列看板。" },
  rows: ["放在哪里"],
  options: [
    {
      key: "a",
      title: "每一页的最后",
      diffs: ["每一页左边列表的最下面。"],
      why: "每一页都能看到队列。",
      cost: "页面变长。",
      when: "每个阶段都想看队列。",
    },
    {
      key: "b",
      title: "单独一页",
      diffs: ["项目页上的一个入口。"],
      why: "每个阶段的页面更短。",
      cost: "看队列要多点一下。",
      when: "只在开始阶段看队列。",
    },
  ],
  stance: { pick: "a", because: "用户每一页都要看到队列。" },
};

/** 追问已经发生的事：只有备注框，没有选项。 */
const followUp = {
  title: "上次你自己做这件事是什么时候",
  why: "答案写进给谁用。",
  sources: [quote],
};

const finding = {
  queue: ["Q1"],
  title: "看板要翻两屏才看得到",
  why: "首页最下面才有看板。",
  sources: [quote],
  where: { scene: "S1", step: 2 },
  rows: ["看板放在哪里"],
  shared: { text: "看板的五列不变。" },
  options: [
    {
      key: "a",
      title: "放到首页第一屏",
      diffs: ["首页顶部。"],
      why: "打开就看得到。",
      cost: "首页上方的位置变少。",
      when: "用户一进首页就找看板。",
    },
    { key: "b", title: "不改", diffs: ["首页最下面。"] },
  ],
};

const screens = [
  {
    name: "首页：看板",
    where: { scene: "S1", step: 2 },
    elements: [
      { what: "看板标题", answers: "这一块是什么" },
      { what: "五列小卡", answers: "哪些事在做、哪些没做" },
    ],
  },
];

const improvement = {
  queue: ["Q1"],
  title: "看板加一个筛选",
  why: "事多的时候找不到当前阶段的事。",
  sources: [quote],
  where: { scene: "S1", step: 2 },
  only: true,
  rows: ["筛选"],
  options: [
    {
      key: "a",
      title: "按阶段筛选",
      diffs: ["看板上方一排阶段。"],
      why: "阶段是找事的第一个条件。",
      cost: "多一排按钮。",
    },
  ],
  dropped: [{ name: "按提出者筛选", because: "用户没有按提出者找过事。" }],
};

const change = {
  queue: ["Q1"],
  title: "看板放到首页第一屏",
  problem: "看板要翻两屏才看得到。",
  fix: "看板移到首页顶部。",
  textName: "首页的区块顺序",
  textBefore: "首页顺序是欢迎、队列、看板。",
  textAfter: "首页顺序是看板、欢迎、队列。",
};

const scene = {
  scene: "S1",
  name: "看队列",
  who: "你，想知道还有哪些事没做时",
  steps: [{ do: "在项目页点队列", expect: "五列看板" }],
};

const think = {
  scenes: [scene],
  asks: [ask],
};

/** 使用阶段拿出来的事要有卡处理，例子里的追问带上 Q1，和别的阶段一样能过 page check。 */
const useAsk = { ...followUp, queue: ["Q1"] };

const examples = {
  think,
  use: { asks: [useAsk] },
  check: { asks: [followUp], findings: [finding], screens },
  land: { asks: [followUp], changes: [change] },
  improve: { asks: [followUp], improvements: [improvement] },
} as const satisfies Record<Stage, Readonly<Record<string, unknown>>>;

/** 这个阶段的页面数据例子，取的是深拷贝，改了不影响别处。 */
export function pageExample(stage: Stage): Record<string, unknown> {
  return JSON.parse(JSON.stringify(examples[stage])) as Record<string, unknown>;
}
