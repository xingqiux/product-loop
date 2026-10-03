import { readFile } from "node:fs/promises";
import {
  type ErrorBody,
  err,
  errorBody,
  type Issue,
  ok,
  type ProjectIdentity,
  projectIdentitySchema,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { projectCopy } from "../copy/project.ts";
import { jsonSyntaxError } from "./json-error.ts";
import { readFailure } from "./read-error.ts";

// 读项目缓存里的 project.json，按共用定义里的格式校验，见「03 数据模型」第五节。
// project.json 只由命令写，AI 不改。写坏了按「要先做迁移检查」报，退出码 6，由 ploop doctor 检查。
// 报错写到位置：JSON 写坏了写到行和列，格式不对写到字段，见「04 命令行」第六节。

// 命令行不直接依赖 Zod，校验问题的类型从校验结果里取。
type SchemaIssue = NonNullable<
  ReturnType<typeof projectIdentitySchema.safeParse>["error"]
>["issues"][number];

const { identity: text } = projectCopy;

function needsDoctor(issues: readonly [Issue, ...Issue[]]): ErrorBody<"NEEDS_DOCTOR"> {
  return errorBody("NEEDS_DOCTOR", issues);
}

/** 字段的路径写成 mainlineBase.hash 这样，数组的下标写成 [0]。 */
function fieldPath(path: readonly PropertyKey[]): string {
  return path
    .map((key, i) => (typeof key === "number" ? `[${key}]` : `${i === 0 ? "" : "."}${String(key)}`))
    .join("");
}

/** 按路径取出 JSON 里的值，取不到时是 undefined。 */
function valueAt(value: unknown, path: readonly PropertyKey[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = Object.hasOwn(current, key)
      ? (current as Record<PropertyKey, unknown>)[key]
      : undefined;
  }
  return current;
}

/** 格式不对的每一处写成一条：缺了、写法不对、不认识。 */
function schemaIssues(file: string, value: unknown, issue: SchemaIssue): Issue[] {
  const hint = renderCopy(text.hint);
  const at = (path: readonly PropertyKey[]) =>
    renderCopy(text.atField, { file, field: fieldPath(path) });
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((key) => {
      const path = [...issue.path, key];
      return {
        message: renderCopy(text.unknownField, { field: fieldPath(path) }),
        hint,
        where: at(path),
      };
    });
  }
  const [top] = issue.path;
  if (top === undefined) return [{ message: renderCopy(text.notObject), hint, where: file }];
  // 格式是严格的，不认识的字段在上面报，走到这里的都是 project.json 该有的字段。
  const meaning = renderCopy(text.field[top as keyof ProjectIdentity]);
  const field = fieldPath(issue.path);
  const entry = valueAt(value, issue.path) === undefined ? text.missing : text.invalid;
  return [{ message: renderCopy(entry, { field, meaning }), hint, where: at(issue.path) }];
}

/** 读出 project.json 并校验。读不出来、不是 JSON、格式不对，都返回要先做迁移检查。 */
export async function readProjectIdentity(
  file: string,
): Promise<Result<ProjectIdentity, ErrorBody<"NEEDS_DOCTOR">>> {
  const hint = renderCopy(text.hint);
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch (error) {
    const { reason } = readFailure(error);
    return err(
      needsDoctor([{ message: renderCopy(text.unreadable, { reason }), hint, where: file }]),
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    const position = jsonSyntaxError(source);
    const where = position === undefined ? file : renderCopy(text.atLine, { file, ...position });
    return err(needsDoctor([{ message: renderCopy(text.syntax), hint, where }]));
  }
  const parsed = projectIdentitySchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  const [first, ...rest] = parsed.error.issues.flatMap((issue) => schemaIssues(file, value, issue));
  // Zod 校验不过时至少有一条问题，每条至少写成一条报错。
  return err(needsDoctor([first as Issue, ...rest]));
}
