import { replySection } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import {
  cardTitlesOf,
  groupsOf,
  initialScreen,
  isCurrentEntry,
  type LandShape,
  lineFields,
  missingReasons,
  type PageShape,
  pageStateOf,
  pendingOf,
  pickLabel,
  queueContentsOf,
  queueTitles,
  replyLines,
  screensOf,
  stripColumns,
} from "./model.ts";

// 一个阶段的页面：屏的顺序、左边一栏、还剩几条、打开先到哪一屏、提交的各行。

const page: PageShape = {
  sections: {
    scenes: [{ id: "scene-a", name: "看队列" }],
    asks: [
      {
        id: "ask-1",
        title: "看板放哪",
        options: [
          { key: "a", title: "首页" },
          { key: "b", title: "项目页" },
        ],
      },
      { id: "ask-2", title: "追问一句" },
      { id: "ask-3", title: "只有一个方向", options: [{ key: "a", title: "就这样" }], only: true },
    ],
    changes: [{ id: "change-1", title: "按钮改名" }],
  },
  fill: {
    header: { legacyId: null },
    previousReplies: null,
    droppedAtStart: [{}],
    use: null,
    landEvidence: null,
    queue: { waiting: [], columns: [{ items: [{}] }] },
  },
};

describe("屏和左边一栏", () => {
  it("按区块的顺序排，没有数据的区块不出现，队列总在最后", () => {
    expect(screensOf(page).map((screen) => screen.id)).toEqual([
      "dropped",
      "scenes",
      "ask-1",
      "ask-2",
      "ask-3",
      "change-1",
      "queue",
    ]);
    expect(groupsOf(page).map((group) => group.label)).toEqual([
      "取消的事",
      "场景清单",
      "疑问",
      "更改",
      "队列",
    ]);
  });

  it("迁移进来的历史页没有当时的队列，不出队列这一屏", () => {
    const legacy: PageShape = { ...page, fill: { ...page.fill, header: { legacyId: "fix-10" } } };
    expect(screensOf(legacy).map((screen) => screen.id)).not.toContain("queue");
    expect(groupsOf(legacy).map((group) => group.key)).not.toContain("queue");
    // 工作台自己给出的页，队列是给出时存下的，总在最后。
    expect(screensOf(page).at(-1)?.id).toBe("queue");
  });

  it("工程证据什么都没记时整屏不出现，记了一样就出现", () => {
    const empty: LandShape = {
      tidy: { state: "还没记" },
      changes: [],
      review: { opinions: null, reason: null },
      plan: null,
    };
    const withLand = (land: LandShape): PageShape => ({
      ...page,
      fill: { ...page.fill, landEvidence: land },
    });
    expect(screensOf(withLand(empty)).map((screen) => screen.id)).not.toContain("land");
    expect(groupsOf(withLand(empty)).map((group) => group.key)).not.toContain("land");
    for (const recorded of [
      { ...empty, tidy: { state: "跳过了" } },
      { ...empty, changes: [{}] },
      { ...empty, review: { opinions: null, reason: "只改了一行" } },
      { ...empty, plan: { verdicts: [["不重构", "改动小", "小"]] } },
    ]) {
      expect(screensOf(withLand(recorded)).map((screen) => screen.id)).toContain("land");
    }
  });

  it("只有一个区块的分组，那一行就是块的名字，名字下面不加说明", () => {
    const single = groupsOf(page).filter((group) => group.entries.length === 1);
    for (const group of single.filter((g) => ["dropped", "queue"].includes(g.key))) {
      expect(group.entries[0]?.label).toBe(group.label);
    }
  });

  it("要点的是有选项的卡、场景和更改；只有备注框的卡不算", () => {
    const pending = pendingOf(groupsOf(page), {});
    expect(pending.map((entry) => entry.item ?? entry.screen)).toEqual([
      "scene-a",
      "ask-1",
      "ask-3",
      "change-1",
    ]);
    const after = pendingOf(groupsOf(page), {
      "asks/ask-1": { pick: "b" },
      "scenes/scene-a": { pick: "保留" },
    });
    expect(after.map((entry) => entry.screen)).toEqual(["ask-3", "change-1"]);
    // 以前自动写进草稿的「看过了」不算认可。
    const seen = pendingOf(groupsOf(page), { "changes/change-1": { seen: true } });
    expect(seen.map((entry) => entry.screen)).toContain("change-1");
  });

  it("只看的页没有要点的条：左边不出圆点，也不算还剩几条", () => {
    const view = groupsOf(page, false);
    expect(view.flatMap((group) => group.entries).every((entry) => !entry.needsPick)).toBe(true);
    expect(pendingOf(view, {})).toEqual([]);
    // 屏和分组不变，只是没有要点的。
    expect(view.map((group) => group.key)).toEqual(groupsOf(page).map((group) => group.key));
  });
});

describe("左边一栏哪一行是当前的", () => {
  const groups = groupsOf(page);
  const current = (at: { screen: string; item?: string }) =>
    groups
      .flatMap((group) => group.entries)
      .filter((entry) => isCurrentEntry(groups, at, entry))
      .map((entry) => entry.item ?? entry.screen);

  it("一屏只有一条：就是那一条", () => {
    expect(current({ screen: "ask-1" })).toEqual(["ask-1"]);
  });

  it("一屏有多条，换屏时地址里没有写哪一项：当前的是这一屏的第一条", () => {
    expect(current({ screen: "scenes" })).toEqual(["scene-a"]);
  });

  it("点的是屏里的某一项：就是那一项", () => {
    const two: PageShape = {
      ...page,
      sections: {
        scenes: [
          { id: "s1", name: "甲" },
          { id: "s2", name: "乙" },
        ],
      },
    };
    const list = groupsOf(two);
    const entries = list.flatMap((group) => group.entries);
    const at = { screen: "scenes", item: "s2" };
    expect(entries.filter((entry) => isCurrentEntry(list, at, entry)).map((e) => e.item)).toEqual([
      "s2",
    ]);
    const first = { screen: "scenes" };
    expect(
      entries.filter((entry) => isCurrentEntry(list, first, entry)).map((e) => e.item),
    ).toEqual(["s1"]);
  });
});

describe("打开先到哪一屏", () => {
  const screens = screensOf(page);
  const groups = groupsOf(page);

  it("第一条没点的；是场景的一项时带着这一项", () => {
    expect(initialScreen(screens, groups, {}, undefined)).toEqual({
      screen: "scenes",
      item: "scene-a",
    });
  });

  it("地址里写了的优先", () => {
    expect(initialScreen(screens, groups, {}, "change-1")).toEqual({ screen: "change-1" });
    expect(initialScreen(screens, groups, {}, "scene-a")).toEqual({
      screen: "scenes",
      item: "scene-a",
    });
  });

  it("都点完了到第一屏", () => {
    const entries = {
      "scenes/scene-a": { pick: "保留" },
      "asks/ask-1": { pick: "a" },
      "asks/ask-3": { pick: "a" },
      "changes/change-1": { pick: "认可" },
    };
    expect(initialScreen(screens, groups, entries, undefined)).toEqual({ screen: "dropped" });
  });
});

describe("提交的各行", () => {
  it("按页面的顺序，枚举写中文；只有一个方向的卡点了是同意", () => {
    const lines = replyLines(page.sections, {
      ideas: { note: "  整体可以 " },
      "asks/ask-3": { pick: "a" },
      "asks/ask-1": { pick: "b", note: "放项目页", images: ["ab".repeat(32)] },
      "asks/ask-2": { note: "再说说" },
      "scenes/scene-a": { pick: "修改", note: "第二步改成打开看板" },
      "changes/change-1": { pick: "认可" },
      "queue/Q12": { pick: "取消" },
      droppedAtStart: { note: "Q3 不该取消" },
    });
    expect(lines).toEqual([
      { section: "场景清单", card: "scene-a", kind: "修改", note: "第二步改成打开看板" },
      {
        section: "疑问",
        card: "ask-1",
        kind: "选了选项",
        option: "b",
        note: "放项目页",
        images: ["ab".repeat(32)],
      },
      { section: "疑问", card: "ask-2", kind: "只写了备注", note: "再说说" },
      { section: "疑问", card: "ask-3", kind: "同意" },
      { section: "更改", card: "change-1", kind: "认可一条更改" },
      { section: "队列看板", kind: "取消队列事项", queue: "Q12" },
      {
        section: replySection.label("droppedAtStart"),
        kind: "只写了备注",
        note: "Q3 不该取消",
      },
      { kind: "想法", note: "整体可以" },
    ]);
  });

  it("只认可的更改也出行，全部认可就能提交；认可不带备注", () => {
    const only = {
      changes: [
        { id: "c1", title: "选项多一格" },
        { id: "c2", title: "按钮改名" },
      ],
    };
    const lines = replyLines(only, {
      "changes/c1": { pick: "认可" },
      "changes/c2": { pick: "认可", note: "先前不认可时写的话" },
    });
    expect(lines).toEqual([
      { section: "更改", card: "c1", kind: "认可一条更改" },
      { section: "更改", card: "c2", kind: "认可一条更改" },
    ]);
  });

  it("没点的更改不出行，也不算认可", () => {
    expect(replyLines(page.sections, {})).toEqual([]);
    expect(replyLines(page.sections, { "changes/change-1": { seen: true } })).toEqual([]);
  });

  it("否决和不认可一条更改", () => {
    const lines = replyLines(page.sections, {
      "asks/ask-3": { pick: "否决", note: "方向不对" },
      "changes/change-1": { pick: "不认可", note: "名字太长" },
    });
    expect(lines.map((line) => line.kind)).toEqual(["否决", "不认可一条更改"]);
  });

  it("空的备注不出行", () => {
    expect(
      replyLines(page.sections, { "asks/ask-2": { note: "  " }, ideas: { note: "" } }),
    ).toEqual([]);
  });
});

describe("missingReasons", () => {
  const sections = { changes: [{ id: "c1", title: "选项多一格" }] };

  it("取消队列里的一件、不认可一条更改，没写原因的都列出来", () => {
    const entries = {
      "changes/c1": { pick: "不认可", seen: true as const },
      "queue/Q3": { pick: "取消" },
    };
    // 没有内容可写时写「这一项」，不把编号摆给用户。
    expect(missingReasons(sections, entries)).toEqual([
      "不认可「选项多一格」要写原因",
      "取消「这一项」要写原因",
    ]);
  });

  it("修改场景或设计规范，没写内容的列出来，顺序在更改和队列前面", () => {
    const withScenes = {
      scenes: [
        { id: "s1", name: "看队列" },
        { id: "s2", name: "导出队列" },
      ],
      spec: [{ id: "p1", name: "配色" }],
      changes: [{ id: "c1", title: "选项多一格" }],
    };
    const entries = {
      "scenes/s1": { pick: "保留" },
      "scenes/s2": { pick: "修改", note: "  " },
      "spec/p1": { pick: "修改" },
      "changes/c1": { pick: "不认可" },
    };
    expect(missingReasons(withScenes, entries)).toEqual([
      "修改「导出队列」要写内容",
      "修改「配色」要写内容",
      "不认可「选项多一格」要写原因",
    ]);
    // 写了内容，或者选的是保留和删除，都不列。
    expect(
      missingReasons(withScenes, {
        "scenes/s1": { pick: "删除" },
        "scenes/s2": { pick: "修改", note: "第 1 步改成点导出" },
        "spec/p1": { pick: "保留" },
      }),
    ).toEqual([]);
  });

  it("取消的事写内容，不写编号", () => {
    const contents = new Map([["Q3", "导出按钮换位置"]]);
    expect(missingReasons(sections, { "queue/Q3": { pick: "取消" } }, contents)).toEqual([
      "取消「导出按钮换位置」要写原因",
    ]);
  });

  it("写了原因的不列", () => {
    const entries = {
      "changes/c1": { pick: "不认可", note: "图还是旧的" },
      "queue/Q3": { pick: "取消", note: "和 Q1 重复" },
    };
    expect(missingReasons(sections, entries)).toEqual([]);
  });
});

describe("pickLabel", () => {
  const entries = groupsOf(page).flatMap((group) => group.entries);
  const ask = entries.find((entry) => entry.field === "asks/ask-1");
  const scene = entries.find((entry) => entry.field === "scenes/scene-a");

  it("选项写选了哪个，别的照写，没点的为空", () => {
    const draft = { "asks/ask-1": { pick: "b" }, "scenes/scene-a": { pick: "保留" } };
    expect(ask && pickLabel(ask, draft)).toBe("选了「项目页」");
    expect(scene && pickLabel(scene, draft)).toBe("保留");
    expect(ask && pickLabel(ask, {})).toBeUndefined();
  });
});

describe("pageStateOf", () => {
  const given = { status: "已给出", purpose: "要用户点", submission: null };

  it("已给出、所在的阶段没收尾，才能点选和提交", () => {
    expect(pageStateOf(given, "等用户回复")).toBe("open");
    expect(pageStateOf(given, "进行中")).toBe("open");
  });

  it("已提交：没被取走是等 AI 取走，取走了是 AI 已收到", () => {
    const at = "2026-09-29T10:00:00.000Z";
    const sent = { status: "已回复", purpose: "要用户点", submission: { takenAt: null } };
    expect(pageStateOf(sent, "已回复")).toBe("waiting");
    expect(pageStateOf({ ...sent, submission: { takenAt: at } }, "已收尾")).toBe("received");
  });

  it("迁移进来的历史页：状态是已回复，没有提交的记录，只能看", () => {
    expect(pageStateOf({ ...given, status: "已回复" }, "已收尾")).toBe("replied");
    expect(pageStateOf({ ...given, status: "已回复" }, "进行中")).toBe("replied");
  });

  it("没回复过的页，所在的阶段已收尾，只能看", () => {
    expect(pageStateOf(given, "已收尾")).toBe("closed");
  });

  it("已撤回排在最前，不管阶段收没收尾", () => {
    expect(pageStateOf({ ...given, status: "已撤回" }, "已收尾")).toBe("withdrawn");
    expect(pageStateOf({ ...given, status: "已撤回" }, "等用户回复")).toBe("withdrawn");
  });

  it("只看的页不等回复：阶段没收尾时是 view，没有想法框和提交", () => {
    const view = { ...given, purpose: "只看" };
    expect(pageStateOf(view, "进行中")).toBe("view");
  });

  it("只看的页所在的阶段收尾了：和别的页一样写阶段已收尾", () => {
    expect(pageStateOf({ ...given, purpose: "只看" }, "已收尾")).toBe("closed");
  });

  it("只看的页撤回了，还是写已撤回", () => {
    expect(pageStateOf({ ...given, purpose: "只看", status: "已撤回" }, "进行中")).toBe(
      "withdrawn",
    );
  });
});

describe("stripColumns", () => {
  /** 给出这一页那一刻存下的阶段条：落地第 1 次还在等用户回复。 */
  const saved = [
    { stage: "构思", rounds: [{ label: "v2-构思-1", status: "已收尾" }], queue: 2 },
    { stage: "使用", rounds: [], queue: 0 },
    { stage: "检查", rounds: [], queue: 0 },
    { stage: "落地", rounds: [{ label: "v2-落地-1", status: "等用户回复" }], queue: 1 },
    { stage: "提升", rounds: [], queue: 0 },
  ] as const;
  const now = {
    versions: [
      { version: 1, rounds: [{ label: "v1-落地-1", stage: "落地", status: "已收尾" }] },
      {
        version: 2,
        rounds: [
          { label: "v2-构思-1", stage: "构思", status: "已收尾" },
          { label: "v2-落地-1", stage: "落地", status: "已收尾" },
          { label: "v2-落地-2", stage: "落地", status: "进行中" },
        ],
      },
    ],
    queue: [
      { stage: "构思", count: 0 },
      { stage: "落地", count: 3 },
    ],
  };

  it("这个阶段后来收尾了，阶段条写已收尾，不再写存下的等用户回复", () => {
    const columns = stripColumns(saved, now, 2);
    expect(columns[3]?.rounds).toEqual([
      { label: "v2-落地-1", status: "已收尾" },
      { label: "v2-落地-2", status: "进行中" },
    ]);
    // 别的版的次数不混进来。
    expect(columns.flatMap((column) => column.rounds.map((round) => round.label))).not.toContain(
      "v1-落地-1",
    );
  });

  it("队列的件数按现在的算，现在没有的阶段是 0", () => {
    expect(stripColumns(saved, now, 2).map((column) => column.queue)).toEqual([0, 0, 0, 3, 0]);
  });

  it("读不到现在的数据时，用给出这一页时存下的", () => {
    expect(stripColumns(saved, { versions: undefined, queue: undefined }, 2)).toEqual(saved);
  });
});

describe("队列事项和卡的名字", () => {
  it("队列事项按编号找内容，找不到的不写编号", () => {
    const contents = queueContentsOf({
      waiting: [{ id: "Q1", content: "等构思定场景" }],
      columns: [{ items: [{ id: "Q2", content: "看板放首页" }] }],
      doneThisRound: [{ id: "Q3", content: "改文案" }],
    });
    expect(queueTitles(["Q1", "Q2", "Q3"], contents)).toBe("等构思定场景、看板放首页、改文案");
    // 编号不是用户的词：找不到内容的不写，一件都找不到时是空的。
    expect(queueTitles(["Q9"], contents)).toBe("");
    expect(queueTitles(["Q1", "Q9"], contents)).toBe("等构思定场景");
  });

  it("回复的一行只记卡的编号和选项的字母，显示时换成标题", () => {
    const titles = cardTitlesOf(page.sections);
    expect(titles.get("ask-1")).toEqual({
      title: "看板放哪",
      options: { a: "首页", b: "项目页" },
    });
    expect(titles.get("scene-a")?.title).toBe("看队列");
    expect(titles.get("change-1")?.title).toBe("按钮改名");
  });

  it("回复里各行写的区块名和 model 一致", () => {
    const lines = replyLines(page.sections, { droppedAtStart: { note: "Q3 不该取消" } });
    expect(lines[0]?.section).toBe(replySection.label("droppedAtStart"));
  });
});

describe("回复的一行写成字段", () => {
  it("选项写标题，不写「选了选项」和字母", () => {
    expect(
      lineFields(
        { section: "疑问", kind: "选了选项", option: "a" },
        { title: "队列看板放在哪里", optionTitle: "每一页的最后" },
      ),
    ).toEqual([
      ["疑问", "队列看板放在哪里"],
      ["回复", "选「每一页的最后」"],
    ]);
  });

  it("有备注多一个字段，没有备注不写", () => {
    const fields = lineFields(
      { section: "疑问", kind: "同意", note: " 先这样 " },
      { title: "只有一个方向" },
    );
    expect(fields.map(([name]) => name)).toEqual(["疑问", "回复", "备注"]);
    expect(fields.at(-1)).toEqual(["备注", "先这样"]);
  });

  it("认可、不认可、取消写短词", () => {
    const of = (kind: string) => lineFields({ kind }, {}).find(([n]) => n === "回复")?.[1];
    expect(of("认可一条更改")).toBe("认可");
    expect(of("不认可一条更改")).toBe("不认可");
    expect(of("取消队列事项")).toBe("取消");
  });

  it("想法只有一个字段", () => {
    expect(lineFields({ kind: "想法", note: "看板事多时不好找" }, {})).toEqual([
      ["想法", "看板事多时不好找"],
    ]);
  });
});
