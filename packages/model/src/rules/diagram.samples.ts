import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 规则 diagram.edge.relation 的样本，见「07 校验」第六节。
// 样本是解析以后的页面数据，枚举写英文键，测试核对它们都能通过数据定义。
// 基础数据是一页构思的页面数据。先对齐的小卡上、疑问卡上和共同的部分里各有一张架构图，每条线都写了关系。
// 另有一张流程图，线上没写关系，流程图不查。会命中的样本各改一处。
// 前两份照搬旧 check-samples.py 的样本，名字也相同，对应导出的 legacy-082 和 legacy-097。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type AlignTerm = NonNullable<PageSections["align"]>[number];
type AskCard = NonNullable<PageSections["asks"]>[number];
type Diagram = NonNullable<AskCard["diagrams"]>[number];

/** 先对齐小卡上的架构图：关系写在线的中间。 */
const clients: Diagram = {
  kind: "architecture",
  title: "后端和两个客户端",
  code: [
    "flowchart LR",
    "  cli[命令行] -- 调用接口 --> backend[后端]",
    "  web[工作台] -- 调用接口 --> backend",
  ].join("\n"),
};

/** 疑问卡上的架构图：粗线的关系写在中间，另一条线的关系写在线的后面。 */
const storage: Diagram = {
  kind: "architecture",
  title: "谁读写集中存储",
  code: [
    "flowchart LR",
    "  backend[后端] == 独占读写 ==> store[(集中存储)]",
    "  cli[命令行] -->|自动拉起| backend",
  ].join("\n"),
};

/** 流程图的线不写关系。 */
const steps: Diagram = {
  kind: "flowchart",
  title: "命令找后端的步骤",
  code: "flowchart LR\n  a[读端口文件] --> b[连上后端] --> c[执行命令]",
};

/** 共同的部分里的架构图：一行有两条线，各写了关系。 */
const layers: Diagram = {
  kind: "architecture",
  title: "一次请求经过哪几层",
  code: "flowchart LR\n  http[接口层] -- 调用 --> core[内核] -- 写入 --> store[(集中存储)]",
};

const ask: AskCard = {
  title: "后端没开时命令行怎么办",
  why: "命令行找不到后端时，自动拉起还是报错退出。",
  sources: [{ name: "用户昨天说的", saw: "「后端没开，命令就报错了」", quote: true }],
  diagrams: [storage, steps],
  shared: { text: "两种做法都先读端口文件。", diagrams: [layers] },
  rows: ["后端没开时"],
  options: [
    {
      key: "a",
      title: "自动拉起",
      diffs: ["命令行拉起后端，再执行命令。"],
      why: "用户不用先开后端。",
      cost: "第一次执行要多等一两秒。",
      when: "你希望命令随时能用。",
    },
    {
      key: "b",
      title: "报错退出",
      diffs: ["命令行报错，提示先开后端。"],
      why: "后端什么时候运行由用户决定。",
      cost: "每次开机都要先开后端。",
      when: "你想自己管后端的进程。",
    },
  ],
  stance: { pick: "a", because: "用户不该记着先开后端。" },
};

const term: AlignTerm = {
  name: "后端",
  usedIn: [ask.title],
  meaning: "本机常驻的一个进程，独占集中存储，命令行和工作台都通过它读写。",
  example: "ploop status 连上后端，读出这个项目的阶段和队列。",
  diagram: clients,
};

const base: PageSections = { align: [term], asks: [ask] };

/** 疑问卡上换掉第一张图表，其余不变。 */
function withAskDiagram(diagram: Diagram): PageSections {
  return { ...base, asks: [{ ...ask, diagrams: [diagram, steps] }] };
}

export const diagramEdgeRelationSamples: Samples = {
  base: { subject: base, context: {} },
  hits: [
    {
      why: "架构图有一条线没有写明关系",
      subject: withAskDiagram({
        kind: "architecture",
        title: "文件的位置",
        code: "flowchart TB\n A[脚本]-->B[产品代码]",
      }),
      expect: [
        {
          where: ["asks", 0, "diagrams", 0, "code"],
          params: { title: "文件的位置", row: 2, order: 1, text: "A[脚本]-->B[产品代码]" },
        },
      ],
    },
    {
      why: "架构图同一行有两条线，第二条没有写明关系",
      subject: withAskDiagram({
        kind: "architecture",
        title: "文件的位置",
        code: "flowchart TB\n A-- 调用 -->B --> C",
      }),
      expect: [
        {
          where: ["asks", 0, "diagrams", 0, "code"],
          params: { title: "文件的位置", row: 2, order: 2, text: "A-- 调用 -->B --> C" },
        },
      ],
    },
    {
      why: "一张图里两行都没写关系，各报一处",
      subject: withAskDiagram({
        ...storage,
        code: "flowchart LR\n  backend[后端] ==> store[(集中存储)]\n  cli[命令行] --> backend",
      }),
      expect: [
        {
          where: ["asks", 0, "diagrams", 0, "code"],
          params: {
            title: "谁读写集中存储",
            row: 2,
            order: 1,
            text: "backend[后端] ==> store[(集中存储)]",
          },
        },
        {
          where: ["asks", 0, "diagrams", 0, "code"],
          params: { title: "谁读写集中存储", row: 3, order: 1, text: "cli[命令行] --> backend" },
        },
      ],
    },
    {
      why: "共同的部分里的架构图，一行的第二条线没写关系",
      subject: {
        ...base,
        asks: [
          {
            ...ask,
            shared: {
              text: "两种做法都先读端口文件。",
              diagrams: [
                {
                  ...layers,
                  code: "flowchart LR\n  http[接口层] -- 调用 --> core[内核] ==> store[(集中存储)]",
                },
              ],
            },
          },
        ],
      },
      expect: [
        {
          where: ["asks", 0, "shared", "diagrams", 0, "code"],
          params: {
            title: "一次请求经过哪几层",
            row: 2,
            order: 2,
            text: "http[接口层] -- 调用 --> core[内核] ==> store[(集中存储)]",
          },
        },
      ],
    },
    {
      why: "先对齐小卡上的架构图，虚线没写关系",
      subject: {
        ...base,
        align: [
          {
            ...term,
            diagram: {
              ...clients,
              code: "flowchart LR\n  cli[命令行] -- 调用接口 --> backend[后端]\n  web[工作台] -.-> backend",
            },
          },
        ],
      },
      expect: [
        {
          where: ["align", 0, "diagram", "code"],
          params: { title: "后端和两个客户端", row: 3, order: 1, text: "web[工作台] -.-> backend" },
        },
      ],
    },
  ],
};
