import type { PageSections } from "../page/sections.ts";
import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 先对齐两条规则的样本，见「07 校验」第六节。
// 样本是解析以后的页面数据，测试核对它们都能通过数据定义。
// 基础数据是一页构思的页面数据：两个术语，两张疑问卡，usedIn 都写本页疑问卡的标题。会命中的样本各改一处。
// 每条规则的第一份照搬旧 check-samples.py 的样本，名字也相同，对应导出的 legacy-086 和 legacy-087。

type Samples = RuleSamples<PageSections, RuleContextOf<never>>;
type AlignTerm = NonNullable<PageSections["align"]>[number];
type AskCard = NonNullable<PageSections["asks"]>[number];

const launch: AskCard = {
  title: "后端没开时命令行怎么办",
  why: "命令行找不到后端时，自动拉起还是报错退出。",
  sources: [{ name: "用户昨天说的", saw: "「后端没开，命令就报错了」", quote: true }],
};

const busyPort: AskCard = {
  title: "端口被占用时报什么",
  why: "占着端口的不是后端时，报错里写不写占用者。",
  sources: [{ name: "第 9 步的验收", saw: "被别的程序占用时报错并写明占用者。", quote: true }],
};

const backend: AlignTerm = {
  name: "后端",
  usedIn: [launch.title, busyPort.title],
  meaning: "本机常驻的一个进程，独占集中存储，命令行和工作台都通过它读写。",
  example: "ploop status 连上后端，读出这个项目的阶段和队列。",
};

const portFile: AlignTerm = {
  name: "端口文件",
  usedIn: [launch.title],
  meaning: "后端启动后写下的一个文件，记着它用的端口。",
  example: "命令行读 run/backend.json，找到后端的端口。",
};

const base: PageSections = { align: [backend, portFile], asks: [launch, busyPort] };

export const alignUsedInMatchedSamples: Samples = {
  base: { subject: base, context: {} },
  hits: [
    {
      why: "先对齐的小卡写的「用在」对不上本页任何一张疑问卡",
      subject: { ...base, align: [backend, { ...portFile, usedIn: ["不存在的一张卡"] }] },
      expect: [
        {
          where: ["align", 1, "usedIn", 0],
          params: { name: "端口文件", title: "不存在的一张卡" },
        },
      ],
    },
    {
      why: "第二项和疑问卡的标题差一个字",
      subject: {
        ...base,
        align: [{ ...backend, usedIn: [launch.title, "端口被占用时报什么错"] }, portFile],
      },
      expect: [
        {
          where: ["align", 0, "usedIn", 1],
          params: { name: "后端", title: "端口被占用时报什么错" },
        },
      ],
    },
    {
      why: "标题后面多了一个空格，标题一字不差地比",
      subject: {
        ...base,
        align: [backend, { ...portFile, usedIn: ["后端没开时命令行怎么办 "] }],
      },
      expect: [
        {
          where: ["align", 1, "usedIn", 0],
          params: { name: "端口文件", title: "后端没开时命令行怎么办 " },
        },
      ],
    },
    {
      why: "本页没有疑问卡，每一项都对不上",
      subject: { align: [backend, portFile] },
      expect: [
        { where: ["align", 0, "usedIn", 0], params: { name: "后端", title: launch.title } },
        { where: ["align", 0, "usedIn", 1], params: { name: "后端", title: busyPort.title } },
        { where: ["align", 1, "usedIn", 0], params: { name: "端口文件", title: launch.title } },
      ],
    },
  ],
};

export const alignNameUniqueSamples: Samples = {
  base: { subject: base, context: {} },
  hits: [
    {
      why: "先对齐的小卡名称重复",
      subject: { ...base, align: [backend, { ...portFile, name: "后端" }] },
      expect: [{ where: ["align", 1, "name"], params: { name: "后端" } }],
    },
    {
      why: "名称只差两头的空白，也算重复",
      subject: { ...base, align: [backend, { ...portFile, name: " 后端 " }] },
      expect: [{ where: ["align", 1, "name"], params: { name: "后端" } }],
    },
    {
      why: "三项同名，后两项各报一处",
      subject: {
        ...base,
        align: [backend, { ...portFile, name: "后端" }, { ...portFile, name: "后端" }],
      },
      expect: [
        { where: ["align", 1, "name"], params: { name: "后端" } },
        { where: ["align", 2, "name"], params: { name: "后端" } },
      ],
    },
  ],
};
