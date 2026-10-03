import {
  assignSceneIds,
  formatSceneId,
  type LegacySceneEntry,
  type LegacySceneNumber,
  type MainlinePart,
  type MainlineProblem,
  parseMainline,
  type RepoKind,
} from "@product-loop/model";

// 迁移检查的主线一项，见「08 版本与迁移」第四节：开头的 claude.ai 固定链接、场景标题的编号、十样缺哪几样。
// --fix 先存原文作为第 1 版，再存一版去掉链接、补上场景编号的，缺的几样只报告。
// 旧页面的位置写场景名或场景的序号，转换时按这里给出的对照换成场景编号。

export type MainlineFinding =
  | { readonly kind: "missing" }
  | {
      readonly kind: "found";
      /** 开头写着 claude.ai 固定链接的行号，从 1 数。 */
      readonly links: readonly number[];
      /** 场景清单里认出的场景个数。 */
      readonly scenes: number;
      /** 没写编号、会补上编号的场景个数。 */
      readonly assigned: number;
      /** 旧写法的场景个数，补编号时改成新的写法。 */
      readonly legacyScenes: number;
      /** 十样里缺的几样。 */
      readonly missingParts: readonly MainlinePart[];
      /** 解析查出的问题，旧写法的场景不算在内。 */
      readonly problems: readonly MainlineProblem[];
      /** 旧主线写明的仓库类别，没写时没有。 */
      readonly repoKind?: RepoKind;
    };

/** 转换旧页面时查场景编号用的对照。 */
export type SceneContext = {
  readonly scenes: readonly LegacySceneEntry[];
  readonly sceneNumbers: readonly LegacySceneNumber[];
};

const noScenes: SceneContext = { scenes: [], sceneNumbers: [] };

/** 固定链接的写法。 */
const fixedLink = "https://claude.ai/";

/** 开头的链接：第一个二级标题以前、写着 claude.ai 链接的行。 */
function linkLines(lines: readonly string[]): number[] {
  const found: number[] = [];
  for (const [i, line] of lines.entries()) {
    if (/^ {0,3}##(?!#)/u.test(line)) break;
    if (line.includes(fixedLink)) found.push(i + 1);
  }
  return found;
}

/** 汉字写的数字，一到九十九。 */
const digits = "一二三四五六七八九";

function chineseNumber(text: string): number | undefined {
  const value = (char: string | undefined) => (char === undefined ? 0 : digits.indexOf(char) + 1);
  const ten = text.indexOf("十");
  if (ten === -1) return text.length === 1 && value(text) > 0 ? value(text) : undefined;
  const tens = ten === 0 ? 1 : value(text[0]);
  const ones = value(text[ten + 1]);
  return tens > 0 && ten <= 1 && text.length <= ten + 2 ? tens * 10 + ones : undefined;
}

/** 旧写法的场景标题里写的序号，例如「场景 1（…）」「### 场景一　…」。 */
function legacyNumber(line: string): number | undefined {
  const text = line
    .replace(/^ {0,3}#{1,6}\s+/u, "")
    .replaceAll("**", "")
    .trim();
  const m = /^场景\s*([0-9]+|[一二三四五六七八九十]+)/u.exec(text);
  if (m === null) return undefined;
  const written = m[1] ?? "";
  return /^[0-9]+$/u.test(written) ? Number(written) : chineseNumber(written);
}

/** 旧主线写明的仓库类别：「仓库性质：共用仓库」「这个仓库是自己的」这类写法。 */
function repoKindOf(text: string): RepoKind | undefined {
  const m =
    /(?:仓库性质[：:]\s*\**\s*|仓库是)(共用|自己)/u.exec(text) ?? /(共用|自己的)仓库/u.exec(text);
  if (m === null) return undefined;
  return m[1]?.startsWith("共用") ? "shared" : "own";
}

/** 看一份旧主线，另给出转换旧页面时用的场景对照。text 是 undefined 表示没有主线。 */
export function scanMainline(text: string | undefined): {
  readonly finding: MainlineFinding;
  readonly context: SceneContext;
} {
  if (text === undefined) return { finding: { kind: "missing" }, context: noScenes };
  const lines = text.split(/\r\n|\r|\n/u);
  const before = parseMainline(text);
  const assigned = assignSceneIds(text);
  const after = parseMainline(assigned.text);
  // 补编号不改行数，同一个场景补编号前后在同一行
  const idAt = new Map(after.scenes.map((scene) => [scene.line, scene.id]));
  const sceneNumbers: LegacySceneNumber[] = before.scenes.flatMap((scene) => {
    const id = idAt.get(scene.line);
    const number = scene.legacy ? legacyNumber(lines[scene.line - 1] ?? "") : undefined;
    return id === undefined || number === undefined ? [] : [{ number, id: formatSceneId(id) }];
  });
  const scenes: LegacySceneEntry[] = after.scenes.flatMap((scene) =>
    scene.id === undefined ? [] : [{ name: scene.name, id: formatSceneId(scene.id) }],
  );
  const repoKind = repoKindOf(text);
  return {
    finding: {
      kind: "found",
      links: linkLines(lines),
      scenes: before.scenes.length,
      assigned: assigned.assigned.length,
      legacyScenes: before.scenes.filter((scene) => scene.legacy).length,
      missingParts: before.parts.filter((part) => !part.present).map((part) => part.part),
      problems: before.problems.filter((problem) => problem.kind !== "sceneLegacy"),
      ...(repoKind === undefined ? {} : { repoKind }),
    },
    context: { scenes, sceneNumbers },
  };
}

/**
 * --fix 存的第 2 版主线：补上场景编号，去掉开头写着固定链接的行。
 * 补编号不改行数，所以先补编号，再按原来的行号删链接。
 */
export function cleanMainline(text: string): string {
  const lines = assignSceneIds(text).text.split(/\r\n|\r|\n/u);
  const links = new Set(linkLines(lines));
  return lines.filter((_, i) => !links.has(i + 1)).join("\n");
}
