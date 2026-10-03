import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderCopy } from "../copy/define.ts";
import { writingCopy, writingHintCopy } from "../copy/writing.ts";
import { checkWriting } from "./check.ts";
import { builtInGlossary } from "./glossary.ts";
import { displayWidth, readingLength } from "./measure.ts";
import { checkReply } from "./reply.ts";
import type { WritingResult } from "./rules.ts";

// 对照数据由 tools/legacy/export_writing.py 用旧 skill 的 v1-final 算出，见 tools/legacy/README.md 第三节。
// 新旧两边跑同一批文字。不同的地方只能是「07 校验」第五节写明的有意改动，每一处按样例编号列在下面。

type Kind = "skill" | "reference" | "page" | "edge" | "selftest" | "reply";

type Case = {
  readonly id: string;
  readonly kind: Kind;
  readonly text: string;
  readonly block?: readonly string[];
  readonly warn?: readonly string[];
  readonly wording?: readonly string[];
  readonly verdict?: "block" | "pass";
  readonly want?: "block" | "pass";
};

type Doc = {
  readonly terms: {
    readonly banned: readonly (readonly [string, string])[];
    readonly patterns: readonly (readonly [string, string, string])[];
    readonly soft: readonly (readonly [string, string])[];
    readonly wording: readonly (readonly [string, string])[];
  };
  readonly count: Readonly<Record<Kind, number>>;
  readonly pages: readonly string[];
  readonly measures: readonly (readonly [string, number, number])[];
  readonly cases: readonly Case[];
};

const file = new URL("../../../../tools/legacy/out/writing-cases.json", import.meta.url);
const doc = JSON.parse(readFileSync(file, "utf8")) as Doc;

const ids = (list: string) => list.split(/\s+/u).filter((id) => id !== "");

// 有意改动 1，依据「07 校验」第五节的断句一条：引号里的字照常算进句子的长度和分号，
// 停用的说法出现在引号里只警告。旧脚本先把引号连同里面的字去掉再查，所以下面这些样例两边不同。
// 新代码多报了长句、分号、括号里的并列、语境相关的旧说法和引号里的停用说法。
// 有的句子截取的开头带上了引号里的字，有的文字因为变长，指示词的占比不再过密。
const quotesCounted = ids(`
  skill-013 skill-035 skill-069 skill-078 skill-086 skill-101
  reference-047 reference-379 reference-389 reference-394
  page-eca4147351 page-41998aac4a page-559ed79464 page-9485e0d26a page-21bb38c3bc page-cffd44fb44
  page-9a37f9a655 page-0b8ac0d9d1 page-4bec8d1eb1 page-cd2beada73 page-d1bdf29bf5 page-1be48d992b
  page-3cbc10c705 page-69997f271b page-a77f20ee30 page-303a02c493 page-e7972130a8 page-f552151ae4
  page-a71b80ba2f page-e66a11eed3 page-e136e3dc71 page-ff9b4a162d page-8fa1a278cc page-ff5581171c
  page-d689bcee59 page-c32555ff2f page-f0f2ac31cf page-07aae026ec page-2b60365432 page-b5eeddbe67
  page-4f574eae25 page-e1b3a090c1 page-024df4f063 page-261f36eb7c page-a2728a25b5 page-a5668d8ab2
  page-d083028d69 page-43d5fa2419 page-6c95831b2a page-5640d93f6b page-778b794e73 page-995f3cc433
  page-b47a749980 page-b90593c991 page-5cb437d2af page-1412cb4e6e page-e65c64a3f7 page-be57d4fd90
  page-04d833c5c5 page-4ef05ffe1d page-06f4fe0910 page-59aa829426 page-cf6e59ce18 page-315081dd1d
  page-0b2ea7d7cc page-aed1950b5c page-1bc43aff89 page-7738bdba78 page-71e6aa5766 page-18aeb2950d
  page-0dcdd941c0 page-f70947e38a page-1fdf05c915
  edge-047 edge-048 edge-051 edge-052 edge-053 edge-058
  edge-059 edge-060 edge-061 edge-062 edge-063 edge-064
`);

// 有意改动 3，依据第五节第 3 条：「露出来」从拦截改成警告，报错换成语境相关的旧说法那一条。
// page-26d1cbd230 是 skill 自己的设计规范里的一行词表，edge-044 是手写的样例。
const exposeWarned = ids("page-26d1cbd230 edge-044");

// 有意改动 2，依据第五节第 1 条：术语表分两层。旧脚本只有 skill 自带的一层。
// 不写项目那一层时两边相同，所以对照数据里没有因它而不同的样例，项目那一层的效果见 check.test.ts。

type View = {
  readonly block: readonly string[];
  readonly warn: readonly string[];
  readonly wording: readonly string[];
};

const isWording = (rule: string) => rule.startsWith("writing.wording.");

function viewOf(result: WritingResult): View {
  return {
    block: result.block.map((x) => x.message),
    warn: result.warn.filter((x) => !isWording(x.rule)).map((x) => x.message),
    // 措辞一类的「怎么改」是旧脚本报错句子的最后一句，合起来和旧脚本逐字相同。
    wording: result.warn
      .filter((x) => isWording(x.rule))
      .map((x) => (x.hint === undefined ? x.message : `${x.message}。${x.hint}`)),
  };
}

function oldViewOf(c: Case): View {
  return { block: c.block ?? [], warn: c.warn ?? [], wording: c.wording ?? [] };
}

// 退回有意改动 1：去掉引号连同里面的字，新代码就和旧脚本查同样的字
const withoutQuotes = (text: string) => text.replace(/「[^」]*」|“[^”]*”/gu, "");

// 按有意改动 3 改写旧脚本的结果：「露出来」的拦截换成警告，排在其余警告前面
const oldExpose = "出现了术语表停用的说法「露出来」，统一的术语是「显示」";
const newExpose = renderCopy(writingCopy.term.soft, { phrase: "露出来", replacement: "显示" });
function exposeWarnedOf(view: View): View {
  if (!view.block.includes(oldExpose)) return view;
  return {
    block: view.block.filter((m) => m !== oldExpose),
    warn: [newExpose, ...view.warn],
    wording: view.wording,
  };
}

// 首行的报错换了说法：旧脚本举的例子是「落地第 13 轮」，现在写「第 2 版的落地阶段」。
// 判定相同，只是拦截的那句话不同，对照时把旧脚本的这一句换成新的
const oldFirstLine = "首行要写当前阶段和一句原因，例如「落地第 13 轮：……」";
const newFirstLine = renderCopy(writingCopy.reply.firstLine);
const firstLineRenamed = (messages: readonly string[]) =>
  messages.map((m) => (m === oldFirstLine ? newFirstLine : m));

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const prose = ({ block, warn }: View) => ({ block, warn });

const writingKinds = ["skill", "reference", "page", "edge"] as const;
const writingCases = doc.cases.filter((c) => (writingKinds as readonly Kind[]).includes(c.kind));
const casesOf = (kind: Kind) => doc.cases.filter((c) => c.kind === kind);

/** 两边不同的样例，连同两边的结果，方便看出错在哪里。 */
function mismatches(cases: readonly Case[], got: (c: Case) => unknown, want: (c: Case) => unknown) {
  return cases
    .map((c) => ({ id: c.id, text: c.text, got: got(c), want: want(c) }))
    .filter((m) => !same(m.got, m.want));
}

describe("和旧脚本的写作校验逐条对照", () => {
  it("对照数据有旧正文、参考文件、两个以上项目的历史页面，以及手写的样例", () => {
    for (const kind of [...writingKinds, "selftest", "reply"] as const) {
      expect(doc.count[kind]).toBeGreaterThan(0);
      expect(casesOf(kind)).toHaveLength(doc.count[kind]);
    }
    const projects = new Set(doc.pages.map((page) => page.split("/")[0]));
    expect(projects.size).toBeGreaterThanOrEqual(2);
    expect(new Set(doc.cases.map((c) => c.id)).size).toBe(doc.cases.length);
  });

  it("skill 自带的一层就是旧脚本的三张表，顺序相同", () => {
    const { banned, patterns, soft } = doc.terms;
    const rows = (level: "block" | "warn") =>
      builtInGlossary
        .filter((e) => e.level === level && e.notAfter === undefined)
        .map((e) => [e.phrase, e.replacement]);
    expect(rows("block")).toEqual(banned);
    expect(rows("warn")).toEqual(soft);
    const withNotAfter = builtInGlossary.filter((e) => e.notAfter !== undefined);
    expect(
      withNotAfter.map((e) => [`(?<!${e.notAfter})${e.phrase}`, e.phrase, e.replacement]),
    ).toEqual(patterns);
    expect(builtInGlossary.map((e) => e.phrase)).toEqual([
      ...banned.map(([phrase]) => phrase),
      ...patterns.map(([, phrase]) => phrase),
      ...soft.map(([phrase]) => phrase),
    ]);
  });

  it("措辞一类的五条和旧脚本的说法、顺序相同", () => {
    expect(Object.values(writingCopy.wording).map((entry) => entry.text)).toEqual(
      doc.terms.wording.map(([rule]) => `出现「{hit}」。${rule}`),
    );
    expect(writingHintCopy.wording.text).toBe("是引用就留着，是写错了就改");
  });

  it("读起来的长度和显示的宽度逐个相同", () => {
    const wrong = doc.measures.filter(
      ([s, length, width]) => readingLength(s) !== length || displayWidth(s) !== width,
    );
    expect(doc.measures.length).toBeGreaterThan(300);
    expect(wrong).toEqual([]);
  });

  it.each(writingKinds)("%s：退回两处有意改动以后，拦截和警告逐条相同", (kind) => {
    const wrong = mismatches(
      casesOf(kind),
      (c) => prose(viewOf(checkWriting(withoutQuotes(c.text)))),
      (c) => prose(exposeWarnedOf(oldViewOf(c))),
    );
    expect(wrong).toEqual([]);
  });

  it.each(writingKinds)("%s：措辞一类逐条相同，引号里的也照旧报", (kind) => {
    const wrong = mismatches(
      casesOf(kind),
      (c) => viewOf(checkWriting(c.text)).wording,
      (c) => oldViewOf(c).wording,
    );
    expect(wrong).toEqual([]);
  });

  it("两边不同的样例正好是上面按编号列出的那些", () => {
    const differ = writingCases
      .filter((c) => !same(prose(viewOf(checkWriting(c.text))), prose(oldViewOf(c))))
      .map((c) => c.id);
    expect(differ.sort()).toEqual([...quotesCounted, ...exposeWarned].sort());
  });

  it("列在有意改动 1 下的样例，不同确实来自引号里的字", () => {
    const byId = new Map(writingCases.map((c) => [c.id, c]));
    for (const id of quotesCounted) {
      const c = byId.get(id);
      expect(c, id).toBeDefined();
      const text = c?.text ?? "";
      expect(same(viewOf(checkWriting(text)), viewOf(checkWriting(withoutQuotes(text)))), id).toBe(
        false,
      );
    }
  });

  it("列在有意改动 3 下的样例，旧脚本拦截了「露出来」，新代码只警告", () => {
    const byId = new Map(writingCases.map((c) => [c.id, c]));
    for (const id of exposeWarned) {
      const c = byId.get(id);
      expect(c?.block, id).toContain(oldExpose);
      const now = viewOf(checkWriting(c?.text ?? ""));
      expect(now.block, id).not.toContain(oldExpose);
      expect(now.warn, id).toContain(newExpose);
    }
  });
});

describe("和旧 check-reply.py 逐条对照", () => {
  it("自带的十二条样本，新旧判定相同，也和样本写的预期相同", () => {
    const selftests = casesOf("selftest");
    expect(selftests).toHaveLength(12);
    for (const c of selftests) {
      const verdict = checkReply(c.text).block.length > 0 ? "block" : "pass";
      expect(verdict, c.id).toBe(c.verdict);
      expect(verdict, c.id).toBe(c.want);
    }
  });

  it.each(["selftest", "reply"] as const)("%s：拦截和警告逐条相同", (kind) => {
    const wrong = mismatches(
      casesOf(kind),
      (c) => {
        const { block, warn } = checkReply(c.text);
        // 有意改动：会话回复也查措辞一类，只警告，旧脚本不查，所以对照时不算。
        return {
          block: block.map((x) => x.message),
          warn: warn.filter((x) => !isWording(x.rule)).map((x) => x.message),
        };
      },
      (c) => ({ block: firstLineRenamed(c.block ?? []), warn: c.warn ?? [] }),
    );
    expect(wrong).toEqual([]);
  });
});
