// 一个阶段的页面：由填好的一页算出有哪几屏、左边一栏怎么分组、还剩几条没点、提交时交哪几行。
// 见「06 工作台」第四节。这里只有纯函数，组件和测试都用它。
//
// 草稿按输入框记，名字由工作台定（model 的 draft.ts）：
// - 有编号的一项写「区块/编号」，例如 asks/ask-kanban。选项、表态、备注都记在这一项上。
// - 队列里要取消的一件写「queue/Q12」。
// - 这个阶段开始时取消的事，备注写 droppedAtStart。
// - 想法框写 ideas。
import {
  type DraftEntries,
  type DraftEntry,
  type LabelOf,
  landStepState,
  pagePurpose,
  type replyLineKind,
  replySection,
  type StageLabel,
} from "@product-loop/model";

/** 页面数据里 AI 写的区块。只写这里用到的字段，数据来自接口，枚举是中文。 */
type Option = { readonly key: string; readonly title: string };
type CardLike = {
  readonly id: string;
  readonly title: string;
  readonly options?: readonly Option[] | undefined;
  readonly only?: true | undefined;
};
type Named = { readonly id: string; readonly name: string };

export type PageSections = {
  readonly align?: readonly Named[] | undefined;
  readonly scenes?: readonly Named[] | undefined;
  readonly spec?: readonly Named[] | undefined;
  readonly asks?: readonly CardLike[] | undefined;
  readonly findings?: readonly CardLike[] | undefined;
  readonly improvements?: readonly CardLike[] | undefined;
  readonly changes?: readonly { readonly id: string; readonly title: string }[] | undefined;
  readonly refs?: readonly unknown[] | undefined;
};

/** 工程证据里判断有没有内容要看的几样，字段和后端的落地状态相同。 */
export type LandShape = {
  readonly tidy: { readonly state: string };
  readonly changes: readonly unknown[];
  readonly review: {
    readonly opinions?: readonly unknown[] | null | undefined;
    readonly reason?: string | null | undefined;
  };
  readonly plan?: { readonly verdicts: readonly unknown[] } | null | undefined;
};

/** 算屏要看的页面：区块和后端填的几样。 */
export type PageShape = {
  readonly sections: PageSections;
  readonly fill: {
    /** 迁移进来的历史页的阶段带旧编号，给出时的样子没有记录，见 hasQueueRecord。 */
    readonly header: { readonly legacyId: string | null };
    readonly previousReplies: { readonly lines: readonly unknown[] } | null;
    readonly droppedAtStart: readonly unknown[];
    readonly use: unknown;
    readonly landEvidence: LandShape | null;
    readonly queue: {
      readonly waiting: readonly unknown[];
      readonly columns: readonly { readonly items: readonly unknown[] }[];
    };
  };
};

/**
 * 这一页有没有给出那一刻的队列。工作台自己给出的页，队列在给出时存下，之后不变，就是当时的队列。
 * 迁移进来的历史页，队列是迁移那天的，不是当时的，队列的变化也没有留下记录，所以没有这一屏。
 */
function hasQueueRecord(page: Pick<PageShape, "fill">): boolean {
  return page.fill.header.legacyId === null;
}

/**
 * 工程证据里有没有什么可看的。重构没记、没有改动、没有评审、没有裁决时是空的，
 * 迁移进来的历史页就是这样，整屏不出现，不写「还没记」再摆一张只有表头的空表。
 */
function landHasContent(land: LandShape): boolean {
  return (
    land.tidy.state !== landStepState.label("missing") ||
    land.changes.length > 0 ||
    (land.review.opinions ?? []).length > 0 ||
    (land.review.reason ?? "") !== "" ||
    (land.plan?.verdicts ?? []).length > 0
  );
}

export type CardSection = "asks" | "findings" | "improvements";
type ItemSection = "align" | "scenes" | "spec";

/** 一屏。卡片和更改一张一屏，场景、规范、先对齐、参考这类整个区块一屏。 */
export type Screen =
  | {
      readonly id: string;
      readonly kind: "previous" | "dropped" | "use" | "land" | "refs" | "queue";
    }
  | { readonly id: string; readonly kind: ItemSection }
  | {
      readonly id: string;
      readonly kind: "card";
      readonly section: CardSection;
      readonly index: number;
    }
  | { readonly id: string; readonly kind: "change"; readonly index: number };

/** 左边一栏的一行。点了到 screen 那一屏，item 是屏里的哪一项。 */
export type Entry = {
  readonly screen: string;
  readonly item?: string;
  readonly label: string;
  /** 草稿里对应的输入框。 */
  readonly field?: string;
  /** 这一行要点：卡片有选项，场景、规范、先对齐的一项，或者一条更改要认可还是不认可。 */
  readonly needsPick: boolean;
  /** 卡片的选项：键到标题，左边一栏写选了哪个选项的标题，不写字母。 */
  readonly options?: Readonly<Record<string, string>>;
};

export type Group = {
  readonly key: string;
  readonly label: string;
  readonly entries: readonly Entry[];
};

export const sectionLabels = {
  align: "先对齐",
  scenes: "场景清单",
  spec: "设计规范",
  asks: "疑问",
  findings: "发现问题",
  improvements: "提升",
  changes: "更改",
} as const;

type QueueItemLike = { readonly id: string; readonly content: string };

/**
 * 队列里各件事的内容，按编号找。页面上写内容不写编号。
 * 找不到的编号（不在这一页的队列里）不在表里。
 */
export function queueContentsOf(queue: {
  readonly waiting: readonly QueueItemLike[];
  readonly columns: readonly { readonly items: readonly QueueItemLike[] }[];
  readonly doneThisRound?: readonly QueueItemLike[];
}): Map<string, string> {
  const items = [
    ...queue.waiting,
    ...queue.columns.flatMap((column) => column.items),
    ...(queue.doneThisRound ?? []),
  ];
  return new Map(items.map((item) => [item.id, item.content]));
}

/** 卡片对应的队列事项，写内容。编号不是用户的词，找不到内容的不写，全都找不到时是空的。 */
export function queueTitles(ids: readonly string[], contents: ReadonlyMap<string, string>): string {
  return ids.flatMap((id) => contents.get(id) ?? []).join("、");
}

/** 一张卡或一项的标题，和它的选项的标题。 */
export type CardTitle = {
  readonly title: string;
  readonly options: Readonly<Record<string, string>>;
};

/**
 * 页面上每一张卡、每一项的标题，按编号找。回复的一行只记了卡的编号和选项的字母，
 * 显示时换成标题，用户不用去对编号。
 */
export function cardTitlesOf(sections: PageSections | undefined): Map<string, CardTitle> {
  const titles = new Map<string, CardTitle>();
  if (sections === undefined) return titles;
  for (const section of ["align", "scenes", "spec"] as const) {
    for (const item of sections[section] ?? [])
      titles.set(item.id, { title: item.name, options: {} });
  }
  for (const section of cardSections) {
    for (const card of sections[section] ?? []) {
      const options = Object.fromEntries((card.options ?? []).map((o) => [o.key, o.title]));
      titles.set(card.id, { title: card.title, options });
    }
  }
  for (const change of sections.changes ?? []) {
    titles.set(change.id, { title: change.title, options: {} });
  }
  return titles;
}

/** 回复的一行，只写显示要用的几样。 */
type ReplyLineLike = {
  readonly section?: string | undefined;
  readonly kind: string;
  readonly option?: string | undefined;
  readonly note?: string | undefined;
};

/** 回复里一行的「回复」怎么写：选项写标题，不写「选了选项」这个模板字；认可、不认可、取消写短词。 */
function replyText(line: ReplyLineLike, optionTitle: string | undefined): string {
  switch (line.kind) {
    case "选了选项":
      return optionTitle === undefined ? `选 ${line.option ?? ""}`.trim() : `选「${optionTitle}」`;
    case "认可一条更改":
      return "认可";
    case "不认可一条更改":
      return "不认可";
    case "取消队列事项":
      return "取消";
    default:
      return line.kind;
  }
}

/**
 * 回复的一行写成几个字段，每个字段一个名字加一个值，不拼成一串：
 * 哪个区块里的哪一项（疑问、发现问题、队列……），回复了什么，备注。想法只有一个字段。
 * target 是那一项的名字：卡的标题，或者队列事项的内容。
 */
export function lineFields(
  line: ReplyLineLike,
  target: { readonly title?: string | undefined; readonly optionTitle?: string | undefined },
): (readonly [string, string])[] {
  const note = line.note?.trim() ?? "";
  if (line.kind === "想法") return [["想法", note]];
  return [
    ...(line.section === undefined ? [] : [[line.section, target.title ?? ""] as const]),
    ["回复", replyText(line, target.optionTitle)] as const,
    ...(note === "" ? [] : [["备注", note] as const]),
  ];
}

/** 草稿里一项的名字。 */
export function fieldOf(section: keyof typeof sectionLabels, id: string): string {
  return `${section}/${id}`;
}

export const ideasField = "ideas";
export const droppedField = "droppedAtStart";

export function queueField(id: string): string {
  return `queue/${id}`;
}

const cardSections: readonly CardSection[] = ["asks", "findings", "improvements"];

/** 屏的顺序，和「06 工作台」第四节区块的顺序相同。没有数据的区块不出现。 */
export function screensOf(page: PageShape): Screen[] {
  const { sections, fill } = page;
  const screens: Screen[] = [];
  if (fill.previousReplies !== null && fill.previousReplies.lines.length > 0) {
    screens.push({ id: "previous", kind: "previous" });
  }
  if (fill.droppedAtStart.length > 0) screens.push({ id: "dropped", kind: "dropped" });
  if (fill.use !== null) screens.push({ id: "use", kind: "use" });
  for (const section of ["align", "scenes", "spec"] as const) {
    if ((sections[section] ?? []).length > 0) screens.push({ id: section, kind: section });
  }
  for (const section of cardSections) {
    (sections[section] ?? []).forEach((card, index) => {
      screens.push({ id: card.id, kind: "card", section, index });
    });
  }
  (sections.changes ?? []).forEach((change, index) => {
    screens.push({ id: change.id, kind: "change", index });
  });
  if (fill.landEvidence !== null && landHasContent(fill.landEvidence)) {
    screens.push({ id: "land", kind: "land" });
  }
  if ((sections.refs ?? []).length > 0) screens.push({ id: "refs", kind: "refs" });
  if (hasQueueRecord(page)) screens.push({ id: "queue", kind: "queue" });
  return screens;
}

/**
 * 左边一栏的分组，和屏的顺序相同。
 * pickable 写 false 时（只看的页）没有哪一条要点，左边不出未点的圆点，也不算还剩几条。
 */
export function groupsOf(page: PageShape, pickable = true): Group[] {
  const groups = groupsWithPicks(page);
  if (pickable) return groups;
  return groups.map((group) => ({
    ...group,
    entries: group.entries.map((entry) => ({ ...entry, needsPick: false })),
  }));
}

function groupsWithPicks(page: PageShape): Group[] {
  const { sections, fill } = page;
  const groups: Group[] = [];
  // 只有一个区块的分组：块的名字就是那一行，名字下面不再写说明。
  const single = (key: string, label: string) =>
    groups.push({ key, label, entries: [{ screen: key, label, needsPick: false }] });
  if (fill.previousReplies !== null && fill.previousReplies.lines.length > 0) {
    single("previous", "回复去处");
  }
  if (fill.droppedAtStart.length > 0) single("dropped", "取消的事");
  if (fill.use !== null) single("use", "使用");
  for (const section of ["align", "scenes", "spec"] as const) {
    const items = sections[section] ?? [];
    if (items.length === 0) continue;
    groups.push({
      key: section,
      label: sectionLabels[section],
      entries: items.map((item) => ({
        screen: section,
        item: item.id,
        label: item.name,
        field: fieldOf(section, item.id),
        needsPick: true,
      })),
    });
  }
  for (const section of cardSections) {
    const cards = sections[section] ?? [];
    if (cards.length === 0) continue;
    groups.push({
      key: section,
      label: sectionLabels[section],
      entries: cards.map((card) => ({
        screen: card.id,
        label: card.title,
        field: fieldOf(section, card.id),
        needsPick: (card.options ?? []).length > 0,
        options: Object.fromEntries(
          (card.options ?? []).map((option) => [option.key, option.title]),
        ),
      })),
    });
  }
  const changes = sections.changes ?? [];
  if (changes.length > 0) {
    groups.push({
      key: "changes",
      label: sectionLabels.changes,
      entries: changes.map((change) => ({
        screen: change.id,
        label: change.title,
        field: fieldOf("changes", change.id),
        needsPick: true,
      })),
    });
  }
  if (fill.landEvidence !== null && landHasContent(fill.landEvidence)) single("land", "工程证据");
  if ((sections.refs ?? []).length > 0) single("refs", "参考");
  if (hasQueueRecord(page)) single("queue", "队列");
  return groups;
}

/** 左边一行是不是已经打勾。 */
export function entryDone(entry: Entry, entries: DraftEntries): boolean {
  if (entry.field === undefined) return false;
  const saved = entries[entry.field];
  if (saved === undefined) return false;
  if (entry.needsPick) return saved.pick !== undefined;
  return (saved.note ?? "").trim() !== "";
}

/** 左边一栏里这一行选了什么：选项写选了哪个选项的标题，保留、修改、认可这类照写。没点的为空。 */
export function pickLabel(entry: Entry, entries: DraftEntries): string | undefined {
  if (entry.field === undefined || !entry.needsPick) return undefined;
  const pick = entries[entry.field]?.pick;
  if (pick === undefined) return undefined;
  if (!/^[a-z]$/u.test(pick)) return pick;
  const title = entry.options?.[pick];
  return title === undefined ? `选了 ${pick}` : `选了「${title}」`;
}

/**
 * 一页现在能做什么。只有 open 能点选、写备注和提交，别的都只能看。
 * view 是只给用户看的页（使用阶段给出的页，决定 204）：不等回复，没有想法框和提交，也没有要点的条。
 */
export type PageState =
  | "open"
  | "view"
  | "waiting"
  | "received"
  | "replied"
  | "closed"
  | "withdrawn";

/**
 * 一页现在的状态，按页面自己的状态、有没有提交的记录、所在的阶段收没收尾来定，不看存在页面里的旧文字。
 * 迁移进来的历史页状态是已回复，却没有提交的记录，也算已回复。
 * 只看的页在阶段还没收尾时是 view；阶段收尾了，和别的页一样写「阶段已收尾」（场景 S2 第 5 步）。
 */
export function pageStateOf(
  page: {
    readonly status: string;
    readonly purpose: string;
    readonly submission: { readonly takenAt: string | null } | null;
  },
  roundStatus: string,
): PageState {
  if (page.status === "已撤回") return "withdrawn";
  if (page.submission !== null) return page.submission.takenAt === null ? "waiting" : "received";
  if (page.status === "已回复") return "replied";
  if (roundStatus === "已收尾") return "closed";
  if (page.purpose === pagePurpose.label("view")) return "view";
  return "open";
}

/** 还没点的几行，按页面上的顺序。 */
export function pendingOf(groups: readonly Group[], entries: DraftEntries): Entry[] {
  return groups.flatMap((group) =>
    group.entries.filter((entry) => entry.needsPick && !entryDone(entry, entries)),
  );
}

/** 打开页面先到哪一屏：地址里写了的，否则第一条没点的，都点完了到第一屏。 */
export function initialScreen(
  screens: readonly Screen[],
  groups: readonly Group[],
  entries: DraftEntries,
  wanted: string | undefined,
): { screen: string; item?: string } {
  if (wanted !== undefined) {
    const direct = screens.find((screen) => screen.id === wanted);
    if (direct !== undefined) return { screen: direct.id };
    const entry = groups.flatMap((group) => group.entries).find((e) => e.item === wanted);
    if (entry !== undefined) return { screen: entry.screen, item: wanted };
  }
  const first = pendingOf(groups, entries)[0];
  if (first !== undefined) {
    return first.item === undefined
      ? { screen: first.screen }
      : { screen: first.screen, item: first.item };
  }
  return { screen: screens[0]?.id ?? "" };
}

/**
 * 左边一栏里哪一行是当前的。换到一屏时地址里没有写屏里的哪一项（先对齐、场景清单、设计规范一屏有多条），
 * 当前的是这一屏的第一条：换屏以后左边一栏总有一行是蓝的，看得出在哪。点的是屏里的某一项时，就是那一项。
 */
export function isCurrentEntry(
  groups: readonly Group[],
  current: { readonly screen: string; readonly item?: string },
  entry: Entry,
): boolean {
  if (entry.screen !== current.screen) return false;
  const item =
    current.item ??
    groups.flatMap((group) => group.entries).find((other) => other.screen === current.screen)?.item;
  return entry.item === undefined || entry.item === item;
}

/**
 * 要写原因或内容还没写的几项：修改场景或设计规范、不认可一条更改、取消队列里的一件。
 * 没写完不能提交，见场景 S5、S7、S9。按页面上的顺序，每项一句话。
 */
export function missingReasons(
  sections: PageSections,
  entries: DraftEntries,
  queueContents?: ReadonlyMap<string, string>,
): string[] {
  const missing: string[] = [];
  for (const section of ["scenes", "spec"] as const) {
    for (const item of sections[section] ?? []) {
      const entry = entries[fieldOf(section, item.id)];
      if (entry?.pick === "修改" && !hasNote(entry)) missing.push(`修改「${item.name}」要写内容`);
    }
  }
  for (const change of sections.changes ?? []) {
    const entry = entries[fieldOf("changes", change.id)];
    if (entry?.pick === "不认可" && !hasNote(entry))
      missing.push(`不认可「${change.title}」要写原因`);
  }
  for (const [field, entry] of Object.entries(entries)) {
    if (field.startsWith("queue/") && entry.pick === "取消" && !hasNote(entry)) {
      const id = field.slice("queue/".length);
      missing.push(`取消「${queueContents?.get(id) ?? "这一项"}」要写原因`);
    }
  }
  return missing;
}

/** 交给后端的一行，和 POST /pages/:id/submission 的 lines 相同，枚举写中文。 */
export type LineInput = {
  section?: LabelOf<typeof replySection>;
  card?: string;
  kind: LabelOf<typeof replyLineKind>;
  option?: string;
  note?: string;
  queue?: string;
  images?: string[];
};

/** 回复里各行写的区块名，取自 model，和命令行里看到的一致。 */
const sectionWire = replySection.table;

function withNote(line: LineInput, entry: DraftEntry): LineInput {
  const note = (entry.note ?? "").trim();
  const images = entry.images ?? [];
  return {
    ...line,
    ...(note === "" ? {} : { note }),
    ...(images.length === 0 ? {} : { images: [...images] }),
  };
}

/** 写了备注。贴图时文字里会留下「〔图 1〕」，所以只看文字。 */
function hasNote(entry: DraftEntry): boolean {
  return (entry.note ?? "").trim() !== "";
}

/**
 * 按草稿写出回复的各行，顺序和页面相同。没点也没写的项不出行。
 * 只有一个方向的卡，点了那个方向是「同意」，点了否决是「否决」。
 */
export function replyLines(sections: PageSections, entries: DraftEntries): LineInput[] {
  const lines: LineInput[] = [];
  for (const section of ["align", "scenes", "spec"] as const) {
    for (const item of sections[section] ?? []) {
      const entry = entries[fieldOf(section, item.id)];
      if (entry === undefined) continue;
      const base = { section: sectionWire[section], card: item.id };
      if (entry.pick !== undefined)
        lines.push(withNote({ ...base, kind: entry.pick as LineInput["kind"] }, entry));
      else if (hasNote(entry)) lines.push(withNote({ ...base, kind: "只写了备注" }, entry));
    }
  }
  for (const section of cardSections) {
    for (const card of sections[section] ?? []) {
      const entry = entries[fieldOf(section, card.id)];
      if (entry === undefined) continue;
      const base = { section: sectionWire[section], card: card.id };
      if (entry.pick === "否决") lines.push(withNote({ ...base, kind: "否决" }, entry));
      else if (entry.pick !== undefined && card.only) {
        lines.push(withNote({ ...base, kind: "同意" }, entry));
      } else if (entry.pick !== undefined) {
        lines.push(withNote({ ...base, kind: "选了选项", option: entry.pick }, entry));
      } else if (hasNote(entry)) lines.push(withNote({ ...base, kind: "只写了备注" }, entry));
    }
  }
  for (const change of sections.changes ?? []) {
    const entry = entries[fieldOf("changes", change.id)];
    if (entry === undefined) continue;
    const base = { section: sectionWire.changes, card: change.id };
    // 认可不带备注：从不认可改回认可时，为什么不认可的那句话不跟着交出去。
    if (entry.pick === "认可") lines.push({ ...base, kind: "认可一条更改" });
    else if (entry.pick === "不认可") {
      lines.push(withNote({ ...base, kind: "不认可一条更改" }, entry));
    } else if (hasNote(entry)) lines.push(withNote({ ...base, kind: "只写了备注" }, entry));
  }
  for (const [field, entry] of Object.entries(entries)) {
    if (!field.startsWith("queue/") || entry.pick !== "取消") continue;
    const queue = field.slice("queue/".length);
    lines.push(withNote({ section: sectionWire.queue, kind: "取消队列事项", queue }, entry));
  }
  const dropped = entries[droppedField];
  if (dropped !== undefined && hasNote(dropped)) {
    lines.push(withNote({ section: sectionWire.droppedAtStart, kind: "只写了备注" }, dropped));
  }
  const ideas = entries[ideasField];
  if (ideas !== undefined && hasNote(ideas)) lines.push(withNote({ kind: "想法" }, ideas));
  return lines;
}

/** 阶段条里的一个阶段：这一版在这个阶段做了几次，队列里还有几件。 */
export type StripColumn = {
  readonly stage: StageLabel;
  readonly rounds: readonly { readonly label: string; readonly status: string }[];
  readonly queue: number;
};

/**
 * 阶段条按现在的数据算：这一版每次阶段现在的状态，队列里每个阶段现在的件数。
 * 给出这一页时存下的一份不会再变，读不到现在的数据时才用它。
 */
export function stripColumns(
  saved: readonly StripColumn[],
  live: {
    readonly versions:
      | readonly {
          readonly version: number;
          readonly rounds: readonly {
            readonly label: string;
            readonly stage: string;
            readonly status: string;
          }[];
        }[]
      | undefined;
    readonly queue: readonly { readonly stage: string; readonly count: number }[] | undefined;
  },
  version: number,
): StripColumn[] {
  const rounds = live.versions?.find((item) => item.version === version)?.rounds;
  return saved.map((column) => ({
    stage: column.stage,
    rounds:
      rounds === undefined
        ? column.rounds
        : rounds
            .filter((round) => round.stage === column.stage)
            .map(({ label, status }) => ({ label, status })),
    queue:
      live.queue === undefined
        ? column.queue
        : (live.queue.find((item) => item.stage === column.stage)?.count ?? 0),
  }));
}
