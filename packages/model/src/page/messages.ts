import type { z } from "zod";
import { type CopyEntry, renderCopy } from "../copy/define.ts";
import { pageCopy } from "../copy/page.ts";
import { textPattern } from "./fields.ts";
import type { IssueCopy, IssueValues } from "./issue.ts";

// Zod 的通用问题写成中文：缺字段、类型不对、取值不在范围里、不认识的字段，见「07 校验」第二节。
// 每一种问题配一条文案，写明什么不对、怎么改，见「04 命令行」第六节。
// 定义自己报的问题已经带着中文和怎么改，不经过这里。

/** 一条问题的中文：查的是哪一项、什么不对、怎么改。check 写文案表里这条报错的键。 */
export type IssueText = {
  readonly check: string;
  readonly message: string;
  readonly hint: string;
};

/** Zod 的一条问题，不看 message。报错函数拿到的和解析完得到的都是这个样子。 */
export type IssueFacts = z.core.$ZodIssue extends infer I
  ? I extends z.core.$ZodIssue
    ? Omit<I, "message">
    : never
  : never;

const { field: fieldCopy, phrase } = pageCopy;

function issueText<C extends IssueCopy>(
  check: string,
  entry: C,
  values: IssueValues<C>,
): IssueText {
  const message: CopyEntry = entry.message;
  const hint: CopyEntry = entry.hint;
  return { check, message: renderCopy(message, values), hint: renderCopy(hint, values) };
}

/** 报错里怎么称呼出问题的字段：最后一个字段名，后面的下标照写，例如 rows[0][1]。 */
export function fieldLabel(path: readonly PropertyKey[]): string {
  let end = path.length;
  while (end > 0 && typeof path[end - 1] === "number") end -= 1;
  const name = end > 0 ? String(path[end - 1]) : "";
  return (
    name +
    path
      .slice(end)
      .map((index) => `[${String(index)}]`)
      .join("")
  );
}

/** 一个取值在报错里的写法：文字照写，别的写成 JSON。 */
export function valueText(value: unknown): string {
  return typeof value === "string" ? value : String(JSON.stringify(value));
}

/** 应该写成什么。expected 是 Zod 的说法，例如 string、int、array。 */
function expectedText(expected: string): string {
  switch (expected) {
    case "string":
      return renderCopy(phrase.text);
    case "number":
      return renderCopy(phrase.number);
    case "int":
      return renderCopy(phrase.integer);
    case "array":
      return renderCopy(phrase.array);
    case "object":
      return renderCopy(phrase.object);
    default:
      return expected;
  }
}

/** 实际写成了什么。true、false 和 null 照写。 */
function receivedText(input: unknown): string {
  if (typeof input === "string") return renderCopy(phrase.text);
  if (typeof input === "number") {
    return renderCopy(Number.isInteger(input) ? phrase.number : phrase.decimal);
  }
  if (Array.isArray(input)) return renderCopy(phrase.array);
  if (typeof input === "object" && input !== null) return renderCopy(phrase.object);
  return String(input);
}

/** 可选的取值，用顿号隔开。 */
export function optionsText(options: readonly unknown[]): string {
  return options.map(valueText).join("、");
}

/** 区分几种写法的字段写了什么。数据不是对象时是 undefined。 */
function discriminatorValue(input: unknown, discriminator: string): unknown {
  if (typeof input !== "object" || input === null) return undefined;
  return Object.hasOwn(input, discriminator)
    ? (input as Readonly<Record<string, unknown>>)[discriminator]
    : undefined;
}

/** 按问题的种类写成中文。数据要带着 input，才分得清缺字段和类型不对。 */
export function describeIssue(issue: IssueFacts): IssueText {
  const { path } = issue;
  const field = fieldLabel(path);
  switch (issue.code) {
    case "invalid_type": {
      if (path.length === 0) {
        return issueText("page.field.root", fieldCopy.root, {
          received: receivedText(issue.input),
        });
      }
      const expected = expectedText(issue.expected);
      if (issue.input === undefined) {
        return issueText("page.field.missing", fieldCopy.missing, { field, expected });
      }
      const received = receivedText(issue.input);
      return issueText("page.field.type", fieldCopy.type, { field, expected, received });
    }
    case "too_small": {
      if (issue.origin === "array" && issue.minimum === 1) {
        return issueText("page.field.emptyArray", fieldCopy.emptyArray, { field });
      }
      if (issue.origin === "number" && typeof issue.minimum === "number") {
        const bound = renderCopy(issue.inclusive === true ? phrase.atLeast : phrase.above, {
          minimum: issue.minimum,
        });
        const value = valueText(issue.input);
        return issueText("page.field.tooSmall", fieldCopy.tooSmall, { field, value, bound });
      }
      break;
    }
    case "invalid_format":
      if (issue.format === "regex" && issue.pattern === String(textPattern)) {
        return issueText("page.field.empty", fieldCopy.empty, { field });
      }
      break;
    case "invalid_value": {
      const value = valueText(issue.input);
      const [only] = issue.values;
      if (issue.values.length === 1 && only === true) {
        return issueText("page.field.trueOnly", fieldCopy.trueOnly, { field, value });
      }
      const options = optionsText(issue.values);
      return issueText("page.field.value", fieldCopy.value, { field, value, options });
    }
    case "invalid_union": {
      // 按一个字段区分几种写法时，Zod 把问题报在这个字段上，并列出它可选的取值。
      if (issue.discriminator !== undefined && "options" in issue && issue.options !== undefined) {
        const options = optionsText(issue.options);
        const value = discriminatorValue(issue.input, issue.discriminator);
        if (value === undefined) {
          const expected = renderCopy(phrase.oneOf, { options });
          return issueText("page.field.missing", fieldCopy.missing, { field, expected });
        }
        return issueText("page.field.value", fieldCopy.value, {
          field,
          value: valueText(value),
          options,
        });
      }
      return issueText("page.field.union", fieldCopy.union, { field });
    }
    case "unrecognized_keys":
      return issueText("page.field.unknown", fieldCopy.unknown, { field: issue.keys.join("、") });
    default:
      break;
  }
  return issueText("page.field.invalid", fieldCopy.invalid, { field });
}

/**
 * 页面数据的报错函数：Zod 的通用问题写成中文。定义自己报的问题已经带着中文，Zod 不会来问。
 * 用法是 schema.safeParse(data, { error: pageErrorMap })。check-page.ts 另配上怎么改。
 */
export const pageErrorMap: z.core.$ZodErrorMap = (issue) =>
  describeIssue({ ...issue, path: issue.path ?? [] } as IssueFacts).message;
