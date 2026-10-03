import { renderCopy } from "../copy/define.ts";
import { mainlineCopy } from "../copy/mainline.ts";
import type { Issue } from "../envelope.ts";
import { formatSceneId } from "../ids.ts";
import { type DesignSpecItem, designSpecItem, type MainlinePart, mainlinePart } from "./parts.ts";

// 解析主线时查出的问题。每条都带行号，从 1 数；写了几处的另带各处的行号。
// 十样和十二样缺了哪几样不算问题，看解析结果里的 parts 和 designSpec。
// 缺了是警告还是拦截，由规则 mainline.ten 和 mainline.spec.twelve 决定，见「07 校验」第四节。
// 场景的问题里 scene 是给人看的场景名，写了编号的带上编号，例如「S14 会话中途接手」。

/**
 * - partDuplicate：十样里同一样写了几个二级标题。解析时用第一个。
 * - scenesNone：场景清单里一个场景也没认出来。
 * - sceneLegacy：旧的写法，例如「场景「回答疑问」：」「场景 1（…）：」「### 场景 1　…」。
 * - sceneIdInvalid：标题开头像编号，但写得不对，例如 S03、S0、s3。
 * - sceneIdDuplicate：几个场景写了同一个编号。
 * - sceneNameEmpty：标题里没有场景的名字。
 * - sceneWhoMissing：没写「谁在什么时候用：」，或者冒号后面是空的。旧写法的场景不报这一条。
 * - sceneNoSteps：没有编号的步骤。
 * - sceneExtraText：场景里有既不是步骤、也不是谁在什么时候用的行，count 是这种行的行数。
 * - stepArrowMissing、stepArrowExtra：一步里没有「→」，或者不止一个。
 * - stepDoEmpty、stepExpectEmpty：「→」前面或后面是空的。
 * - stepNumber：写的编号和这一步在场景里的先后对不上。step 是按先后数的步号。
 * - designSpecDuplicate：十二样里同一样写了几个标题。解析时用第一个。
 * - designSpecEmpty：十二样的标题下面没有内容。
 * - designSpecNoneReason：写了「无」，没写原因。
 * - designSpecTable：设计规范写成了旧模板的表格，表头第一格是「职能」。
 * - writingSpecDuplicate：写作规范写了几节。解析时用第一节。
 * - writingSpecTable：写作规范里的表格，表头第一格没有「停用」两个字。
 * - writingSpecReplacementEmpty：停用的说法没写改成什么。
 * - writingSpecEllipsis：停用的说法里有省略号。写作校验按原样查找，这一条永远查不到，所以不收。
 */
export type MainlineProblem =
  | {
      readonly kind: "partDuplicate";
      readonly line: number;
      readonly part: MainlinePart;
      readonly lines: readonly number[];
    }
  | { readonly kind: "scenesNone"; readonly line: number }
  | { readonly kind: "sceneLegacy"; readonly line: number; readonly scene: string }
  | { readonly kind: "sceneIdInvalid"; readonly line: number; readonly text: string }
  | {
      readonly kind: "sceneIdDuplicate";
      readonly line: number;
      readonly id: number;
      readonly lines: readonly number[];
    }
  | { readonly kind: "sceneNameEmpty"; readonly line: number }
  | { readonly kind: "sceneWhoMissing"; readonly line: number; readonly scene: string }
  | { readonly kind: "sceneNoSteps"; readonly line: number; readonly scene: string }
  | {
      readonly kind: "sceneExtraText";
      readonly line: number;
      readonly scene: string;
      readonly count: number;
    }
  | {
      readonly kind: StepProblemKind;
      readonly line: number;
      readonly scene: string;
      readonly step: number;
    }
  | {
      readonly kind: "stepArrowExtra";
      readonly line: number;
      readonly scene: string;
      readonly step: number;
      readonly count: number;
    }
  | {
      readonly kind: "stepNumber";
      readonly line: number;
      readonly scene: string;
      readonly step: number;
      readonly written: number;
    }
  | {
      readonly kind: "designSpecDuplicate";
      readonly line: number;
      readonly item: DesignSpecItem;
      readonly lines: readonly number[];
    }
  | {
      readonly kind: "designSpecEmpty" | "designSpecNoneReason";
      readonly line: number;
      readonly item: DesignSpecItem;
    }
  | { readonly kind: "designSpecTable"; readonly line: number }
  | {
      readonly kind: "writingSpecDuplicate";
      readonly line: number;
      readonly lines: readonly number[];
    }
  | { readonly kind: "writingSpecTable"; readonly line: number }
  | {
      readonly kind: "writingSpecReplacementEmpty" | "writingSpecEllipsis";
      readonly line: number;
      readonly phrase: string;
    };

/** 一步的问题里只带场景和步号的几种。 */
type StepProblemKind = "stepArrowMissing" | "stepDoEmpty" | "stepExpectEmpty";

export type MainlineProblemKind = MainlineProblem["kind"];

/** 按行号排，同一行的按查出的先后。 */
export function sortProblems(problems: readonly MainlineProblem[]): MainlineProblem[] {
  return problems
    .map((problem, order) => ({ problem, order }))
    .sort((a, b) => a.problem.line - b.problem.line || a.order - b.order)
    .map(({ problem }) => problem);
}

/** 给人看的场景名：写了编号的带上编号。 */
export function sceneLabel(id: number | undefined, name: string): string {
  if (id === undefined) return name;
  return name === "" ? formatSceneId(id) : `${formatSceneId(id)} ${name}`;
}

/**
 * 一条问题的报错：什么不对、怎么改。给了主线文件的路径时，另写在哪里。
 * 规矩的编号由调用的地方写。
 */
export function describeMainlineProblem(problem: MainlineProblem, file?: string): Issue {
  const [message, hint] = problemText(problem);
  if (file === undefined) return { message, hint };
  const lines = "lines" in problem ? problem.lines : [problem.line];
  const where = renderCopy(mainlineCopy.where, { file, lines: lines.join("、") });
  return { message, hint, where };
}

/**
 * 一批问题的报错。同样是「没有写谁在什么时候用」的场景有两个以上时合成一条，列出场景，
 * 位置写全部行号，别的照单条写。报错的先后照第一次出现的位置排。
 */
export function describeMainlineProblems(
  problems: readonly MainlineProblem[],
  file?: string,
): Issue[] {
  const missing = problems.flatMap((problem) =>
    problem.kind === "sceneWhoMissing" ? [problem] : [],
  );
  if (missing.length < 2) return problems.map((problem) => describeMainlineProblem(problem, file));
  const merged = (): Issue => {
    const scenes = missing.map(({ scene }) => /^S[1-9]\d*/u.exec(scene)?.[0] ?? scene);
    const message = renderCopy(mainlineCopy.sceneWhoMissingMany, {
      count: missing.length,
      scenes: scenes.join("、"),
    });
    const hint = renderCopy(mainlineCopy.problem.sceneWhoMissing.hint);
    if (file === undefined) return { message, hint };
    const lines = missing.map(({ line }) => line).join("、");
    return { message, hint, where: renderCopy(mainlineCopy.where, { file, lines }) };
  };
  let placed = false;
  return problems.flatMap((problem) => {
    if (problem.kind !== "sceneWhoMissing") return [describeMainlineProblem(problem, file)];
    if (placed) return [];
    placed = true;
    return [merged()];
  });
}

function problemText(problem: MainlineProblem): readonly [message: string, hint: string] {
  const c = mainlineCopy.problem;
  switch (problem.kind) {
    case "partDuplicate":
      return [
        renderCopy(c.partDuplicate.message, {
          part: mainlinePart.label(problem.part),
          count: problem.lines.length,
        }),
        renderCopy(c.partDuplicate.hint),
      ];
    case "scenesNone":
      return [renderCopy(c.scenesNone.message), renderCopy(c.scenesNone.hint)];
    case "sceneLegacy":
      return [
        renderCopy(c.sceneLegacy.message, { scene: problem.scene }),
        renderCopy(c.sceneLegacy.hint),
      ];
    case "sceneIdInvalid":
      return [
        renderCopy(c.sceneIdInvalid.message, { text: problem.text }),
        renderCopy(c.sceneIdInvalid.hint),
      ];
    case "sceneIdDuplicate":
      return [
        renderCopy(c.sceneIdDuplicate.message, {
          id: formatSceneId(problem.id),
          count: problem.lines.length,
        }),
        renderCopy(c.sceneIdDuplicate.hint),
      ];
    case "sceneNameEmpty":
      return [renderCopy(c.sceneNameEmpty.message), renderCopy(c.sceneNameEmpty.hint)];
    case "sceneWhoMissing":
      return [
        renderCopy(c.sceneWhoMissing.message, { scene: problem.scene }),
        renderCopy(c.sceneWhoMissing.hint),
      ];
    case "sceneNoSteps":
      return [
        renderCopy(c.sceneNoSteps.message, { scene: problem.scene }),
        renderCopy(c.sceneNoSteps.hint),
      ];
    case "sceneExtraText":
      return [
        renderCopy(c.sceneExtraText.message, { scene: problem.scene, count: problem.count }),
        renderCopy(c.sceneExtraText.hint),
      ];
    case "stepArrowMissing":
    case "stepDoEmpty":
    case "stepExpectEmpty": {
      const entry = c[problem.kind];
      return [
        renderCopy(entry.message, { scene: problem.scene, step: problem.step }),
        renderCopy(entry.hint),
      ];
    }
    case "stepArrowExtra":
      return [
        renderCopy(c.stepArrowExtra.message, {
          scene: problem.scene,
          step: problem.step,
          count: problem.count,
        }),
        renderCopy(c.stepArrowExtra.hint),
      ];
    case "stepNumber":
      return [
        renderCopy(c.stepNumber.message, {
          scene: problem.scene,
          step: problem.step,
          written: problem.written,
        }),
        renderCopy(c.stepNumber.hint),
      ];
    case "designSpecDuplicate":
      return [
        renderCopy(c.designSpecDuplicate.message, {
          item: designSpecItem.label(problem.item),
          count: problem.lines.length,
        }),
        renderCopy(c.designSpecDuplicate.hint),
      ];
    case "designSpecEmpty":
    case "designSpecNoneReason": {
      const entry = c[problem.kind];
      return [
        renderCopy(entry.message, { item: designSpecItem.label(problem.item) }),
        renderCopy(entry.hint),
      ];
    }
    case "designSpecTable":
      return [renderCopy(c.designSpecTable.message), renderCopy(c.designSpecTable.hint)];
    case "writingSpecDuplicate":
      return [
        renderCopy(c.writingSpecDuplicate.message, { count: problem.lines.length }),
        renderCopy(c.writingSpecDuplicate.hint),
      ];
    case "writingSpecTable":
      return [renderCopy(c.writingSpecTable.message), renderCopy(c.writingSpecTable.hint)];
    case "writingSpecReplacementEmpty":
    case "writingSpecEllipsis": {
      const entry = c[problem.kind];
      return [renderCopy(entry.message, { phrase: problem.phrase }), renderCopy(entry.hint)];
    }
  }
}
