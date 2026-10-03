import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renamedStages, type Stage, stage } from "../names.ts";
import { cardIdFromTitle } from "../page/card-id.ts";
import {
  type LegacyReplyLine,
  type LegacyReplyPage,
  legacyReplyPage,
  parseLegacyReply,
} from "./reply-text.ts";

// 两份对照数据，都读旧格式的页面数据：
// - tools/legacy/out/reply-cases.json：tools/legacy/export_reply_samples.py 在 Node 里原样运行
//   旧模板 v1-final 的 compose()，按一组组点选拼出的回复文字，见 tools/legacy/README.md 第四节。
// - __fixtures__/real-replies.json：用户在几个项目里真实贴回对话的回复，原样照录，
//   页面数据只留回复用得到的字段。会话记录和各项目的目录不在仓库里，所以复制进来。
//   公开版删了一份公司项目的回复，另有两页的卡片标题换成了不带项目细节的说法，回复原文没改。

type OldCard = {
  readonly title: string;
  readonly only?: boolean;
  readonly options?: readonly { readonly key: string }[];
};
type OldNamed = { readonly name: string };

/** 旧格式的页面数据里，回复用得到的字段。 */
type OldPage = {
  readonly stage: string;
  readonly round: number;
  readonly asks?: readonly OldCard[];
  readonly findings?: readonly OldCard[];
  readonly improvements?: readonly OldCard[];
  readonly rethink?: readonly OldCard[];
  readonly scenes?: readonly OldNamed[];
  readonly spec?: readonly OldNamed[];
  readonly align?: readonly OldNamed[];
  readonly queue?: readonly { readonly text: string }[];
};

/**
 * 旧页面在旧模板上的样子。卡片编号按标题生成，和 assignCardIds 给没写编号的卡生成的相同。
 * 回到构思的卡按第一期约定第 8 条归入疑问，回复里照旧写「回到构思 1b」。
 * 场景清单和设计规范只在构思阶段画出来。
 * 看板上的文字前面写着编号，按第一个空格切开。
 */
function pageOf(old: OldPage): LegacyReplyPage {
  const key = stage.key(renamedStages.get(old.stage) ?? old.stage);
  if (key === undefined) throw new Error(`阶段「${old.stage}」不对`);
  const cards = (prefix: string, list: readonly OldCard[] | undefined) =>
    (list ?? []).map((card) => ({ ...card, id: cardIdFromTitle(prefix, card.title) }));
  const named = (prefix: string, list: readonly OldNamed[] | undefined) =>
    (list ?? []).map((item) => ({ id: cardIdFromTitle(prefix, item.name), name: item.name }));
  const think = old.stage === "构思";
  const built = legacyReplyPage({
    version: 1,
    stage: key as Stage,
    round: old.round,
    sections: {
      align: named("align", old.align),
      scenes: think ? named("scene", old.scenes) : [],
      spec: think ? named("spec", old.spec) : [],
      asks: cards("ask", old.asks),
      findings: cards("finding", old.findings),
      improvements: cards("improvement", old.improvements),
    },
    queue: (old.queue ?? []).map(({ text }) => {
      const space = text.indexOf(" ");
      return { id: text.slice(0, space), content: text.slice(space + 1) };
    }),
    droppedAtStart: false,
  });
  const rethink = cards("ask", old.rethink).map((card) => ({
    section: "asks" as const,
    card: card.id,
    options: (card.options ?? []).map((option) => option.key),
    only: card.only === true,
  }));
  return { ...built, cards: { ...built.cards, rethink } };
}

// ---- 旧模板 compose() 生成的回复

type Verdict = { readonly n: number; readonly pick: string; readonly edit?: string };

/** 一份样本里用户的点选，写法见 export_reply_samples.py。 */
type Actions = {
  readonly cards?: readonly {
    readonly key: string;
    readonly pick?: string;
    readonly note?: string;
  }[];
  readonly scenes?: readonly Verdict[];
  readonly spec?: readonly Verdict[];
  readonly align?: readonly { readonly n: number; readonly pick: string; readonly say?: string }[];
  readonly queue?: readonly string[];
  readonly ideas?: string;
  readonly images?: readonly { readonly n: number; readonly id: string }[];
};

type ReplyCase = {
  readonly id: string;
  readonly name: string;
  readonly page: string;
  readonly actions: Actions;
  readonly text: string;
};

const exported = JSON.parse(
  readFileSync(new URL("../../../../tools/legacy/out/reply-cases.json", import.meta.url), "utf8"),
) as {
  readonly commit: string;
  readonly count: number;
  readonly shapes: readonly { readonly id: string; readonly cases: readonly string[] }[];
  readonly pages: Readonly<Record<string, OldPage>>;
  readonly cases: readonly ReplyCase[];
};

type Expected = Omit<LegacyReplyLine, "line" | "textLine">;

/**
 * 按用户的点选推出该拆成哪几行，不看回复文字。顺序照 compose() 拼行的顺序，如下。
 * 场景和规范按保留、修改、删除分组，先对齐按明白、不明白分组。组里按页面上的顺序。
 * 队列按点的先后。四块卡依次是疑问、发现、提升、回到构思，块里按序号。最后是想法。
 */
function expectedLines(target: LegacyReplyPage, actions: Actions): Expected[] {
  const imagesOf = (note: string) => {
    const found: { n: number; id: string }[] = [];
    for (const mark of note.matchAll(/〔图 (\d+)〕/gu)) {
      const n = Number(mark[1]);
      const image = actions.images?.find((x) => x.n === n);
      if (image !== undefined && !found.some((x) => x.n === n)) {
        found.push({ n, id: image.id.slice(0, 6) });
      }
    }
    return found;
  };
  const noted = (text: string | undefined) => {
    const note = text?.trim();
    return note ? { note, images: imagesOf(note) } : { images: [] };
  };
  const byN = <T extends { readonly n: number }>(list: readonly T[]) =>
    [...list].sort((a, b) => a.n - b.n);
  const lines: Expected[] = [];
  const verdicts = [
    ["保留", "keep"],
    ["修改", "modify"],
    ["删除", "remove"],
  ] as const;
  for (const section of ["scenes", "spec"] as const) {
    for (const [pick, kind] of verdicts) {
      for (const act of byN((actions[section] ?? []).filter((a) => a.pick === pick))) {
        const card = target.items[section][act.n - 1]?.id;
        // 修改了没写怎么改，compose() 写的「没写怎么改」不算备注
        lines.push({ section, card, kind, ...noted(pick === "修改" ? act.edit : undefined) });
      }
    }
  }
  const understood = [
    ["明白", "understood"],
    ["不明白", "notUnderstood"],
  ] as const;
  for (const [pick, kind] of understood) {
    for (const act of byN((actions.align ?? []).filter((a) => a.pick === pick))) {
      const card = target.items.align[act.n - 1]?.id;
      lines.push({ section: "align", card, kind, ...noted(act.say) });
    }
  }
  for (const text of actions.queue ?? []) {
    lines.push({ section: "queue", kind: "queueDrop", queue: text.split(" ")[0], images: [] });
  }
  const blocks = [
    ["q", "asks"],
    ["f", "findings"],
    ["p", "improvements"],
    ["r", "rethink"],
  ] as const;
  for (const [prefix, block] of blocks) {
    const acts = (actions.cards ?? [])
      .filter((act) => act.key.startsWith(prefix))
      .map((act) => ({ ...act, n: Number(act.key.slice(1)) }));
    for (const act of byN(acts)) {
      const card = target.cards[block][act.n - 1];
      if (card === undefined) throw new Error(`样本写错了：没有 ${act.key}`);
      const { pick } = act;
      const kind =
        pick === undefined
          ? "noteOnly"
          : pick === "否决"
            ? "reject"
            : card.only
              ? "agree"
              : "option";
      lines.push({
        section: card.section,
        card: card.card,
        kind,
        ...(kind === "option" ? { option: pick } : {}),
        ...noted(act.note),
      });
    }
  }
  if (actions.ideas?.trim()) lines.push({ kind: "idea", ...noted(actions.ideas) });
  return lines;
}

describe("旧模板 compose() 生成的回复", () => {
  it("对照数据来自 v1-final，覆盖 compose() 能拼出的每一种行", () => {
    // v1-final 指向的提交
    expect(exported.commit).toMatch(/^a6c9d9a/u);
    expect(exported.cases).toHaveLength(exported.count);
    expect(exported.shapes.map((shape) => shape.id)).toEqual([
      "empty",
      "header",
      "header.renamed",
      "scenes.keep",
      "scenes.modify",
      "scenes.modifyBlank",
      "scenes.remove",
      "spec.keep",
      "spec.modify",
      "spec.modifyBlank",
      "spec.remove",
      "align.understood",
      "align.notUnderstood",
      "align.say",
      "queue.drop",
      "card.option",
      "card.optionNote",
      "card.noteOnly",
      "card.veto",
      "card.noteLines",
      "block.asks",
      "block.findings",
      "block.improvements",
      "block.rethink",
      "idea",
      "idea.lines",
      "image.mark",
      "images",
    ]);
    for (const shape of exported.shapes) expect(shape.cases, shape.id).not.toEqual([]);
  });

  it.each(exported.cases.map((c) => [c.id, c.name, c] as const))(
    "%s %s：拆开的每一行和用户点的一致",
    (_id, _name, c) => {
      const page = exported.pages[c.page];
      if (page === undefined) throw new Error(`没有页面 ${c.page}`);
      const target = pageOf(page);
      const result = parseLegacyReply(c.text, target);
      expect(result.ok ? [] : result.error).toEqual([]);
      if (!result.ok) return;
      const lines = result.value.map(({ line: _line, textLine: _textLine, ...rest }) => rest);
      expect(lines).toEqual(expectedLines(target, c.actions));
      // 行号从 1 连着数，文字里的行号只增不减
      expect(result.value.map((line) => line.line)).toEqual(lines.map((_, i) => i + 1));
      const textLines = result.value.map((line) => line.textLine);
      expect(textLines).toEqual([...textLines].sort((a, b) => a - b));
    },
  );
});

// ---- 用户真实贴回的回复

type RealReply = {
  readonly id: string;
  readonly source: string;
  readonly date: string;
  readonly page: OldPage;
  readonly reply: string;
  /** 预期的问题。不是空的，就在 why 里写明为什么有问题。 */
  readonly problems: readonly { readonly kind: string; readonly line: number }[];
  readonly why?: string;
};

const { replies } = JSON.parse(
  readFileSync(new URL("./__fixtures__/real-replies.json", import.meta.url), "utf8"),
) as { readonly replies: readonly RealReply[] };

const real = (id: string) => {
  const fixture = replies.find((x) => x.id === id);
  if (fixture === undefined) throw new Error(`没有 ${id}`);
  const result = parseLegacyReply(fixture.reply, pageOf(fixture.page));
  if (!result.ok) throw new Error(`${id} 拆不开：${JSON.stringify(result.error)}`);
  return result.value;
};

describe("用户真实贴回的回复", () => {
  const clean = replies.filter((x) => x.problems.length === 0);
  const explained = replies.filter((x) => x.problems.length > 0);

  it("七份照常的回复，两份带着说明的问题", () => {
    expect(clean).toHaveLength(7);
    expect(explained.map((x) => x.id)).toEqual(["abei-think-2", "skill-land-17"]);
  });

  it.each(clean.map((x) => [x.id, x] as const))("%s：拆开没有问题，结果和快照相同", (_id, x) => {
    const result = parseLegacyReply(x.reply, pageOf(x.page));
    expect(result.ok ? [] : result.error).toEqual([]);
    expect(result.ok ? result.value : undefined).toMatchSnapshot();
  });

  it.each(explained.map((x) => [x.id, x] as const))("%s：报出的问题和说明相同", (_id, x) => {
    expect(x.why).toBeTruthy();
    const result = parseLegacyReply(x.reply, pageOf(x.page));
    const problems = result.ok ? [] : result.error;
    expect(problems.map((p) => ({ kind: p.kind, line: p.line }))).toEqual(x.problems);
  });

  it("场景清单、先对齐和疑问各自对回，〔图 1〕〔图 2〕对上最后一行的标识", () => {
    const lines = real("personal-site-think-2");
    expect(lines.map((line) => line.kind)).toEqual([
      ...Array(4).fill("keep"),
      ...Array(2).fill("understood"),
      ...Array(4).fill("option"),
      "noteOnly",
      "noteOnly",
    ]);
    expect(lines[9]?.images).toEqual([
      { n: 1, id: "c232f3" },
      { n: 2, id: "d2c5e2" },
    ]);
  });

  it("备注写了几行，每一行以编号开头，也不会被当成新的一行", () => {
    const notes = real("abei-think-1").map((line) => line.note);
    expect(notes.slice(3)).toEqual([
      "不太记得是那几天了\n大概花了半天\n几乎都是 claude code 做的",
      "1. 几乎不记账\n2. 用claude code + 邮箱账单\n3. 几乎不会",
      "1. 实际没有\n2. 也没有",
    ]);
  });

  it("更早的模板在只有一个方向的卡上写「同意」", () => {
    expect(real("abei-think-3").map((line) => line.kind)).toEqual([
      "option",
      "agree",
      "agree",
      "agree",
    ]);
  });

  it("改名以前的「修复」页面，想法里带四张图，标识是完整的三十二位", () => {
    const [idea, ...rest] = real("skill-fix-2");
    expect(rest).toEqual([]);
    expect(idea?.kind).toBe("idea");
    expect(idea?.images.map((image) => [image.n, image.id.length])).toEqual([
      [1, 32],
      [2, 32],
      [3, 32],
      [4, 32],
    ]);
  });

  it("检查页的发现和提升，十位数的序号也认", () => {
    const lines = real("atlas-check-1");
    expect(lines).toHaveLength(13);
    expect(lines[9]).toMatchObject({ section: "findings", kind: "option", option: "c" });
    expect(lines[8]?.note).toBe("可以重新画符合现在架构的svg或者流程图或者架构图面向客户的");
  });
});
