import { renderCopy } from "../copy/define.ts";
import { legacyPageCopy } from "../copy/legacy-convert.ts";
import {
  type At,
  addNote,
  addProblem,
  type ConvertState,
  child,
  convertFields,
  convertValue,
  type FieldHook,
  isEmpty,
  isRecord,
  type JsonObject,
  sceneIdByName,
  sceneIdByNumber,
} from "./convert-fields.ts";

// 卡片一级的转换：疑问、发现问题、提升三种卡，以及挪进疑问的卡。
// 下面几处要看同一张卡上的别的字段才知道怎么转，不能只按对照表逐个字段转。
// - 卡片的 saw：没有来源时转成一条来源，有来源时删掉。
// - 选项的 see：卡上没有 rows、选项都没有 diffs 时，转成「结果」一行的差别。别的情况删掉。
// - 位置：按场景名查场景编号，名字不在时按旧主线的序号查。
// - 来源的旧写法：label 换成 name，excerpt 换成 saw，kind 删掉。
// - 证据：写成一个对象的放进数组，excerpt 证据删掉。
// - 看法写成一句话的，按旧模板的读法拆成 pick 和 because。
// 这几种写法的旧页面上长什么样，见 v1-final 的 templates/report/10-app.js。

const { value: valueCopy } = legacyPageCopy;

/** 卡上有没有写这个字段。空的值会被删掉，算没写。 */
function has(card: Readonly<JsonObject>, key: string): boolean {
  return Object.hasOwn(card, key) && !isEmpty(card[key]);
}

/**
 * 选项的 see 能不能转成差别：卡上没有 rows，选项都没有 diffs，至少一个选项的 see 有字。
 * 旧模板在对照表的「结果」一行显示 see，所以转成只有这一行的对照表。
 */
function seeBecomesDiffs(card: Readonly<JsonObject>): boolean {
  const { options } = card;
  if (has(card, "rows") || !Array.isArray(options)) return false;
  const records = options.filter(isRecord);
  return (
    !records.some((option) => has(option, "diffs")) &&
    records.some((option) => typeof option.see === "string" && !isEmpty(option.see))
  );
}

/** 一张卡挪进疑问时的标签，以及备注用哪一条改法。 */
export type MoveToAsk = { readonly tag: string; readonly change: "rethinkAsk" | "sectionAsk" };

/**
 * 转换一张卡。写了 move 时，这张卡挪进疑问，按疑问卡转换，标签换成 move.tag，原来的标签写进备注。
 * 回到构思的卡标「回到构思」（第一期约定第 8 条）；这一阶段不能写的发现问题和提升，标原来区块的名字（决定 189）。
 */
export function convertCard(value: unknown, at: At, s: ConvertState, move?: MoveToAsk): unknown {
  if (!isRecord(value)) return convertValue(value, at, s);
  const hasSources = has(value, "sources");
  const seeToDiffs = seeBecomesDiffs(value);
  const hooks: Record<string, FieldHook> = {
    saw: (saw, here, out) => {
      if (hasSources || typeof saw !== "string") {
        addNote(s, here.old, "cardSaw", saw);
        return;
      }
      const source = { name: renderCopy(valueCopy.sawName), saw };
      out.sources = [source];
      addNote(s, here.old, "sawSource", saw, [...at.now, "sources", 0]);
    },
    sources: (sources, here, out) => {
      out.sources = Array.isArray(sources)
        ? sources.map((source, i) => convertSource(source, child(here, i), s))
        : convertValue(sources, here, s);
    },
    options: (options, here, out) => {
      if (seeToDiffs) out.rows = [renderCopy(valueCopy.seeRow)];
      out.options = Array.isArray(options)
        ? options.map((option, i) => convertOption(option, child(here, i), s, seeToDiffs))
        : convertValue(options, here, s);
    },
    stance: (stance, here, out) => {
      if (typeof stance !== "string") {
        out.stance = convertValue(stance, here, s);
        return;
      }
      out.stance = parseStance(stance);
      addNote(s, here.old, "stanceText", stance, here.now);
    },
    evidence: (evidence, here, out) => convertEvidence(evidence, here, out, s),
    where: (where, here, out) => {
      out.where = convertWhere(where, here, s);
    },
  };
  if (move !== undefined) {
    hooks.tag = (old, here, out) => {
      out.tag = move.tag;
      if (old !== move.tag) addNote(s, here.old, move.change, old);
    };
  }
  const out = convertFields(value, at, s, hooks);
  return move !== undefined && out.tag === undefined ? withTag(out, move.tag) : out;
}

/** 标签放在标题后面。没有标题时放在最前面。 */
function withTag(card: JsonObject, tag: string): JsonObject {
  const entries = Object.entries(card);
  const at = entries.findIndex(([key]) => key === "title") + 1;
  return Object.fromEntries([...entries.slice(0, at), ["tag", tag], ...entries.slice(at)]);
}

// ---- 位置：旧格式写场景名和序号，新格式只写场景编号和步号，见「07 校验」第二节

/**
 * 位置的场景编号：有场景名按场景名查，没有场景名按旧主线的序号查。
 * 已经写了 scene 的不查。查不到的报成问题，报在新页面数据的 where.scene 上。
 */
function sceneOf(
  where: Readonly<JsonObject>,
  at: At,
  s: ConvertState,
): { readonly id?: string; readonly from?: "title" | "scenario" } {
  if (Object.hasOwn(where, "scene")) return {};
  const scenePath = [...at.now, "scene"];
  const { title, scenario } = where;
  if (typeof title === "string" && !isEmpty(title)) {
    const id = sceneIdByName(title, s);
    if (id !== undefined) return { id, from: "title" };
    const { sceneName } = legacyPageCopy.where;
    addProblem(s, scenePath, "legacyPage.where.sceneName", sceneName, { name: title.trim() });
    return {};
  }
  if (typeof scenario === "number") {
    const id = sceneIdByNumber(scenario, s);
    if (id !== undefined) return { id, from: "scenario" };
    const { sceneNumber } = legacyPageCopy.where;
    addProblem(s, scenePath, "legacyPage.where.sceneNumber", sceneNumber, { number: scenario });
  }
  return {};
}

/** 转换位置。场景编号放在最前面，场景名、这一步的文字、总数和步数删掉，写进备注。 */
function convertWhere(value: unknown, at: At, s: ConvertState): unknown {
  if (!isRecord(value)) return convertValue(value, at, s);
  const { id, from } = sceneOf(value, at, s);
  const scenePath = [...at.now, "scene"];
  const fields = convertFields(value, at, s, {
    title: (title, here) => {
      addNote(s, here.old, "whereText", title, from === "title" ? scenePath : undefined);
    },
    scenario: (scenario, here) => {
      addNote(s, here.old, "whereScene", scenario, from === "scenario" ? scenePath : undefined);
    },
  });
  return id === undefined ? fields : { scene: id, ...fields };
}

// ---- 来源：旧格式第三版写 label、kind、src、excerpt，见旧格式 README 的卡片字段表

function convertSource(value: unknown, at: At, s: ConvertState): unknown {
  if (!isRecord(value)) return convertValue(value, at, s);
  /** label 换成 name，excerpt 换成 saw。新的名字已经写了的，旧的删掉。 */
  const rename =
    (name: string): FieldHook =>
    (old, here, out) => {
      if (has(value, name)) addNote(s, here.old, "sourceOldForm", old);
      else out[name] = convertValue(old, { old: here.old, now: [...at.now, name] }, s);
    };
  return convertFields(value, at, s, { label: rename("name"), excerpt: rename("saw") });
}

// ---- 选项：see 转成差别或删掉

function convertOption(value: unknown, at: At, s: ConvertState, seeToDiffs: boolean): unknown {
  if (!isRecord(value)) return convertValue(value, at, s);
  return convertFields(value, at, s, {
    see: (see, here, out) => {
      if (seeToDiffs && typeof see === "string") {
        out.diffs = [see];
        addNote(s, here.old, "seeDiffs", see, [...at.now, "diffs", 0]);
      } else {
        addNote(s, here.old, "optionSee", see);
      }
    },
  });
}

// ---- 证据：只写成数组，excerpt 证据删掉

/**
 * 写成一个对象的证据放进数组（对照表的 evidenceArray）。excerpt 证据删掉，写进备注。
 * 删完一项都不剩时，evidence 整个不写。
 */
function convertEvidence(value: unknown, at: At, out: JsonObject, s: ConvertState): void {
  const wrapped = isRecord(value);
  const items: unknown = wrapped ? [value] : value;
  if (!Array.isArray(items)) {
    out.evidence = convertValue(value, at, s);
    return;
  }
  const kept: unknown[] = [];
  items.forEach((item, i) => {
    const old = wrapped ? at.old : [...at.old, i];
    if (isRecord(item) && item.type === "excerpt") {
      addNote(s, old, "excerptEvidence", item);
      return;
    }
    kept.push(convertValue(item, { old, now: [...at.now, kept.length] }, s));
  });
  if (kept.length > 0) out.evidence = kept;
}

// ---- 看法：旧模板把一句话的看法拆成两行显示，这里照它拆

/** 「我的看法是 a」「我站 a」「站 a」开头，后面跟句号、逗号、空白或者什么都没有。 */
const stancePattern = /^(?:我的看法是|我站|站)\s*([a-z])(?:。|,|，|\s|$)/iu;

/**
 * 按旧模板的读法拆一句话的看法：开头认出选的是哪一个，剩下的是因为，去掉开头的「因为」。
 * 认不出选的是哪一个时只有 because，拆完没有剩下字时只有 pick，缺的由新的定义报出来。
 */
function parseStance(text: string): JsonObject {
  const match = stancePattern.exec(text);
  const pick = match?.[1];
  const rest = match === null ? text : text.slice(match[0].length).replace(/^[。，,\s]+/u, "");
  const because = rest.replace(/^因为[，,：:\s]*/u, "");
  return {
    ...(pick === undefined ? {} : { pick }),
    ...(isEmpty(because) ? {} : { because }),
  };
}

// ---- 场景清单：场景名查得到编号的，补上场景编号

/** 转换场景清单里的一个场景。步骤的 see 和 src 按对照表改名。 */
export function convertScene(value: unknown, at: At, s: ConvertState): unknown {
  if (!isRecord(value)) return convertValue(value, at, s);
  const fields = convertFields(value, at, s);
  const { name } = value;
  if (Object.hasOwn(fields, "scene") || typeof name !== "string") return fields;
  const id = sceneIdByName(name, s);
  if (id === undefined) return fields;
  const entries = Object.entries(fields);
  const before = Math.max(
    entries.findIndex(([key]) => key === "name"),
    0,
  );
  return Object.fromEntries([...entries.slice(0, before), ["scene", id], ...entries.slice(before)]);
}
