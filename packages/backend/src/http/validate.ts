import { zValidator } from "@hono/zod-validator";
import {
  type CopyEntry,
  errorBody,
  errorCodeCopyOf,
  type Issue,
  renderCopy,
} from "@product-loop/model";
import type { Context, MiddlewareHandler } from "hono";
import type { z } from "zod";
import { httpCopy } from "../copy/http.ts";
import { failure } from "./respond.ts";

// 请求的校验：接口层用共用定义解析请求体和查询参数，见「05 接口」第十节第 1 步。
// 枚举用 codec 定义，解析以后是英文键。不合定义时返回 BAD_REQUEST，一次列出全部问题。
// 定义里自己写了报错的，用定义的报错。其余由这里按问题的种类写成中文。

type Target = "json" | "query";

/** Zod 问题里期望的类型，换成报错里的说法。 */
const typeNames: Readonly<Record<string, CopyEntry>> = httpCopy.typeName;

/** 字段的路径，写成 addRoots[1] 这样。 */
function fieldPath(path: readonly PropertyKey[]): string {
  let text = "";
  for (const part of path) {
    if (typeof part === "number") text += `[${part}]`;
    else text += text === "" ? String(part) : `.${String(part)}`;
  }
  return text;
}

/** 报错里照写的取值：文字原样写，别的写成 JSON。 */
function shown(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * 这次解析用的报错：定义里没写报错的问题，按种类写成中文。
 * Zod 先用定义自己的报错，没有时才用这里的，见 Zod 的报错优先级。
 */
function issueMessage(issue: z.core.$ZodRawIssue): string {
  const field = fieldPath(issue.path ?? []);
  const text = httpCopy.field;
  switch (issue.code) {
    case "invalid_type": {
      if (field === "") {
        return renderCopy(issue.expected === "array" ? text.bodyNotArray : text.bodyNotObject);
      }
      if (issue.input === undefined) return renderCopy(text.missing, { field });
      const type = typeNames[issue.expected];
      if (type === undefined) return renderCopy(text.invalid, { field });
      return renderCopy(text.type, { field, type: renderCopy(type) });
    }
    case "invalid_value": {
      // 没写这一项时，输入是空的，不能写成「undefined」，按缺了这一项报。
      if (issue.input === undefined) return renderCopy(text.missing, { field });
      const allowed = issue.values.map(shown).join("、");
      return renderCopy(text.value, { field, value: shown(issue.input), allowed });
    }
    case "unrecognized_keys":
      return renderCopy(text.unknown, { keys: issue.keys.join("、") });
    case "invalid_union":
      return unionMessage(issue, field);
    default:
      return renderCopy(text.invalid, { field });
  }
}

/** 几种写法里一种都没对上时的问题，里面每种写法各有一组问题，路径从请求体的根写起。 */
type UnionIssue = z.core.$ZodRawIssue<z.core.$ZodIssueInvalidUnion>;
type BranchIssue = UnionIssue["errors"][number][number];

/** 一种写法里的一个问题，写成中文。这时输入已经不在问题里，只知道字段和期望。 */
function branchMessage(issue: BranchIssue): string {
  const field = fieldPath(issue.path);
  const text = httpCopy.field;
  switch (issue.code) {
    case "invalid_type": {
      const type = typeNames[issue.expected];
      return type === undefined
        ? renderCopy(text.invalid, { field })
        : renderCopy(text.type, { field, type: renderCopy(type) });
    }
    case "invalid_value":
      return renderCopy(text.oneOf, { field, allowed: issue.values.map(shown).join("、") });
    case "unrecognized_keys":
      return renderCopy(text.unknown, { keys: issue.keys.join("、") });
    default:
      return renderCopy(text.invalid, { field });
  }
}

/**
 * 请求体有几种写法，一种都没对上：不能只写「 的写法不对」，看不出哪个字段错。
 * 看哪一种写法走得最远，路径最深的那一种就是想写的，报它的第一个问题。
 * 走得一样远，看不出想写哪一种，就把各种写法的字段都写出来。
 */
function unionMessage(issue: UnionIssue, field: string): string {
  const firsts = issue.errors.flatMap((branch) => (branch[0] === undefined ? [] : [branch[0]]));
  const depth = Math.max(0, ...firsts.map((first) => first.path.length));
  const deepest = firsts.filter((first) => first.path.length === depth);
  const [only, ...others] = deepest;
  if (only === undefined) return renderCopy(httpCopy.field.invalid, { field });
  if (others.length === 0) return branchMessage(only);
  const fields = [...new Set(deepest.map((first) => fieldPath(first.path)))].join("、");
  return renderCopy(httpCopy.field.union, { fields });
}

/** Zod 解析失败时给出的问题，只用到路径和报错。 */
type ParseIssues = {
  readonly issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[];
};

/** 不合定义的请求：每个问题一条，位置写字段的路径，怎么改用 BAD_REQUEST 的默认说明。 */
function invalidRequest(c: Context, error: ParseIssues) {
  const hint = renderCopy(errorCodeCopyOf("BAD_REQUEST").hint);
  const issues = error.issues.map((issue): Issue => {
    const where = fieldPath(issue.path);
    return { message: issue.message, hint, ...(where === "" ? {} : { where }) };
  });
  const [first, ...rest] = issues;
  // Zod 解析失败时至少有一个问题。
  if (first === undefined) throw new Error("请求没有通过校验，Zod 却没有给出问题。");
  return failure(c, errorBody("BAD_REQUEST", [first, ...rest]));
}

/** 解析时用 issueMessage 写报错。 */
function parseWithMessages(schema: z.ZodType, value: unknown) {
  return schema.safeParseAsync(value, { error: issueMessage });
}

function validate<T extends z.ZodType, K extends Target>(target: K, schema: T) {
  return zValidator(
    target,
    schema,
    (result, c) => (result.success ? undefined : invalidRequest(c, result.error)),
    {
      // zValidator 的选项按 Zod 的大版本分两种类型，T 是泛型时展不开，所以断言一次。
      validationFunction: parseWithMessages as never,
    },
  );
}

/** 按文案表的一条报错拒绝请求。 */
function rejectWith(c: Context, text: { readonly message: CopyEntry; readonly hint: CopyEntry }) {
  const issue = { message: renderCopy(text.message), hint: renderCopy(text.hint) };
  return failure(c, errorBody("BAD_REQUEST", [issue]));
}

/** 请求体是 JSON。Content-Type 不对、JSON 写坏了，都在解析之前拦下。 */
const requireJson: MiddlewareHandler = async (c, next) => {
  const type = c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/json") return rejectWith(c, httpCopy.request.contentType);
  try {
    // 解析的结果由 Hono 记下，校验时直接用它。
    await c.req.json();
  } catch {
    return rejectWith(c, httpCopy.request.notJson);
  }
  await next();
};

/** 用共用定义校验请求体。放在路由的处理函数前面，处理函数用 c.req.valid("json") 取。 */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return [requireJson, validate("json", schema)] as const;
}

/** 用共用定义校验查询参数，处理函数用 c.req.valid("query") 取。 */
export function queryParams<T extends z.ZodType>(schema: T) {
  return validate("query", schema);
}
