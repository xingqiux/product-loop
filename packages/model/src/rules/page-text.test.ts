import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AskCard } from "../page/card.ts";
import { type PageSections, pageSectionsSchema } from "../page/sections.ts";
import { pageTexts, runPageWriting } from "./page-text.ts";
import { type RunOptions, whereText } from "./run.ts";
import type { WritingContext } from "./writing.ts";

// 页面文字的写作校验：取哪些文字，线稿怎么查，原话和不显示的字段不查，以及历史页面模式。

const noSpec: WritingContext = { writingSpec: { banned: [], exceptions: [] } };

const quote = { name: "用户昨天说的", saw: "「这一版看不出改了什么」", quote: true } as const;

/** 超过六十个字、中间没有句号的一句。 */
const long = `${"线稿里写的一句很长的说明".repeat(6)}。`;

/** 每一种要查的字段各写一处，另写几处不查的字段。 */
const fullPage: PageSections = {
  align: [
    {
      name: "信息结构",
      usedIn: ["队列看板放在哪里"],
      meaning: "一页分成哪几层。",
      example: "报告网页分四层。",
      diagram: { kind: "tree", title: "报告网页的四层", code: "页\n└ 区块" },
    },
  ],
  scenes: [
    {
      scene: "S9",
      name: "看队列",
      who: "你，想知道还有哪些事没做时",
      mark: "改过",
      steps: [{ do: "点队列", expect: "五列看板", img: "img/s9-1.png" }],
    },
  ],
  spec: [{ name: "按钮的文案", kind: "text", for: "所有按钮", note: "照写", text: "按钮写动词。" }],
  asks: [
    {
      title: "队列看板放在哪里",
      tag: "队列",
      why: "放在每一页的最后，还是单独一页。",
      sources: [
        { name: "报告网页现在的样子", saw: "每一块下面有一句说明。", img: "img/report-now.png" },
        { name: "正文第九节", saw: "写法和决定表重复。", file: "skill/SKILL.md", lines: "120-134" },
        quote,
      ],
      options: [
        {
          key: "a",
          title: "每一页的最后",
          diffs: ["左边列表的最下面。"],
          why: "每一页都能看到。",
          cost: "页面变长。",
          when: "每一轮都要看队列。",
          sketch: '<div class="wf">每一页的最后</div>',
        },
      ],
      rows: ["放在哪里"],
      shared: {
        text: "都保留五列看板。",
        diagrams: [{ kind: "flowchart", title: "队列的写入路径", code: "flowchart LR\n A-->B" }],
      },
      only: true,
      dropped: [{ name: "放在首页", because: "首页没有队列。" }],
      stance: { pick: "a", because: "每一页都要看到队列。" },
      where: { scene: "S9", step: 1 },
      research: { tier: "none", reason: "看板是自己定的。" },
    },
  ],
  findings: [
    {
      title: "说明没有必要",
      why: "控件自己能说明怎么操作。",
      sources: [{ name: "疑问块", saw: "名字下面有一句说明。", img: "img/ask-block.png" }],
      where: { scene: "S3", step: 2 },
      evidence: [
        { type: "sizes", unit: "像素", values: [12, 16], caption: "图标的尺寸" },
        { type: "swatches", values: [{ name: "底色", hex: "#ffffff" }], caption: "用到的颜色" },
        { type: "type", values: [{ size: 13, sample: "队列看板" }], caption: "正文的字号" },
        { type: "spacing", values: [8], caption: "卡片的间距" },
        { type: "image", img: "img/ask-now.png", caption: "疑问这一块" },
        {
          type: "live",
          from: "工作台的保存按钮",
          html: "<button>保存</button>",
          css: "button { color: #333; }",
          toggles: [{ label: "按下", selector: "button", class: "on" }],
          caption: "真的按钮",
        },
      ],
      image: { img: "img/ask-block-now.png", caption: "现在的疑问块" },
    },
  ],
  improvements: [
    {
      title: "队列看板加一个筛选",
      why: "事多的时候找不到当前阶段的事。",
      sources: [
        { name: "Linear 的队列页", saw: "筛选在列表上方。", img: "img/linear.png", outside: true },
      ],
      where: { scene: "S9", step: 2 },
      mock: '<div class="mk-top"><span class="mk-tab on">待办</span></div>',
      mockCaption: "选 a 的样子",
      flow: ["点筛选", "点一张小卡"],
      diagrams: [{ kind: "flowchart", title: "筛选的两步", code: "flowchart LR\n A-->B" }],
    },
  ],
  changes: [
    {
      title: "选项多一格适用场景",
      problem: "看不出什么时候选它。",
      fix: "三格变四格。",
      before: { img: "img/when-before.png", caption: "改前的选项" },
      after: { img: "img/when-after.png", caption: "改后的选项" },
      more: [{ img: "img/when-gate.png", caption: "没写适用场景时拦截" }],
    },
    {
      title: "正文的写法改成四句",
      problem: "正文写的是三句。",
      fix: "正文写成四句。",
      textName: "正文第八节",
      textBefore: "每个选项写三句。",
      textAfter: "每个选项写四句。",
    },
  ],
  refs: [
    {
      name: "《写给大家看的设计书》",
      kind: "book",
      depth: "fullText",
      relevance: "high",
      strength: "medium",
      advice: "adopt",
      body: "版面的四条原则。",
      where: "选项卡的版式",
    },
  ],
  screens: [
    {
      name: "报告网页：疑问块",
      where: { scene: "S3", step: 1 },
      elements: [{ what: "块标题", answers: "这一块是什么" }],
    },
  ],
};

/** 报出的问题写成「编号 位置」。 */
function reported(page: PageSections, context = noSpec, options?: RunOptions) {
  const run = runPageWriting(page, context, options);
  const text = (issue: { readonly rule: string; readonly where?: string }) =>
    `${issue.rule} ${issue.where ?? ""}`;
  return { block: run.block.map(text), warn: run.warn.map(text) };
}

/** 一张疑问卡：why 以外的字段都写成不会报的样子。 */
function ask(fields: Partial<AskCard>): AskCard {
  return { title: "一条疑问", why: "待决定的事。", sources: [quote], ...fields };
}

describe("取出的文字", () => {
  it("样本页面能通过数据定义，写回去再读出来不变", () => {
    const written = z.encode(pageSectionsSchema, fullPage);
    expect(pageSectionsSchema.parse(written)).toEqual(fullPage);
  });

  it("按页面上的顺序，写明位置和查法。旧脚本不查的写 2.0.0", () => {
    const texts = pageTexts(fullPage).map(
      (piece) => `${whereText(piece.where)} ${piece.form}${piece.since ? ` ${piece.since}` : ""}`,
    );
    expect(texts).toEqual([
      "align[0].name prose",
      "align[0].meaning prose",
      "align[0].example prose",
      "align[0].diagram.title prose 2.0.0",
      "scenes[0].name prose",
      "scenes[0].who prose",
      "scenes[0].mark prose",
      "scenes[0].steps[0].do prose",
      "scenes[0].steps[0].expect prose",
      "asks[0].title prose",
      "asks[0].tag prose",
      "asks[0].why prose",
      "asks[0].sources[0].name prose",
      "asks[0].sources[0].saw prose",
      "asks[0].sources[1].name prose",
      "asks[0].sources[1].saw prose",
      "asks[0].options[0].title prose",
      "asks[0].options[0].diffs[0] prose",
      "asks[0].options[0].why prose",
      "asks[0].options[0].cost prose",
      "asks[0].options[0].when prose",
      "asks[0].options[0].sketch html 2.0.0",
      "asks[0].rows[0] prose",
      "asks[0].shared.text prose",
      "asks[0].shared.diagrams[0].title prose 2.0.0",
      "asks[0].dropped[0].name prose",
      "asks[0].dropped[0].because prose",
      "asks[0].stance.because prose",
      "findings[0].title prose",
      "findings[0].why prose",
      "findings[0].sources[0].name prose",
      "findings[0].sources[0].saw prose",
      "findings[0].evidence[0].unit prose",
      "findings[0].evidence[0].caption prose",
      "findings[0].evidence[1].values[0].name prose",
      "findings[0].evidence[1].caption prose",
      "findings[0].evidence[2].values[0].sample prose",
      "findings[0].evidence[2].caption prose",
      "findings[0].evidence[3].caption prose",
      "findings[0].evidence[4].caption prose",
      "findings[0].evidence[5].toggles[0].label prose",
      "findings[0].evidence[5].caption prose",
      "findings[0].image.caption prose",
      "improvements[0].title prose",
      "improvements[0].why prose",
      "improvements[0].sources[0].name prose",
      "improvements[0].sources[0].saw prose",
      "improvements[0].mock html 2.0.0",
      "improvements[0].mockCaption prose",
      "improvements[0].flow[0] prose",
      "improvements[0].flow[1] prose",
      "improvements[0].diagrams[0].title prose 2.0.0",
      "changes[0].title prose",
      "changes[0].problem prose",
      "changes[0].fix prose",
      "changes[0].before.caption prose",
      "changes[0].after.caption prose",
      "changes[0].more[0].caption prose",
      "changes[1].title prose",
      "changes[1].problem prose",
      "changes[1].fix prose",
      "changes[1].textName prose",
      "refs[0].name prose 2.0.0",
      "refs[0].body prose 2.0.0",
      "refs[0].where prose 2.0.0",
      "screens[0].name prose",
      "screens[0].elements[0].what prose",
      "screens[0].elements[0].answers prose",
    ]);
  });

  it("线稿取出的是标签之间的字", () => {
    const [mock] = pageTexts({ improvements: fullPage.improvements }).filter(
      (piece) => piece.form === "html",
    );
    expect(mock?.text.trim()).toBe("待办");
  });

  it("样本页面上查不出问题", () => {
    expect(reported(fullPage)).toEqual({ block: [], warn: [] });
  });
});

describe("不查的文字", () => {
  const said = "那一块收起来以后找不到了。";

  it("标了 quote 的来源整条不查，别的来源照常查", () => {
    const quoted = ask({ sources: [{ name: "用户昨天说的", saw: said, quote: true }] });
    expect(reported({ asks: [quoted] })).toEqual({ block: [], warn: [] });
    const seen = ask({ sources: [{ name: "用户昨天说的", saw: said, img: "img/a.png" }] });
    expect(reported({ asks: [seen] }).block).toEqual([
      "writing.term.banned asks[0].sources[0].saw",
      "writing.term.banned asks[0].sources[0].saw",
    ]);
  });

  it("设计规范、改前改后的原文、调研、图表的定义和真组件的代码都不查", () => {
    const page: PageSections = {
      spec: [
        { name: said, kind: "text", for: said, note: said, text: said },
        { name: said, kind: "table", for: said, columns: [{ name: said }], rows: [[said]] },
      ],
      asks: [
        ask({
          research: { tier: "none", reason: said },
          diagrams: [{ kind: "flowchart", title: "流程", code: `flowchart LR\n A[${said}]-->B` }],
        }),
      ],
      findings: [
        {
          ...ask({}),
          where: { scene: "S3", step: 2 },
          evidence: [
            {
              type: "live",
              from: said,
              html: `<p>${said}</p>`,
              css: `p::after { content: "${said}"; }`,
              toggles: [{ label: "按下", selector: said, attr: said, on: said, off: said }],
            },
          ],
        },
      ],
      changes: [
        { title: "改法", problem: "原因。", fix: "改好了。", textBefore: said, textAfter: said },
      ],
    };
    expect(reported(page)).toEqual({ block: [], warn: [] });
  });
});

describe("线稿只查停用的说法", () => {
  /** 一张疑问卡，第一个选项的草稿写成这段 HTML。 */
  function sketched(sketch: string): PageSections {
    return {
      asks: [
        ask({
          rows: ["放在哪里"],
          options: [{ key: "a", title: "放在顶栏", diffs: ["顶栏右边"], sketch }],
        }),
      ],
    };
  }

  it("停用的说法拦截，句子再长也不查", () => {
    expect(reported(sketched(`<div class="wf"><p>${long}</p><b>那一块</b></div>`))).toEqual({
      block: ["writing.term.banned asks[0].options[0].sketch"],
      warn: [],
    });
    expect(reported({ asks: [ask({ why: long })] }).block).toEqual([
      "writing.sentence.tooLong asks[0].why",
    ]);
  });

  it("只写在引号里的停用说法只警告", () => {
    expect(reported(sketched("<span>「那一块」</span>"))).toEqual({
      block: [],
      warn: ["writing.term.quoted asks[0].options[0].sketch"],
    });
  });

  it("属性、注释、脚本和样式里的字不算，草稿图的 img 标签没有字", () => {
    const html = [
      '<div title="那一块" data-note="收起来">',
      "<!-- 那一屏 -->",
      '<script>const note = "齐不齐";</script>',
      '<style>.wf::after { content: "那一格"; }</style>',
      '<img src="img/entry.png" alt="那一块">',
      "</div>",
    ].join("");
    expect(reported(sketched(html))).toEqual({ block: [], warn: [] });
  });

  it("字符引用换成字再查，认不出的照原样留着", () => {
    expect(reported(sketched("<p>&#x90A3;&#19968;&#22359;</p>")).block).toEqual([
      "writing.term.banned asks[0].options[0].sketch",
    ]);
    expect(reported(sketched("<p>&lt;收起来&gt; &amp; &#xD800; &bogus;</p>")).block).toEqual([
      "writing.term.banned asks[0].options[0].sketch",
    ]);
  });

  it("两个积木里的字各自成段，不会连成一个说法", () => {
    expect(
      reported(sketched('<div class="wf-row">那一</div><div class="wf-row">块</div>')),
    ).toEqual({ block: [], warn: [] });
  });

  it("中保真线稿也一样", () => {
    const card = {
      ...ask({ mock: "<div class='mk-top'>那一块</div>" }),
      where: { scene: "S9", step: 2 },
    };
    expect(reported({ improvements: [card] }).block).toEqual([
      "writing.term.banned improvements[0].mock",
    ]);
  });
});

describe("项目的写作规范", () => {
  it("主线加的停用说法和例外都生效", () => {
    const page: PageSections = {
      scenes: [{ name: "看板上写着约翰·史密斯", steps: [{ do: "点", expect: "看" }] }],
    };
    expect(reported(page)).toEqual({
      block: [],
      warn: ["writing.wording.interpunct scenes[0].name"],
    });
    const spec: WritingContext = {
      writingSpec: {
        banned: [{ phrase: "看板", replacement: "队列" }],
        exceptions: ["约翰·史密斯"],
      },
    };
    expect(reported(page, spec)).toEqual({
      block: ["writing.term.banned scenes[0].name"],
      warn: [],
    });
  });
});

describe("历史页面模式", () => {
  const page: PageSections = {
    asks: [
      ask({
        why: long,
        rows: ["放在哪里"],
        shared: {
          text: "我站 a。",
          diagrams: [{ kind: "flowchart", title: "那一块的流程", code: "flowchart LR\n A-->B" }],
        },
        options: [
          { key: "a", title: "做法 a", diffs: ["改完看到什么。"], sketch: "<p>那一块</p>" },
          { key: "b", title: "做法 b", diffs: ["改完看到什么。"] },
        ],
      }),
    ],
    refs: [
      {
        name: "《写给大家看的设计书》",
        kind: "book",
        depth: "fullText",
        relevance: "high",
        strength: "medium",
        advice: "adopt",
        body: "那一块的写法。",
      },
    ],
  };
  const history = (pageDate: string): RunOptions => ({ mode: "history", pageDate });

  it("平时每一段都查", () => {
    expect(reported(page)).toEqual({
      block: [
        "writing.sentence.tooLong asks[0].why",
        "writing.term.banned asks[0].options[0].sketch",
        "writing.term.banned asks[0].shared.diagrams[0].title",
        "writing.term.banned refs[0].body",
      ],
      warn: ["writing.wording.spoken asks[0].shared.text"],
    });
  });

  it("2026-09-21 的页面照旧查写作五项，旧脚本不查的文字跳过", () => {
    expect(reported(page, noSpec, history("2026-09-22"))).toEqual({
      block: ["writing.sentence.tooLong asks[0].why"],
      warn: ["writing.wording.spoken asks[0].shared.text"],
    });
    expect(runPageWriting(page, noSpec, history("2026-09-22")).skipped).toEqual([
      "writing.term.quoted",
    ]);
  });

  it("2026-09-20 的页面只有措辞提醒", () => {
    expect(reported(page, noSpec, history("2026-09-21"))).toEqual({
      block: [],
      warn: ["writing.wording.spoken asks[0].shared.text"],
    });
    expect(runPageWriting(page, noSpec, history("2026-09-21")).skipped).toEqual([
      "writing.term.banned",
      "writing.term.quoted",
      "writing.term.soft",
      "writing.sentence.tooLong",
      "writing.sentence.long",
      "writing.sentence.semicolons",
      "writing.paren.list",
      "writing.paren.items",
      "writing.demonstrative.dense",
    ]);
  });
});
