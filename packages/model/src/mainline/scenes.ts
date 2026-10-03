import { parseSceneId } from "../ids.ts";
import { bulletItem, isBlank, isTableRow, numberedItem, type SourceLine } from "./lines.ts";
import { type MainlineProblem, sceneLabel } from "./problems.ts";

// 场景清单里的场景，见「09 skill 与软件」第三节和「03 数据模型」第二节。新的写法如下：
//
//   ### S14 会话中途接手
//   谁在什么时候用：AI，会话被压缩或换了一个会话时。
//   1. 敲 ploop → 看到当前第几版、哪个阶段、第几轮。
//
// 标题是场景编号加名字，编号可以不写，由命令补上。步骤是编号列表，每步用「→」分成做什么和该看到什么。
// 名字后面的括号是说明，不算名字，例如「### S5 验收更改（这一页不用点）」。
// 旧主线的场景没有编号，有两种写法，都认出来并报成旧写法：
// - 一行字开头：「场景「回答疑问」：」「场景 1（产品卖的就是这条）：名字」「场景一　名字（说明）」。
//   后面紧跟编号的步骤才算场景，场景到步骤后面第一行别的字为止。旧模板只在括号里写了场景是什么，
//   例如「场景 2（第一次进来、空项目）：」，括号里的字当作名字。
// - 三级标题以旧编号开头：「### 场景 1　名字（说明）」。

/** 场景的一步。 */
export type MainlineStep = {
  /** 步号，按这一步在场景里的先后从 1 数。写的编号和它对不上时，报 stepNumber。 */
  readonly step: number;
  /** 「→」前面的字，也就是做什么。没有「→」时是这一步的全部文字。 */
  readonly do: string;
  /** 「→」后面的字，也就是该看到什么。和使用代码的输出一样叫 expect。没有「→」时是空的。 */
  readonly expect: string;
  readonly line: number;
};

export type MainlineScene = {
  /** 标题里写的编号，例如 S14 写成 14。没写时没有这一项。 */
  readonly id?: number;
  readonly name: string;
  /** 名字后面括号里的说明。 */
  readonly note?: string;
  /** 「谁在什么时候用：」后面的字，原样取出。没写时没有这一项。 */
  readonly who?: string;
  readonly steps: readonly MainlineStep[];
  /** 标题所在的行。 */
  readonly line: number;
  /** 场景最后一行有字的行。 */
  readonly endLine: number;
  /** 旧写法的场景。 */
  readonly legacy: boolean;
};

/** 场景标题认出的几项。invalidId 是开头写错的编号，例如 S03。 */
export type SceneTitle = {
  readonly id?: number;
  readonly invalidId?: string;
  readonly name: string;
  readonly note?: string;
  readonly legacy: boolean;
};

/** 场景的开头在哪一行：heading 是三级标题，line 是旧写法开头的一行字。index 是行的下标。 */
type HeadAt = {
  readonly index: number;
  readonly form: "heading" | "line";
  readonly title: SceneTitle;
};

/** 找到的一个场景的开头，另带步骤的个数。 */
export type SceneHead = HeadAt & { readonly stepCount: number };

const arrow = "→";

/** 标题开头的编号：S 加数字，大小写都先认下来，再按 ids.ts 的写法查对不对。 */
const idToken = /^([Ss][0-9]+)(?![A-Za-z0-9_])[\s:：.、．-]*/u;

/** 旧写法：场景加书名号里的名字，后面的括号是说明。 */
const legacyQuoted = /^场景\s*「([^」]*)」(.*)$/u;

/** 旧写法：场景加编号，编号是数字或汉字的数字。 */
const legacyNumbered =
  /^场景\s*(?:[0-9]+|[一二三四五六七八九十]+)(?![0-9一二三四五六七八九十])(.*)$/u;

const whoPattern = /^\s{0,3}谁在什么时候用\s*[：:]\s*(.*)$/u;

/** 读出场景标题：编号、名字、说明，以及是不是旧写法。 */
export function parseSceneTitle(raw: string): SceneTitle {
  const text = raw.trim();
  const token = idToken.exec(text);
  if (token !== null) {
    const written = token[1] ?? "";
    const rest = splitNote(text.slice(token[0].length));
    const id = parseSceneId(written);
    return id.ok
      ? { id: id.value, ...rest, legacy: false }
      : { invalidId: written, ...rest, legacy: false };
  }
  return parseLegacyTitle(text) ?? { ...splitNote(text), legacy: false };
}

function parseLegacyTitle(text: string): SceneTitle | undefined {
  const quoted = legacyQuoted.exec(text);
  if (quoted !== null) {
    const { lead, tail } = splitLead(quoted[2] ?? "");
    return withNote((quoted[1] ?? "").trim(), lead ?? (tail === "" ? undefined : tail), true);
  }
  const numbered = legacyNumbered.exec(text);
  if (numbered === null) return undefined;
  const { lead, tail } = splitLead(numbered[1] ?? "");
  const own = splitNote(tail);
  // 旧模板只在括号里写了这个场景是什么，括号里的字就是名字
  if (own.name === "") return withNote(lead ?? "", own.note, true);
  return withNote(own.name, lead ?? own.note, true);
}

/** 旧写法编号后面的部分：开头的括号是说明，接着的冒号不要，剩下的是名字。 */
function splitLead(rest: string): { readonly lead?: string; readonly tail: string } {
  let tail = rest.trim();
  const paren = /^[（(]([^（）()]*)[）)]/u.exec(tail);
  const lead = paren === null ? undefined : (paren[1] ?? "").trim();
  if (paren !== null) tail = tail.slice(paren[0].length).trim();
  tail = tail.replace(/^[：:]/u, "").trim();
  return lead === undefined ? { tail } : { lead, tail };
}

/** 名字结尾的括号是说明。整个标题只有一对括号时，括号也算名字。结尾的冒号不要。 */
function splitNote(text: string): { readonly name: string; readonly note?: string } {
  const trimmed = text
    .trim()
    .replace(/[：:]$/u, "")
    .trim();
  const m = /^(.*?)\s*[（(]([^（）()]*)[）)]$/u.exec(trimmed);
  const name = (m?.[1] ?? "").trim();
  if (m === null || name === "") return { name: trimmed };
  return { name, note: (m[2] ?? "").trim() };
}

function withNote(name: string, note: string | undefined, legacy: boolean): SceneTitle {
  return note === undefined || note === "" ? { name, legacy } : { name, note, legacy };
}

/** 一行字是不是旧写法的场景开头。标题、列表项和表格都不是。粗体的星号不算字。 */
function legacyLineTitle(line: SourceLine): SceneTitle | undefined {
  const { text } = line;
  if (line.fenced || line.heading !== undefined || isTableRow(line)) return undefined;
  if (numberedItem.test(text) || bulletItem.test(text)) return undefined;
  return parseLegacyTitle(text.replaceAll("**", "").trim());
}

/** 从 start 往下，跳过空行和谁在什么时候用，第一行是不是编号的步骤。 */
function stepsFollow(lines: readonly SourceLine[], start: number, end: number): boolean {
  for (let i = start; i < end; i++) {
    const line = lines[i];
    if (line === undefined || line.heading !== undefined || line.fenced) return false;
    if (isBlank(line) || whoPattern.test(line.text)) continue;
    return numberedItem.test(line.text);
  }
  return false;
}

/** 解析过程中的一个场景。 */
type Draft = {
  readonly head: HeadAt;
  /** 第一行「谁在什么时候用：」冒号后面的字。 */
  who?: string;
  /** 每一步写的编号、文字和行的下标。 */
  readonly steps: { readonly written: number; readonly text: string; readonly index: number }[];
  /** 既不是步骤、也不是谁在什么时候用的行的下标。 */
  readonly extra: number[];
  /** 属于这个场景的最后一行有字的下标。 */
  last: number;
};

/**
 * 找出场景清单里的每个场景的标题。from 到 to（不含）是场景清单这一节标题下面的行。
 * 三级标题都算场景。旧写法的一行字，后面紧跟编号的步骤才算。
 */
export function findSceneHeads(
  lines: readonly SourceLine[],
  from: number,
  to: number,
): SceneHead[] {
  return collect(lines, from, to).map((draft) => ({
    ...draft.head,
    stepCount: draft.steps.length,
  }));
}

function collect(lines: readonly SourceLine[], from: number, to: number): Draft[] {
  const drafts: Draft[] = [];
  let current: Draft | undefined;
  const start = (head: HeadAt): Draft => {
    const draft: Draft = { head, steps: [], extra: [], last: head.index };
    drafts.push(draft);
    return draft;
  };
  for (let i = from; i < to; i++) {
    const line = lines[i];
    if (line === undefined) break;
    if (isBlank(line)) continue;
    // 旧写法的场景到步骤后面第一行别的字为止，四级标题也算别的字
    const isStep = !line.fenced && numberedItem.test(line.text);
    if (current?.head.form === "line" && current.steps.length > 0 && !isStep) current = undefined;
    // 场景清单这一节里只会遇到三级以下的标题，三级标题都算场景
    if (line.heading !== undefined && line.heading.level <= 3) {
      const title = parseSceneTitle(line.heading.text);
      current = start({ index: i, form: "heading", title });
      continue;
    }
    const legacy = legacyLineTitle(line);
    if (legacy !== undefined && stepsFollow(lines, i + 1, to)) {
      current = start({ index: i, form: "line", title: legacy });
      continue;
    }
    if (current !== undefined) classify(current, line, i);
  }
  return drafts;
}

/** 场景里的一行：步骤、谁在什么时候用，或者别的字。代码块和四级标题都是别的字。 */
function classify(draft: Draft, line: SourceLine, index: number): void {
  draft.last = index;
  const step = line.fenced ? null : numberedItem.exec(line.text);
  if (step !== null) {
    draft.steps.push({ written: Number(step[1]), text: (step[2] ?? "").trim(), index });
    return;
  }
  const who = line.fenced ? null : whoPattern.exec(line.text);
  if (who !== null && draft.who === undefined) {
    draft.who = (who[1] ?? "").trim();
    return;
  }
  draft.extra.push(index);
}

/**
 * 解析场景清单这一节。heading 是这一节标题的下标，to 是这一节结束的下标（不含）。
 * 返回认出的场景，和场景的全部问题。
 */
export function parseScenes(
  lines: readonly SourceLine[],
  heading: number,
  to: number,
): { readonly scenes: MainlineScene[]; readonly problems: MainlineProblem[] } {
  const drafts = collect(lines, heading + 1, to);
  const problems: MainlineProblem[] = [];
  const scenes = drafts.map((draft) => toScene(draft, lines, problems));
  if (drafts.length === 0) {
    problems.push({ kind: "scenesNone", line: lines[heading]?.n ?? heading + 1 });
  }
  const byId = new Map<number, number[]>();
  for (const scene of scenes) {
    if (scene.id === undefined) continue;
    byId.set(scene.id, [...(byId.get(scene.id) ?? []), scene.line]);
  }
  for (const [id, sceneLines] of byId) {
    const [first] = sceneLines;
    if (first !== undefined && sceneLines.length > 1) {
      problems.push({ kind: "sceneIdDuplicate", line: first, id, lines: sceneLines });
    }
  }
  return { scenes, problems };
}

function toScene(
  draft: Draft,
  lines: readonly SourceLine[],
  problems: MainlineProblem[],
): MainlineScene {
  const { title, index } = draft.head;
  const line = lines[index]?.n ?? index + 1;
  const scene = sceneLabel(title.id, title.name);
  if (title.legacy) problems.push({ kind: "sceneLegacy", line, scene });
  if (title.invalidId !== undefined) {
    problems.push({ kind: "sceneIdInvalid", line, text: title.invalidId });
  }
  if (title.name === "") problems.push({ kind: "sceneNameEmpty", line });
  const who = draft.who ?? "";
  if (!title.legacy && who === "") problems.push({ kind: "sceneWhoMissing", line, scene });
  if (draft.steps.length === 0) problems.push({ kind: "sceneNoSteps", line, scene });
  const [firstExtra] = draft.extra;
  if (firstExtra !== undefined) {
    problems.push({
      kind: "sceneExtraText",
      line: lines[firstExtra]?.n ?? firstExtra + 1,
      scene,
      count: draft.extra.length,
    });
  }
  const steps = draft.steps.map((written, i): MainlineStep => {
    const step = i + 1;
    const stepLine = lines[written.index]?.n ?? written.index + 1;
    const where = { line: stepLine, scene, step };
    if (written.written !== step) {
      problems.push({ kind: "stepNumber", ...where, written: written.written });
    }
    const arrows = written.text.split(arrow).length - 1;
    if (arrows === 0) {
      problems.push({ kind: "stepArrowMissing", ...where });
      return { step, do: written.text, expect: "", line: stepLine };
    }
    if (arrows > 1) problems.push({ kind: "stepArrowExtra", ...where, count: arrows });
    const at = written.text.indexOf(arrow);
    const doText = written.text.slice(0, at).trim();
    const expect = written.text.slice(at + arrow.length).trim();
    if (doText === "") problems.push({ kind: "stepDoEmpty", ...where });
    if (expect === "") problems.push({ kind: "stepExpectEmpty", ...where });
    return { step, do: doText, expect, line: stepLine };
  });
  const endLine = lines[draft.last]?.n ?? line;
  return {
    ...(title.id === undefined ? {} : { id: title.id }),
    name: title.name,
    ...(title.note === undefined ? {} : { note: title.note }),
    ...(who === "" ? {} : { who }),
    steps,
    line,
    endLine,
    legacy: title.legacy,
  };
}
