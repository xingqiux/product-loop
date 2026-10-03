import { renderCopy } from "@product-loop/model";
import { readErrorCopy } from "../copy/read-error.ts";

// 读文件、运行程序失败时，取出原因写成给人看的话，不把 ENOENT 这样的系统错误码原样交给人，见审查报告 P27。

/** 出错的种类：文件或程序不存在，没有权限，其余。报错的提示按种类选。 */
type FailureKind = "missing" | "denied" | "other";

export type Failure = { readonly kind: FailureKind; readonly reason: string };

/** 系统错误的错误码，例如 ENOENT。不是系统错误时返回 undefined。 */
export function errnoOf(error: unknown): string | undefined {
  const code = error instanceof Error ? Reflect.get(error, "code") : undefined;
  return typeof code === "string" ? code : undefined;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 读文件失败：文件不存在、没有权限、是文件夹，各写成一句话。 */
export function readFailure(error: unknown): Failure {
  const text = readErrorCopy.file;
  switch (errnoOf(error)) {
    case "ENOENT":
      return { kind: "missing", reason: renderCopy(text.missing) };
    case "EACCES":
    case "EPERM":
      return { kind: "denied", reason: renderCopy(text.denied) };
    case "EISDIR":
      return { kind: "other", reason: renderCopy(text.directory) };
    case "ENOTDIR":
      return { kind: "missing", reason: renderCopy(text.notDirectory) };
    default:
      return { kind: "other", reason: renderCopy(text.other, { detail: detailOf(error) }) };
  }
}

/** 运行程序失败的原因，传进来的是 spawn 报的错误码，例如 ENOENT。 */
export function programFailure(code: string): Failure {
  const text = readErrorCopy.program;
  if (code === "ENOENT") return { kind: "missing", reason: renderCopy(text.missing) };
  if (code === "EACCES") return { kind: "denied", reason: renderCopy(text.denied) };
  return { kind: "other", reason: renderCopy(text.other, { detail: code }) };
}
