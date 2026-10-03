import type { z } from "zod";
import { renderCopy } from "../copy/define.ts";
import { formatChangeCopy, pageCopy } from "../copy/page.ts";
import { type Stage, stage } from "../names.ts";
import { err, ok, type Result } from "../result.ts";
import { pageIssueParams } from "./issue.ts";
import {
  type FormatChangeEntry,
  fieldPath,
  formatChangeAt,
  formatChangeOfValue,
  renamedValue,
} from "./legacy-format.ts";
import { describeIssue, fieldLabel, type IssueText, pageErrorMap, valueText } from "./messages.ts";
import { pageSection } from "./section-names.ts";
import { pageSchemas, type StagePage, sectionAllowed } from "./stages.ts";

// 按阶段校验一份页面数据，一次报出全部问题。每条写在哪里、什么不对、怎么改，
// 以及查的是哪一项，见「04 命令行」第六节。JSON 本身写坏了由命令行在解析时报到行和列，不到这里。
//
// Zod 的问题在这里换成页面数据的问题，有三处和 Zod 不同：
// - 不认识的字段一个一个报。这一阶段不能写的区块，报它只在哪个阶段写。
//   旧格式的字段和取值，按新旧格式的对照表报改成什么。
// - 几种写法都不合时，挑出和数据同一种类型的那一种，报它里面的问题。
// - 定义自己报的问题原样保留。

/** 页面数据的一条问题。 */
export type PageIssue = IssueText & {
  /** 出问题的字段在页面数据里的路径，例如 ["asks", 0, "sources", 1]。 */
  readonly path: readonly (string | number)[];
};

/**
 * 按阶段校验页面数据。通过时得到解析以后的数据，枚举是英文键。
 * 不通过时列出全部问题，顺序和数据里的顺序大体相同。
 */
export function checkPageData<S extends Stage>(
  key: S,
  data: unknown,
): Result<StagePage<S>, readonly PageIssue[]> {
  const result = pageSchemas[key].safeParse(data, { error: pageErrorMap, reportInput: true });
  if (result.success) return ok(result.data as StagePage<S>);
  return err(result.error.issues.flatMap((issue) => pageIssues(issue, key)));
}

function toPath(path: readonly PropertyKey[]): (string | number)[] {
  return path.filter((part): part is string | number => typeof part !== "symbol");
}

/** 对照表里这一条的说明，报在「怎么改」里。 */
function formatNote(change: FormatChangeEntry): string {
  return renderCopy(formatChangeCopy[change.key].note);
}

/** Zod 的一条问题换成页面数据的问题，不认识的字段有几个就换成几条。 */
function pageIssues(issue: z.core.$ZodIssue, key: Stage): PageIssue[] {
  const path = toPath(issue.path);
  switch (issue.code) {
    case "custom": {
      const params = pageIssueParams(issue);
      if (params === undefined) break;
      return [{ path, check: params.check, message: issue.message, hint: params.hint }];
    }
    case "unrecognized_keys":
      return issue.keys.map((name) => unknownField(path, name, key));
    case "invalid_union": {
      if (issue.discriminator !== undefined) {
        const at = oldValue(path, discriminatorOf(issue.input, issue.discriminator));
        if (at !== undefined) return [at];
        break;
      }
      const branch = matchingBranch(issue.errors);
      if (branch === undefined) break;
      return branch.flatMap((inner) =>
        pageIssues({ ...inner, path: [...issue.path, ...inner.path] }, key),
      );
    }
    case "invalid_value": {
      const at = oldValue(path, issue.input);
      if (at !== undefined) return [at];
      break;
    }
    case "invalid_type": {
      // 值的写法变了的字段，例如 evidence 只写成数组，按对照表写改成什么。
      const change = formatChangeAt(fieldPath(path));
      if (change?.kind === "reshaped" && issue.input !== undefined) {
        const { message } = describeIssue(issue);
        return [{ path, check: `formatChange.${change.key}`, message, hint: formatNote(change) }];
      }
      break;
    }
    default:
      break;
  }
  return [{ path, ...describeIssue(issue) }];
}

/**
 * 不认识的一个字段。下面三种各报改成什么，别的一律报不在定义里：
 * - 这一阶段不能写的区块。
 * - 旧格式里已废除或改由命令填的字段。
 * - 改了名的字段。
 */
function unknownField(parent: (string | number)[], name: string, key: Stage): PageIssue {
  const path = [...parent, name];
  if (parent.length === 0 && pageSection.isKey(name) && !sectionAllowed(key, name)) {
    const entry = pageCopy.stage[name as keyof typeof pageCopy.stage];
    const check = `page.stage.${name}`;
    const message = renderCopy(entry.message, { stage: stage.label(key) });
    return { path, check, message, hint: renderCopy(entry.hint) };
  }
  const change = formatChangeAt(fieldPath(path));
  if (
    change !== undefined &&
    (change.kind === "abolished" || change.kind === "commandFilled" || change.kind === "renamed")
  ) {
    const message = renderCopy(pageCopy.format[change.kind], { field: name });
    return { path, check: `formatChange.${change.key}`, message, hint: formatNote(change) };
  }
  const message = renderCopy(pageCopy.field.unknown.message, { field: name });
  const hint = renderCopy(pageCopy.field.unknown.hint, { field: name });
  return { path, check: "page.field.unknown", message, hint };
}

/** 写了旧格式的取值：已废除的报改成什么，换了写法的报新的写法。不是旧的取值时返回 undefined。 */
function oldValue(path: (string | number)[], value: unknown): PageIssue | undefined {
  const change = formatChangeOfValue(fieldPath(path), value);
  if (change === undefined) return undefined;
  const field = fieldLabel(path);
  const text = valueText(value);
  const check = `formatChange.${change.key}`;
  const now = renamedValue(change, text);
  if (now !== undefined) {
    const message = renderCopy(pageCopy.format.renamedValue, { field, value: text });
    return { path, check, message, hint: renderCopy(pageCopy.format.newValue, { now }) };
  }
  const message = renderCopy(pageCopy.format.abolishedValue, { field, value: text });
  return { path, check, message, hint: formatNote(change) };
}

/** 区分几种写法的字段写了什么。 */
function discriminatorOf(input: unknown, discriminator: string): unknown {
  if (typeof input !== "object" || input === null || !Object.hasOwn(input, discriminator)) {
    return undefined;
  }
  return (input as Readonly<Record<string, unknown>>)[discriminator];
}

/**
 * 几种写法都不合时，挑出和数据同一种类型的那一种。例如表格的一格写成对象，
 * 文字那种写法整个类型不对，剩下对象那种，就报对象里哪个字段不对。挑不出唯一的一种时返回 undefined。
 */
function matchingBranch(
  branches: readonly (readonly z.core.$ZodIssue[])[],
): readonly z.core.$ZodIssue[] | undefined {
  const sameType = branches.filter(
    (issues) => !issues.some((inner) => inner.code === "invalid_type" && inner.path.length === 0),
  );
  const [only] = sameType;
  return sameType.length === 1 ? only : undefined;
}
