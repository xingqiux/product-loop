import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { expectRun, started, type World } from "./lib.ts";

// 工作台一侧的场景共用的页面数据和摆状态的办法。

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (crcTable[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([length, body, sum]);
}

/** 一张纯色的 PNG。颜色不同，哈希就不同。 */
export function solidPng(
  width: number,
  height: number,
  rgb: readonly [number, number, number],
): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.from(Array.from({ length: width }, () => rgb).flat()),
  ]);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** 构思的一页：先对齐、场景清单、设计规范、两张疑问卡、参考。 */
const thinkPage = {
  align: [
    {
      id: "info-structure",
      name: "信息结构",
      usedIn: ["队列看板放在哪里"],
      meaning: "一页的内容分成哪几层，每一层管什么。",
      example: "每个阶段的页面分四层：页、区块、卡、格。",
    },
  ],
  scenes: [
    {
      id: "look-at-queue",
      scene: "S9",
      name: "看队列",
      who: "你，想知道还有哪些事没做时",
      mark: "改过",
      steps: [
        { do: "在项目页点队列", expect: "五列看板", img: "img/s9-1.png" },
        { do: "点一张小卡", expect: "展示卡片列出各项属性" },
      ],
    },
    { id: "export-queue", name: "导出队列", steps: [{ do: "点导出", expect: "下载一份表格" }] },
  ],
  spec: [
    {
      id: "palette",
      name: "配色",
      kind: "颜色",
      for: "整个工作台",
      values: [
        { name: "底", hex: "#ffffff" },
        { name: "强调", hex: "#0066db" },
      ],
    },
    {
      id: "type-scale",
      name: "字号",
      kind: "字号",
      for: "正文",
      values: [{ name: "正文", size: 14, sample: "每个阶段的页面" }],
    },
    { id: "radius", name: "圆角", kind: "圆角", for: "卡片", values: [4, 8] },
    { id: "spacing", name: "间距", kind: "间距", for: "卡片之间", values: [8, 16] },
    {
      id: "screen-motion",
      name: "换一屏的动效",
      kind: "动效",
      for: "每个阶段的页面",
      values: [{ name: "换一屏", ms: 220, easing: "ease-out", effect: "移动" }],
    },
  ],
  asks: [
    {
      id: "queue-board",
      queue: ["Q1"],
      title: "队列看板放在哪里",
      why: "看板放在每一页的最后，还是单独一页。",
      sources: [
        { name: "报告网页现在的样子", saw: "看板在每一页的最后。", img: "img/report-now.png" },
        { name: "用户昨天说的", saw: "「每一页都滚到底才看到队列」", quote: true },
      ],
      shared: { text: "两种放法都保留五列看板。" },
      rows: ["放在哪里"],
      options: [
        {
          key: "a",
          title: "每一页的最后",
          diffs: ["左边列表最下面一组。"],
          why: "每一页都能看到队列。",
          cost: "页面变长。",
          when: "用户每个阶段都想看队列。",
        },
        {
          key: "b",
          title: "单独一页",
          diffs: ["项目页上的一个入口。"],
          why: "每个阶段的页面更短。",
          cost: "看队列要多点一下。",
          when: "用户只在开始阶段时看队列。",
        },
      ],
      stance: { pick: "a", because: "用户每一页都要看到队列。" },
    },
    {
      id: "last-time",
      title: "上次你自己排当天的事是什么时候",
      why: "答案写进给谁用。",
      sources: [{ name: "用户说的", saw: "「很久没排了」", quote: true }],
    },
  ],
  refs: [
    {
      name: "《写给大家看的设计书》",
      kind: "书",
      depth: "已读原文",
      relevance: "高",
      strength: "中",
      advice: "采用",
      body: "版面的四条原则：对齐、对比、重复、亲密性。",
      where: "选项卡的版式",
    },
  ],
};

const workspace = (round: string) => `.product-loop/rounds/${round}`;

type ThinkPage = typeof thinkPage;

/**
 * 开工，拿出一件事，开始第 1 版的构思阶段，给出构思的一页。返回这一页在工作台里的路径。
 * edit 在给出以前改一下页面数据，例如再加一张卡。
 * note 写在第二件事（决定表要能切换全部）的备注里：这一页的队列区块是给出时的样子，要有备注就得先写。
 */
export function presentThink(
  w: World,
  edit?: (page: ThinkPage) => unknown,
  options: { readonly note?: string } = {},
): string {
  started(w);
  expectRun(w.ploop(["queue", "add", "队列看板放在哪里", "--stage", "构思"]), 0);
  const second = ["queue", "add", "决定表要能切换全部", "--stage", "提升"];
  expectRun(w.ploop(options.note === undefined ? second : [...second, "--note", options.note]), 0);
  expectRun(w.ploop(["round", "start", "构思"]), 0);
  const dir = workspace("v1-构思-1");
  w.write(`${dir}/page.json`, JSON.stringify(edit === undefined ? thinkPage : edit(thinkPage)));
  w.write(`${dir}/img/s9-1.png`, solidPng(240, 150, [0, 102, 219]));
  w.write(`${dir}/img/report-now.png`, solidPng(240, 150, [21, 128, 61]));
  expectRun(w.ploop(["page", "present"]), 0, "给出了：第 1 版的构思阶段的第 1 页");
  return `/p/${projectId(w)}/r/${encodeURIComponent("v1-构思-1")}`;
}

/** 项目的编号，由 ploop status 读出。 */
export function projectId(w: World): string {
  const cached = w.memo.get("pid");
  if (typeof cached === "string") return cached;
  const status = JSON.parse(w.ploop(["status", "--json"]).stdout) as {
    data: { project: { id: string } };
  };
  w.memo.set("pid", status.data.project.id);
  return status.data.project.id;
}

/** 只有一张疑问卡的一页：两个选项，回复时点一个。title 是卡的标题。 */
function askPage(title: string) {
  return {
    asks: [
      {
        id: "only-card",
        queue: ["Q1"],
        title,
        why: "两种放法各有各的用处，要定一种。",
        sources: [{ name: "用户说的", saw: "「每一页都滚到底才看到」", quote: true }],
        shared: { text: "两种放法都保留五列看板。" },
        rows: ["放在哪里"],
        options: [
          {
            key: "a",
            title: "放在页面最后",
            diffs: ["左边列表最下面一组。"],
            why: "每一页都能看到。",
            cost: "页面变长。",
            when: "每个阶段都要看。",
          },
          {
            key: "b",
            title: "单独一页",
            diffs: ["项目页上的一个入口。"],
            why: "每一页更短。",
            cost: "要多点一下。",
            when: "只在开始阶段时看。",
          },
        ],
      },
    ],
  };
}

/** dir 这个项目（相对 w.root 的路径，w.root 自己写 "."）的编号，由 ploop status 读出。 */
export function projectIdIn(w: World, dir: string): string {
  const status = JSON.parse(w.ploop(["status", "--json"], join(w.root, dir)).stdout) as {
    data: { project: { id: string } };
  };
  return status.data.project.id;
}

/**
 * 在 dir 这个项目（相对 w.root 的路径，w.root 自己写 "."）里放进一件构思的事，开始构思阶段，
 * 给出只有一张疑问卡的一页。项目要已经开工。返回这一页在工作台里的路径。
 */
export function presentAsk(w: World, dir: string, title: string): string {
  const cwd = join(w.root, dir);
  expectRun(w.ploop(["queue", "add", title, "--stage", "构思"], cwd), 0);
  expectRun(w.ploop(["round", "start", "构思"], cwd), 0);
  w.write(`${dir}/.product-loop/rounds/v1-构思-1/page.json`, JSON.stringify(askPage(title)));
  expectRun(w.ploop(["page", "present"], cwd), 0, "给出了：第 1 版的构思阶段的第 1 页");
  return `/p/${encodeURIComponent(projectIdIn(w, dir))}/r/${encodeURIComponent("v1-构思-1")}`;
}
