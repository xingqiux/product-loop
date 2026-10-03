import { renderCopy } from "../copy/define.ts";
import { legacyReplyCopy } from "../copy/legacy-reply.ts";
import { defineEnum, type KeyOf } from "../enum.ts";
import type { Issue } from "../envelope.ts";
import { type ReplyLineKind, renamedStages, type Stage, stage } from "../names.ts";
import { pageSection } from "../page/section-names.ts";
import { err, ok, type Result } from "../result.ts";
import { formatRoundName, parseRoundName } from "../round-name.ts";

// 旧模板复制出的回复文字：拆成一行一件事，对回卡片编号和队列编号，见第一期计划第 23 步。
//
// 第一期每一轮的页面套用旧模板，见「11 分期计划」第三节。旧模板的「复制回复」由 10-app.js 的
// compose() 拼出文字。后端的 POST /pages/:id/submission/text 收下这份文字，按这里拆成各行。
// 接口见「05 接口」第四节，回复的一行见「03 数据模型」第二节。compose() 能拼出的每一种行都有样本，
// 由 tools/legacy/export_reply_samples.py 原样运行旧代码得到。一份文字的样子如下：
//
//   检查第 3 轮                                第一行：阶段和轮号
//   场景 修改：「S9 看队列」（第 2 步写错了）     场景清单、设计规范、先对齐写名字
//   对齐 不明白：「胃口」
//   队列 不做了：「Q8 窄屏上的回复框」           看板上的事写它的文字，文字前面是编号
//   疑问 1a  2（备注）  3否决（原因）            卡片写块名和序号，后面跟选项和备注
//   想法：……                                   想法框，可以有几行
//   图：图 1=2e8f4d  图 2=92c9d4                备注里〔图 1〕的标识，只写前六位
//
// 旧回复按卡片在页面上的序号、按看板上的文字指代东西（第一期约定第 9 条）。
// 所以拆的时候要知道这一页在旧模板上的样子，见 legacyReplyPage。

/** 旧模板上要点的四块卡。回复里写块名和卡在这一块里的序号，例如「疑问 2a」。 */
export const legacyCardBlock = defineEnum({
  asks: "疑问",
  findings: "发现",
  improvements: "提升",
  rethink: "回到构思",
});
export type LegacyCardBlock = KeyOf<typeof legacyCardBlock>;

/** 旧模板上按名字回复的四块。回复里写块名、点的按钮和名字，例如「场景 保留：「看队列」」。 */
export const legacyNameBlock = defineEnum({
  scenes: "场景",
  spec: "规范",
  align: "对齐",
  queue: "队列",
});
export type LegacyNameBlock = KeyOf<typeof legacyNameBlock>;

/**
 * 回复的一行来自哪个区块。场景清单到提升是页面数据里的区块，见 page/section-names.ts。
 * 另有后端摆出的两块：看板上的队列，和这一轮开始时取消的事（「06 工作台」第四节）。
 */
export type LegacyReplySection =
  | "align"
  | "scenes"
  | "spec"
  | "asks"
  | "findings"
  | "improvements"
  | "queue"
  | "droppedAtStart";

/** 旧模板上的一张卡。 */
export type LegacyReplyCard = {
  readonly section: LegacyReplySection;
  /** 卡片编号。「这一轮开始时取消的事」那一张没有。 */
  readonly card?: string;
  /** 选项的 key，按页面上的顺序。没有选项的卡只有备注框。 */
  readonly options: readonly string[];
  /** 只有一个方向的卡：点那个方向算同意，点「否决」算否决。 */
  readonly only: boolean;
};

/** 旧模板上按名字回复的一项：场景、规范的一格、先对齐的术语，或看板上的一件事。 */
export type LegacyReplyItem = {
  /** 卡片编号。看板上的事写队列事项的编号，例如 Q12。 */
  readonly id: string;
  /** 回复里认的名字。第一个是页面上显示的写法，后面几个是不带编号的写法。 */
  readonly names: readonly [string, ...string[]];
};

/** 一页在旧模板上的样子：回复按它对回卡片编号和队列编号。 */
export type LegacyReplyPage = {
  /** 第几版。第一行写「第 2 版的构思阶段」时对照它。 */
  readonly version: number;
  readonly stage: Stage;
  /** 这一版里这个阶段的第几次，旧模板的页头写成「第 3 轮」，新的写法是「（第 3 次）」。 */
  readonly round: number;
  /** 四块卡，各按页面上的顺序。回复里的序号从 1 数。 */
  readonly cards: Readonly<Record<LegacyCardBlock, readonly LegacyReplyCard[]>>;
  readonly items: Readonly<Record<LegacyNameBlock, readonly LegacyReplyItem[]>>;
};

/** 回复里带的一张图：〔图 N〕的序号，和最后一行「图：」写的标识。旧模板只写标识的前六位。 */
export type LegacyReplyImage = { readonly n: number; readonly id: string };

/**
 * 拆开以后的一行，一行一件事。存成回复的一行时，后端补上回复的编号、图的完整哈希和是否已读，
 * 见 reply.ts 的 replyLineSchema。
 */
export type LegacyReplyLine = {
  /** 拆开以后的第几行，从 1 数，就是回复的一行的行号。 */
  readonly line: number;
  /** 这一件事在回复文字里从第几行开始，从 1 数。 */
  readonly textLine: number;
  /** 来自哪个区块。想法没有。 */
  readonly section?: LegacyReplySection;
  /** 卡片编号。想法、取消队列事项、这一轮开始时取消的事没有。 */
  readonly card?: string;
  readonly kind: ReplyLineKind;
  /** 选的选项，种类是选了选项时才有。 */
  readonly option?: string;
  /** 取消的是哪一件队列事项，写编号，例如 Q12。种类是取消队列事项时才有。 */
  readonly queue?: string;
  /** 备注、修改时写的怎么改、先对齐时用户自己的话，或者想法的全文。 */
  readonly note?: string;
  /** 备注里的〔图 N〕，按第一次出现的先后，同一张只记一次。 */
  readonly images: readonly LegacyReplyImage[];
};

// ---- 从新格式的页面数据算出旧模板上的样子

type CardSource = {
  readonly id: string;
  readonly only?: boolean | undefined;
  readonly options?: readonly { readonly key: string }[] | undefined;
};
type NamedSource = { readonly id: string; readonly name: string };
type SceneSource = NamedSource & { readonly scene?: string | undefined };

/** 算旧模板上的样子要用的东西。页面数据的各个区块要先填好卡片编号，见 assignCardIds。 */
export type LegacyReplySource = {
  readonly version: number;
  readonly stage: Stage;
  readonly round: number;
  readonly sections: {
    readonly align?: readonly NamedSource[] | undefined;
    readonly scenes?: readonly SceneSource[] | undefined;
    readonly spec?: readonly NamedSource[] | undefined;
    readonly asks?: readonly CardSource[] | undefined;
    readonly findings?: readonly CardSource[] | undefined;
    readonly improvements?: readonly CardSource[] | undefined;
  };
  /** 看板上的事，按看板上的顺序。 */
  readonly queue: readonly { readonly id: string; readonly content: string }[];
  /** 这一轮开始时有没有取消的事。 */
  readonly droppedAtStart: boolean;
};

/** 看板上一件事的文字：编号写在前面（第一期约定第 9 条）。后端给旧模板摆看板时用它。 */
export function legacyQueueText(item: { readonly id: string; readonly content: string }): string {
  return `${item.id} ${item.content}`;
}

/** 旧模板上场景的名字：有场景编号的，编号写在名字前面，例如「S9 看队列」。 */
export function legacySceneName(scene: {
  readonly scene?: string | undefined;
  readonly name: string;
}): string {
  return scene.scene === undefined ? scene.name : `${scene.scene} ${scene.name}`;
}

/** 「这一轮开始时取消的事」在旧模板上是一张只有备注框的疑问卡（第一期约定第 9 条）。 */
const droppedAtStartCard: LegacyReplyCard = { section: "droppedAtStart", options: [], only: false };

/**
 * 新格式的一页在旧模板上的样子。后端把页面摆进旧模板时要按同样的顺序摆，回复才对得上：
 * - 疑问、发现、提升各按页面数据的顺序。回到构思已删除（决定 140），新格式的页面没有这一块。
 * - 这一轮开始时有取消的事，就在疑问的最前面加一张只有备注框的卡，写这几件事。
 * - 场景的名字用 legacySceneName，看板上的文字用 legacyQueueText。回复里写不带编号的名字也认。
 */
export function legacyReplyPage(source: LegacyReplySource): LegacyReplyPage {
  const { sections } = source;
  const cardsOf = (section: LegacyReplySection, list: readonly CardSource[] | undefined) =>
    (list ?? []).map(
      (card): LegacyReplyCard => ({
        section,
        card: card.id,
        options: (card.options ?? []).map((option) => option.key),
        only: card.only === true,
      }),
    );
  const itemsOf = (list: readonly NamedSource[] | undefined) =>
    (list ?? []).map((item): LegacyReplyItem => ({ id: item.id, names: [item.name] }));
  return {
    version: source.version,
    stage: source.stage,
    round: source.round,
    cards: {
      asks: [
        ...(source.droppedAtStart ? [droppedAtStartCard] : []),
        ...cardsOf("asks", sections.asks),
      ],
      findings: cardsOf("findings", sections.findings),
      improvements: cardsOf("improvements", sections.improvements),
      rethink: [],
    },
    items: {
      scenes: (sections.scenes ?? []).map((scene) => ({
        id: scene.id,
        names: namesOf(legacySceneName(scene), scene.name),
      })),
      spec: itemsOf(sections.spec),
      align: itemsOf(sections.align),
      queue: source.queue.map((item) => ({
        id: item.id,
        names: namesOf(legacyQueueText(item), item.content),
      })),
    },
  };
}

/** 页面上显示的写法在前，不带编号的写法在后，两者相同时只留一个。 */
function namesOf(shown: string, bare: string): readonly [string, ...string[]] {
  return shown === bare ? [shown] : [shown, bare];
}

// ---- 问题

/**
 * 回复文字对不上这一页的地方。line 是回复文字里的行号，从 1 数。
 * - headerMissing：第一行不是「第 2 版的检查阶段」这样的写法，旧的「检查第 3 轮」也认。
 *   expected 是这一页的写法。
 * - headerMismatch：第一行的版本、阶段或次数和这一页的不同，多半贴错了页。
 * - lineUnknown：这一行不以任何一块的名字开头。
 * - verdictUnknown：场景、规范、对齐、队列后面的按钮不是这一块有的，例如更早的模板写的「场景 留：」。
 * - cardItemUnknown、nameItemUnknown：一行里有一段既不是卡的序号，也不是「」里的名字。
 * - blockEmpty、cardNumber：这一块没有卡，或者没有这么多张卡。
 * - optionUnknown、optionNone：卡上没有这个选项，或者卡上根本没有选项。
 * - onlyWord：「同意」「否决」写在了有几个选项的卡上。
 * - itemEmpty：序号后面既没有选项，也没有备注。
 * - nameUnknown、queueUnknown：名字在这一页上找不到，或者看板上没有这件事。
 * - cardDuplicate、nameDuplicate：同一张卡、同一项回复了两次，first 是第一次所在的行。
 * - noteUnclosed：备注的左括号找不到配对的右括号。
 * - ideaEmpty：「想法：」后面是空的。
 * - imageUnknown：备注里有〔图 N〕，最后一行「图：」里却没有它的标识。
 * - imageLine：「图：」这一行的写法不对，或者同一个序号写了两次。
 */
export type LegacyReplyProblem =
  | { readonly kind: "headerMissing"; readonly line: number; readonly expected: string }
  | {
      readonly kind: "headerMismatch";
      readonly line: number;
      readonly written: string;
      readonly expected: string;
    }
  | { readonly kind: "lineUnknown"; readonly line: number; readonly text: string }
  | {
      readonly kind: "verdictUnknown";
      readonly line: number;
      readonly block: LegacyNameBlock;
      readonly verdict: string;
    }
  | {
      readonly kind: "cardItemUnknown";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly text: string;
    }
  | {
      readonly kind: "nameItemUnknown";
      readonly line: number;
      readonly block: LegacyNameBlock;
      readonly text: string;
    }
  | {
      readonly kind: "blockEmpty" | "itemEmpty";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
    }
  | {
      readonly kind: "cardNumber";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
      readonly count: number;
    }
  | {
      readonly kind: "optionUnknown";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
      readonly option: string;
      readonly options: readonly string[];
    }
  | {
      readonly kind: "optionNone";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
      readonly option: string;
    }
  | {
      readonly kind: "onlyWord";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
      readonly word: string;
    }
  | {
      readonly kind: "nameUnknown";
      readonly line: number;
      readonly block: Exclude<LegacyNameBlock, "queue">;
      readonly name: string;
    }
  | { readonly kind: "queueUnknown"; readonly line: number; readonly text: string }
  | {
      readonly kind: "cardDuplicate";
      readonly line: number;
      readonly block: LegacyCardBlock;
      readonly n: number;
      readonly first: number;
    }
  | {
      readonly kind: "nameDuplicate";
      readonly line: number;
      readonly block: LegacyNameBlock;
      readonly name: string;
      readonly first: number;
    }
  | { readonly kind: "noteUnclosed"; readonly line: number; readonly text: string }
  | { readonly kind: "ideaEmpty"; readonly line: number }
  | { readonly kind: "imageUnknown"; readonly line: number; readonly n: number }
  | { readonly kind: "imageLine"; readonly line: number; readonly text: string };

export type LegacyReplyProblemKind = LegacyReplyProblem["kind"];

export type LegacyReplyResult = Result<
  LegacyReplyLine[],
  readonly [LegacyReplyProblem, ...LegacyReplyProblem[]]
>;

// ---- 拆开回复文字

/** 什么都没点时，复制框里是这一句，复制出来的也是它。 */
const emptyReply = "还没有要复制的内容";

/** 场景或规范点了修改、没写怎么改时，compose() 替用户写的一句。它不算备注。 */
const blankEdit = "没写怎么改";

/** 每一块的按钮对应回复的一行的种类。按钮的文字和 10-app.js 相同。 */
const keepModifyRemove: ReadonlyMap<string, ReplyLineKind> = new Map([
  ["保留", "keep"],
  ["修改", "modify"],
  ["删除", "remove"],
]);
const verdictKinds: Readonly<Record<LegacyNameBlock, ReadonlyMap<string, ReplyLineKind>>> = {
  scenes: keepModifyRemove,
  spec: keepModifyRemove,
  align: new Map([
    ["明白", "understood"],
    ["不明白", "notUnderstood"],
  ]),
  queue: new Map([["不做了", "queueDrop"]]),
};

/** 只有一个方向的卡上，除了那个方向的 key，还认这两个词。「同意」是更早的模板写的。 */
const onlyWords: ReadonlyMap<string, ReplyLineKind> = new Map([
  ["同意", "agree"],
  ["否决", "reject"],
]);

// 带 y 的写法从给定的位置开始匹配，用 matchAt 调用
const headerPattern = /^(\S*?)第\s*(\d+)\s*轮$/u;
const nameLinePattern = /(场景|规范|对齐|队列) ([^：\n]*)：/uy;
const cardLinePattern = /(疑问|发现|提升|回到构思) /uy;
/** 一行的开头是某一块的名字。拆备注时用它判断备注后面换了行，接的是不是新的一行。 */
const lineStartPattern =
  /(?:(?:场景|规范|对齐|队列) [^：\n]*：|(?:疑问|发现|提升|回到构思) \d|想法：|图：)/uy;
/** 卡的一项：序号，后面紧跟选项的 key 或「同意」「否决」，也可以什么都不跟。 */
const cardItemPattern = /(\d+)([^\s（]*)/uy;
/** 备注后面接的是下一项：序号和选项之后是备注、下一项或者行尾。 */
const nextCardPattern = /\d+[^\s（]*(?:（|[ \t\u3000]*(?:\n|$)|[ \t\u3000]+\d)/uy;
const spacePattern = /[ \t\u3000]*/uy;
const queueIdPattern = /^Q[1-9]\d*(?=[ \t\u3000]|$)/u;
const imageLinePattern =
  /^图：图 ?\d+=[0-9A-Za-z_-]+(?:[ \t\u3000]+图 ?\d+=[0-9A-Za-z_-]+)*[ \t\u3000]*$/u;
const imageItemPattern = /图 ?(\d+)=([0-9A-Za-z_-]+)/gu;
const imageMarkPattern = /〔图 ?(\d+)〕/gu;

/** 还没有编号的一行，和它的备注在回复文字里的位置。 */
type Found = Omit<LegacyReplyLine, "line" | "images"> & { readonly noteAt: number };

type Scan = {
  readonly src: string;
  readonly page: LegacyReplyPage;
  /** 每一行开头的下标。 */
  readonly starts: readonly number[];
  readonly found: Found[];
  readonly problems: LegacyReplyProblem[];
  /** 回复过的卡和名字，记第一次所在的行。 */
  readonly seen: Map<string, number>;
  /** 最后一行「图：」写的每张图的标识。 */
  readonly images: Map<number, string>;
};

/**
 * 拆开旧模板复制出的回复文字，一行一件事，种类见 names.ts 的 replyLineKind。
 * 每一行对回区块和卡片编号，取消队列事项的一行对回队列编号。
 * 备注原样保留，可以有几行，里面的〔图 N〕按最后一行「图：」对上标识。
 *
 * 对不上的地方一次全部报出，按行号排。什么都没点时复制出的占位的一句，和空的文字一样，得到零行。
 * 旧模板拼不出「认可一条更改」和「不认可一条更改」，别的十一种都拼得出。更改在旧模板上只给人看，见「06 工作台」第四节。
 */
export function parseLegacyReply(text: string, page: LegacyReplyPage): LegacyReplyResult {
  // 开头的字节顺序标记和各种换行先统一。复制时文字首尾不会有空白，贴进对话以后可能多出来
  const src = text
    .replace(/^\uFEFF/u, "")
    .replace(/\r\n?/gu, "\n")
    .trim();
  if (src === "" || src === emptyReply) return ok([]);
  const starts = [0];
  for (let i = src.indexOf("\n"); i !== -1; i = src.indexOf("\n", i + 1)) starts.push(i + 1);
  const scan: Scan = {
    src,
    page,
    starts,
    found: [],
    problems: [],
    seen: new Map(),
    images: new Map(),
  };
  let pos = readHeader(scan);
  while (pos < src.length) pos = readLine(scan, pos);
  const lines = scan.found.map(({ noteAt, ...found }, i): LegacyReplyLine => {
    const images = imagesOf(scan, found, noteAt);
    return { line: i + 1, ...found, images };
  });
  const [first, ...rest] = scan.problems
    .map((problem, order) => ({ problem, order }))
    .sort((a, b) => a.problem.line - b.problem.line || a.order - b.order)
    .map(({ problem }) => problem);
  return first === undefined ? ok(lines) : err([first, ...rest]);
}

/**
 * 一条问题的报错：什么不对、怎么改，在哪里写回复文字的行号。
 * 给了文件的路径时，在哪里写文件和行号，例如 ploop reply ingest 读的文件。规矩的编号由调用的地方写。
 */
export function describeLegacyReplyProblem(problem: LegacyReplyProblem, file?: string): Issue {
  const [message, hint] = problemText(problem);
  const where =
    file === undefined
      ? renderCopy(legacyReplyCopy.where, { line: problem.line })
      : renderCopy(legacyReplyCopy.fileWhere, { file, line: problem.line });
  return { message, hint, where };
}

function problemText(problem: LegacyReplyProblem): readonly [message: string, hint: string] {
  const c = legacyReplyCopy.problem;
  switch (problem.kind) {
    case "headerMissing":
      return [
        renderCopy(c.headerMissing.message),
        renderCopy(c.headerMissing.hint, { expected: problem.expected }),
      ];
    case "headerMismatch":
      return [
        renderCopy(c.headerMismatch.message, {
          written: problem.written,
          expected: problem.expected,
        }),
        renderCopy(c.headerMismatch.hint, { expected: problem.expected }),
      ];
    case "lineUnknown":
      return [
        renderCopy(c.lineUnknown.message, { text: problem.text }),
        renderCopy(c.lineUnknown.hint, {
          starts: [...legacyNameBlock.labels, ...legacyCardBlock.labels, "想法", "图"].join("、"),
        }),
      ];
    case "verdictUnknown": {
      const block = legacyNameBlock.label(problem.block);
      const verdicts = [...verdictKinds[problem.block].keys()];
      return [
        renderCopy(c.verdictUnknown.message, { block, verdict: problem.verdict }),
        renderCopy(c.verdictUnknown.hint, { block, verdicts: listOf(verdicts, "或") }),
      ];
    }
    case "cardItemUnknown":
      return [
        renderCopy(c.cardItemUnknown.message, {
          block: legacyCardBlock.label(problem.block),
          text: problem.text,
        }),
        renderCopy(c.cardItemUnknown.hint),
      ];
    case "nameItemUnknown":
      return [
        renderCopy(c.nameItemUnknown.message, {
          block: legacyNameBlock.label(problem.block),
          text: problem.text,
        }),
        renderCopy(c.nameItemUnknown.hint),
      ];
    case "blockEmpty": {
      const block = legacyCardBlock.label(problem.block);
      return [
        renderCopy(c.blockEmpty.message, { block, n: problem.n }),
        renderCopy(c.blockEmpty.hint),
      ];
    }
    case "cardNumber": {
      const block = legacyCardBlock.label(problem.block);
      return [
        renderCopy(c.cardNumber.message, { block, count: problem.count, n: problem.n }),
        renderCopy(c.cardNumber.hint, { block, count: problem.count }),
      ];
    }
    case "optionUnknown":
      return [
        renderCopy(c.optionUnknown.message, {
          block: legacyCardBlock.label(problem.block),
          n: problem.n,
          option: problem.option,
          options: problem.options.join("、"),
        }),
        renderCopy(c.optionUnknown.hint),
      ];
    case "optionNone": {
      const block = legacyCardBlock.label(problem.block);
      return [
        renderCopy(c.optionNone.message, { block, n: problem.n, option: problem.option }),
        renderCopy(c.optionNone.hint, { block, n: problem.n }),
      ];
    }
    case "onlyWord":
      return [
        renderCopy(c.onlyWord.message, {
          block: legacyCardBlock.label(problem.block),
          n: problem.n,
          word: problem.word,
        }),
        renderCopy(c.onlyWord.hint),
      ];
    case "itemEmpty":
      return [
        renderCopy(c.itemEmpty.message, {
          block: legacyCardBlock.label(problem.block),
          n: problem.n,
        }),
        renderCopy(c.itemEmpty.hint),
      ];
    case "nameUnknown":
      return [
        renderCopy(c.nameUnknown.message, {
          section: pageSection.label(problem.block),
          name: problem.name,
        }),
        renderCopy(c.nameUnknown.hint),
      ];
    case "queueUnknown":
      return [
        renderCopy(c.queueUnknown.message, { text: problem.text }),
        renderCopy(c.queueUnknown.hint),
      ];
    case "cardDuplicate":
      return [
        renderCopy(c.cardDuplicate.message, {
          block: legacyCardBlock.label(problem.block),
          n: problem.n,
          first: problem.first,
        }),
        renderCopy(c.cardDuplicate.hint),
      ];
    case "nameDuplicate":
      return [
        renderCopy(c.nameDuplicate.message, {
          block: legacyNameBlock.label(problem.block),
          name: problem.name,
          first: problem.first,
        }),
        renderCopy(c.nameDuplicate.hint),
      ];
    case "noteUnclosed":
      return [
        renderCopy(c.noteUnclosed.message, { text: problem.text }),
        renderCopy(c.noteUnclosed.hint),
      ];
    case "ideaEmpty":
      return [renderCopy(c.ideaEmpty.message), renderCopy(c.ideaEmpty.hint)];
    case "imageUnknown":
      return [
        renderCopy(c.imageUnknown.message, { n: problem.n }),
        renderCopy(c.imageUnknown.hint, { n: problem.n }),
      ];
    case "imageLine":
      return [
        renderCopy(c.imageLine.message, { text: problem.text }),
        renderCopy(c.imageLine.hint),
      ];
  }
}

/** 「保留、修改或删除」这样的列举。 */
function listOf(words: readonly string[], last: string): string {
  const tail = words.at(-1);
  if (tail === undefined || words.length === 1) return words.join("");
  return `${words.slice(0, -1).join("、")}${last}${tail}`;
}

// ---- 逐行读

function matchAt(pattern: RegExp, src: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(src);
}

function lineEnd(src: string, at: number): number {
  const i = src.indexOf("\n", at);
  return i === -1 ? src.length : i;
}

function nextLine(src: string, at: number): number {
  const i = src.indexOf("\n", at);
  return i === -1 ? src.length : i + 1;
}

function skipSpaces(src: string, at: number): number {
  return at + (matchAt(spacePattern, src, at)?.[0].length ?? 0);
}

/** 下标所在的行号，从 1 数。 */
function lineOf(scan: Scan, at: number): number {
  let low = 0;
  let high = scan.starts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if ((scan.starts[mid] ?? 0) <= at) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

/** 报错里引用的一段原文：只取到行尾，最多二十个字。 */
function excerpt(src: string, at: number): string {
  const chars = Array.from(src.slice(at, lineEnd(src, at)).trim());
  return chars.length > 20 ? `${chars.slice(0, 20).join("")}……` : chars.join("");
}

/** 这里开始的是新的一行：到了文字的末尾，或者跳过空行以后以某一块的名字开头。 */
function isLineStart(src: string, at: number): boolean {
  let i = at;
  while (src[i] === "\n") i += 1;
  return i >= src.length || matchAt(lineStartPattern, src, i) !== null;
}

/**
 * 一项到这里结束：后面是行尾，或者空格以后是同一行的下一项。
 * 行尾之后要么是文字的末尾，要么是新的一行，否则说明备注换了行还没写完。
 */
function endsItem(src: string, at: number, list: "card" | "name"): boolean {
  const i = skipSpaces(src, at);
  if (i >= src.length) return true;
  if (src[i] === "\n") return isLineStart(src, i + 1);
  if (i === at) return false;
  return list === "card" ? matchAt(nextCardPattern, src, i) !== null : src[i] === "「";
}

/**
 * 备注的右括号。备注本身可以有括号，也可以有几行，所以从左括号往后找，右括号后面接得上的才算：
 * 1. 括号配平的第一个。备注里成对的括号，例如「导出 pptx（可编辑）」，不会被当成结尾。
 * 2. 没有配平的，取第一个接得上的。备注里多写了半个括号时是这种情况，例如「1）第一点」。
 * 第 2 条只找到下一行开头之前，免得一个没写完的备注吞掉后面几行。
 */
function noteEnd(src: string, open: number, list: "card" | "name"): number | undefined {
  let depth = 0;
  let crossed = false;
  let fallback: number | undefined;
  for (let i = open; i < src.length; i += 1) {
    const char = src[i];
    if (char === "（") depth += 1;
    else if (char === "\n" && isLineStart(src, i + 1)) crossed = true;
    else if (char === "）") {
      depth -= 1;
      if (!endsItem(src, i + 1, list)) continue;
      if (depth <= 0) return i;
      if (!crossed) fallback ??= i;
    }
  }
  return fallback;
}

/** 读一个括号里的备注。返回备注、它在文字里开始的位置和右括号后面的位置。 */
function readNote(
  scan: Scan,
  open: number,
  list: "card" | "name",
): { readonly note?: string; readonly noteAt: number; readonly end: number } | undefined {
  const close = noteEnd(scan.src, open, list);
  if (close === undefined) return undefined;
  const raw = scan.src.slice(open + 1, close);
  const note = raw.trim();
  const noteAt = open + 1 + (raw.length - raw.trimStart().length);
  return note === "" ? { noteAt, end: close + 1 } : { note, noteAt, end: close + 1 };
}

function readHeader(scan: Scan): number {
  const { src, page } = scan;
  const first = src.slice(0, lineEnd(src, 0)).trim();
  const label = stage.label(page.stage);
  const expected = formatRoundName({ version: page.version, stage: page.stage, seq: page.round });
  // 新的写法「第 2 版的检查阶段」，第二次起加「（第 2 次）」，见决定 211。
  const named = parseRoundName(first);
  if (named.ok) {
    const { version, stage: written, seq } = named.value;
    if (version !== page.version || written !== page.stage || seq !== page.round) {
      scan.problems.push({ kind: "headerMismatch", line: 1, written: first, expected });
    }
    return nextLine(src, 0);
  }
  // 旧模板的写法「检查第 3 轮」还认，更早的模板写的「修复」当作落地。
  const header = headerPattern.exec(first);
  if (header === null) {
    // 第一行照常当作一行来读，里面的问题也一起报出
    scan.problems.push({ kind: "headerMissing", line: 1, expected });
    return 0;
  }
  const written = header[1] ?? "";
  const same = (renamedStages.get(written) ?? written) === label;
  if (!same || Number(header[2]) !== page.round) {
    scan.problems.push({ kind: "headerMismatch", line: 1, written: first, expected });
  }
  return nextLine(src, 0);
}

function readLine(scan: Scan, at: number): number {
  const { src } = scan;
  if (src.slice(at, lineEnd(src, at)).trim() === "") return nextLine(src, at);
  const line = lineOf(scan, at);
  const named = matchAt(nameLinePattern, src, at);
  const nameBlock = legacyNameBlock.key(named?.[1] ?? "");
  if (named !== null && nameBlock !== undefined) {
    const verdict = named[2] ?? "";
    const kind = verdictKinds[nameBlock].get(verdict);
    if (kind === undefined) {
      scan.problems.push({ kind: "verdictUnknown", line, block: nameBlock, verdict });
      return nextLine(src, at);
    }
    return readNames(scan, at, at + named[0].length, nameBlock, kind);
  }
  const cards = matchAt(cardLinePattern, src, at);
  const cardBlock = legacyCardBlock.key(cards?.[1] ?? "");
  if (cards !== null && cardBlock !== undefined) {
    return readCards(scan, at, at + cards[0].length, cardBlock);
  }
  if (src.startsWith("想法：", at)) return readIdea(scan, at, at + "想法：".length);
  if (src.startsWith("图：", at)) return readImageLine(scan, at);
  return unknownLine(scan, at, line);
}

function unknownLine(scan: Scan, at: number, line: number): number {
  scan.problems.push({ kind: "lineUnknown", line, text: excerpt(scan.src, at) });
  return nextLine(scan.src, at);
}

/** 一块卡的一行：「疑问 1a  2（备注）  3否决（原因）」。返回下一行开头的位置。 */
function readCards(scan: Scan, lineAt: number, at: number, block: LegacyCardBlock): number {
  if (scan.src.slice(at, lineEnd(scan.src, at)).trim() === "") {
    return unknownLine(scan, lineAt, lineOf(scan, lineAt));
  }
  return readCardItem(scan, at, block);
}

/** 读一项，同一行后面还有项的接着读。 */
function readCardItem(scan: Scan, at: number, block: LegacyCardBlock): number {
  const { src } = scan;
  const line = lineOf(scan, at);
  const head = matchAt(cardItemPattern, src, at);
  if (head === null) {
    scan.problems.push({ kind: "cardItemUnknown", line, block, text: excerpt(src, at) });
    return nextLine(src, at);
  }
  let end = at + head[0].length;
  let note: string | undefined;
  let noteAt = end;
  if (src[end] === "（") {
    const read = readNote(scan, end, "card");
    if (read === undefined) {
      scan.problems.push({ kind: "noteUnclosed", line, text: excerpt(src, at) });
      return nextLine(src, at);
    }
    ({ note, noteAt, end } = read);
  }
  addCard(scan, { line, block, n: Number(head[1]), value: head[2] ?? "", note, noteAt });
  const next = skipSpaces(src, end);
  if (next >= src.length) return src.length;
  if (src[next] === "\n") return next + 1;
  if (next > end && matchAt(cardItemPattern, src, next) !== null) {
    return readCardItem(scan, next, block);
  }
  const where = lineOf(scan, next);
  scan.problems.push({ kind: "cardItemUnknown", line: where, block, text: excerpt(src, next) });
  return nextLine(src, next);
}

type CardItem = {
  readonly line: number;
  readonly block: LegacyCardBlock;
  readonly n: number;
  /** 序号后面紧跟的：选项的 key、「同意」「否决」，或者空的。 */
  readonly value: string;
  readonly note: string | undefined;
  readonly noteAt: number;
};

function addCard(scan: Scan, item: CardItem): void {
  const { line, block, n, note, noteAt } = item;
  const cards = scan.page.cards[block];
  const card = cards[n - 1];
  if (cards.length === 0) {
    scan.problems.push({ kind: "blockEmpty", line, block, n });
    return;
  }
  if (card === undefined) {
    scan.problems.push({ kind: "cardNumber", line, block, n, count: cards.length });
    return;
  }
  const picked = pickOf(scan, item, card);
  if (picked === undefined) return;
  const key = `${block}:${n}`;
  const first = scan.seen.get(key);
  if (first !== undefined) {
    scan.problems.push({ kind: "cardDuplicate", line, block, n, first });
    return;
  }
  scan.seen.set(key, line);
  scan.found.push({
    textLine: line,
    section: card.section,
    ...(card.card === undefined ? {} : { card: card.card }),
    ...picked,
    ...(note === undefined ? {} : { note }),
    noteAt,
  });
}

/** 这一项是哪一种行，选了选项的带上选项。对不上时记下问题，返回 undefined。 */
function pickOf(
  scan: Scan,
  item: CardItem,
  card: LegacyReplyCard,
): { readonly kind: ReplyLineKind; readonly option?: string } | undefined {
  const { line, block, n, value, note } = item;
  if (value === "") {
    if (note !== undefined) return { kind: "noteOnly" };
    scan.problems.push({ kind: "itemEmpty", line, block, n });
    return undefined;
  }
  const word = onlyWords.get(value);
  if (word !== undefined) {
    if (card.only) return { kind: word };
    scan.problems.push({ kind: "onlyWord", line, block, n, word: value });
    return undefined;
  }
  if (card.options.length === 0) {
    scan.problems.push({ kind: "optionNone", line, block, n, option: value });
    return undefined;
  }
  if (!card.options.includes(value)) {
    scan.problems.push({
      kind: "optionUnknown",
      line,
      block,
      n,
      option: value,
      options: card.options,
    });
    return undefined;
  }
  // 只有一个方向的卡，点了那个方向就是同意
  return card.only ? { kind: "agree" } : { kind: "option", option: value };
}

/** 按名字回复的一行：「场景 修改：「看队列」（怎么改）  「看主线」」。返回下一行开头的位置。 */
function readNames(
  scan: Scan,
  lineAt: number,
  at: number,
  block: LegacyNameBlock,
  kind: ReplyLineKind,
): number {
  if (scan.src.slice(at, lineEnd(scan.src, at)).trim() === "") {
    return unknownLine(scan, lineAt, lineOf(scan, lineAt));
  }
  return readNameItem(scan, at, block, kind);
}

/** 读一项，同一行后面还有项的接着读。 */
function readNameItem(scan: Scan, at: number, block: LegacyNameBlock, kind: ReplyLineKind): number {
  const { src } = scan;
  const line = lineOf(scan, at);
  const close = src[at] === "「" ? nameEnd(scan, at + 1, block) : undefined;
  if (close === undefined) {
    scan.problems.push({ kind: "nameItemUnknown", line, block, text: excerpt(src, at) });
    return nextLine(src, at);
  }
  const name = src.slice(at + 1, close);
  let end = close + 1;
  let note: string | undefined;
  let noteAt = end;
  if (src[end] === "（") {
    const read = readNote(scan, end, "name");
    if (read === undefined) {
      scan.problems.push({ kind: "noteUnclosed", line, text: excerpt(src, at) });
      return nextLine(src, at);
    }
    ({ note, noteAt, end } = read);
  }
  addName(scan, { line, block, kind, name, note, noteAt });
  const next = skipSpaces(src, end);
  if (next >= src.length) return src.length;
  if (src[next] === "\n") return next + 1;
  if (next > end && src[next] === "「") return readNameItem(scan, next, block, kind);
  const where = lineOf(scan, next);
  scan.problems.push({ kind: "nameItemUnknown", line: where, block, text: excerpt(src, next) });
  return nextLine(src, next);
}

/**
 * 名字的右书名号。名字本身可以带书名号，例如看板上的「Q5 把「修复」改名成「落地」」。
 * 所以先找这一页上的名字，后面接得上的取最长的一个。都对不上时，取这一行里第一个接得上的右书名号。
 */
function nameEnd(scan: Scan, start: number, block: LegacyNameBlock): number | undefined {
  const { src } = scan;
  const ends = (at: number) => src[at] === "（" || endsItem(src, at, "name");
  let known: number | undefined;
  for (const item of scan.page.items[block]) {
    for (const name of item.names) {
      const close = start + name.length;
      if (src.startsWith(`${name}」`, start) && ends(close + 1) && (known ?? -1) < close) {
        known = close;
      }
    }
  }
  if (known !== undefined) return known;
  const stop = lineEnd(src, start);
  let first: number | undefined;
  for (let i = src.indexOf("」", start); i !== -1 && i < stop; i = src.indexOf("」", i + 1)) {
    if (ends(i + 1)) return i;
    first ??= i;
  }
  return first;
}

type NameItem = {
  readonly line: number;
  readonly block: LegacyNameBlock;
  readonly kind: ReplyLineKind;
  readonly name: string;
  readonly note: string | undefined;
  readonly noteAt: number;
};

function addName(scan: Scan, item: NameItem): void {
  const { line, block, kind, name, noteAt } = item;
  const items = scan.page.items[block];
  const found =
    items.find((entry) => entry.names.includes(name)) ??
    // 看板上的文字改过时，开头的编号还对得上
    (block === "queue"
      ? items.find((entry) => entry.id === queueIdPattern.exec(name)?.[0])
      : undefined);
  if (found === undefined) {
    if (block === "queue") scan.problems.push({ kind: "queueUnknown", line, text: name });
    else scan.problems.push({ kind: "nameUnknown", line, block, name });
    return;
  }
  const key = `${block}:${found.id}`;
  const first = scan.seen.get(key);
  if (first !== undefined) {
    scan.problems.push({ kind: "nameDuplicate", line, block, name, first });
    return;
  }
  scan.seen.set(key, line);
  const note = kind === "modify" && item.note === blankEdit ? undefined : item.note;
  scan.found.push({
    textLine: line,
    section: block,
    ...(block === "queue" ? {} : { card: found.id }),
    kind,
    ...(block === "queue" ? { queue: found.id } : {}),
    ...(note === undefined ? {} : { note }),
    noteAt,
  });
}

/** 「想法：」到文字的末尾都是想法，最后一行是「图：」时不算在里面。 */
function readIdea(scan: Scan, lineAt: number, at: number): number {
  const { src } = scan;
  const last = scan.starts.at(-1) ?? 0;
  const end = last > at && imageLinePattern.test(src.slice(last)) ? last : src.length;
  const raw = src.slice(at, end);
  const note = raw.trim();
  const line = lineOf(scan, lineAt);
  if (note === "") {
    scan.problems.push({ kind: "ideaEmpty", line });
    return end;
  }
  const noteAt = at + (raw.length - raw.trimStart().length);
  scan.found.push({ textLine: line, kind: "idea", note, noteAt });
  return end;
}

/** 「图：图 1=2e8f4d  图 2=92c9d4」：每张图的序号和标识。 */
function readImageLine(scan: Scan, at: number): number {
  const { src } = scan;
  const text = src.slice(at, lineEnd(src, at)).trim();
  const line = lineOf(scan, at);
  const pairs = [...text.matchAll(imageItemPattern)].map(
    (m) => [Number(m[1]), m[2] ?? ""] as const,
  );
  const numbers = pairs.map(([n]) => n);
  const repeated = numbers.some((n, i) => numbers.indexOf(n) !== i || scan.images.has(n));
  if (!imageLinePattern.test(text) || repeated) {
    scan.problems.push({ kind: "imageLine", line, text: excerpt(src, at) });
    return nextLine(src, at);
  }
  for (const [n, id] of pairs) scan.images.set(n, id);
  return nextLine(src, at);
}

/** 备注里的〔图 N〕对上最后一行写的标识。对不上的记下问题，行号是〔图 N〕所在的行。 */
function imagesOf(scan: Scan, found: Omit<Found, "noteAt">, noteAt: number): LegacyReplyImage[] {
  const images: LegacyReplyImage[] = [];
  for (const mark of (found.note ?? "").matchAll(imageMarkPattern)) {
    const n = Number(mark[1]);
    if (images.some((image) => image.n === n)) continue;
    const id = scan.images.get(n);
    if (id === undefined) {
      const line = lineOf(scan, noteAt + (mark.index ?? 0));
      if (!scan.problems.some((p) => p.kind === "imageUnknown" && p.n === n && p.line === line)) {
        scan.problems.push({ kind: "imageUnknown", line, n });
      }
      continue;
    }
    images.push({ n, id });
  }
  return images;
}
