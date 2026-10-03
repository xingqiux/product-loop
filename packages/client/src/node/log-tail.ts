import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  beijingSecond,
  type LogLine,
  logLineSchema,
  renderCopy,
  rotatedLogFileName,
} from "@product-loop/model";
import { nodeCopy } from "./copy.ts";

// 后端起不来时报出日志的最后几行，见「01 架构」第八节。日志一行一个 JSON 对象，格式见共用定义。
// 这里把每一行写成给人和 AI 看的中文：时间、级别和说明。出错的行另写报错的原文，要动手时写怎么改。
// 日志按大小轮转。刚轮转过时，最后几行在 backend.log.1 里，这时连同它一起读。

export type LogTailOptions = {
  /** 最多取几行。 */
  readonly lines: number;
  /** 只取这个时间以后写的行，毫秒。拉起后端时传拉起的时间，以前各次启动写的行不报。 */
  readonly since?: number;
};

/** 写坏了的行照原样报出，最多留这么多字。 */
const rawLimit = 200;

/** 报错的原文最多留这么多字，调用栈不报。 */
const detailLimit = 300;

type Entry = { readonly line: LogLine } | { readonly raw: string };

/** 日志的最后几行，写成给人看的中文，日志的一行对应一项。没有日志文件时是空的。 */
export function readLogTail(logFile: string, options: LogTailOptions): string[] {
  let picked = pick(readLines(logFile), options.since);
  if (picked.length < options.lines) {
    const older = join(dirname(logFile), rotatedLogFileName(1));
    picked = [...pick(readLines(older), options.since), ...picked];
  }
  return picked
    .slice(-options.lines)
    .map((entry) => ("raw" in entry ? entry.raw : formatLogLine(entry.line)));
}

/** 日志的一行写成给人看的中文：第一行是时间、级别和说明，下面缩进写报错的原文和怎么改。 */
export function formatLogLine(line: LogLine): string {
  const { log } = nodeCopy;
  const level = renderCopy(log.level[line.level]);
  const first = renderCopy(log.line, {
    time: beijingTime(line.time),
    level,
    message: line.message,
  });
  const detail = errorDetail(line.error);
  const request: unknown = line.request;
  return [
    first,
    ...(typeof request === "string" && request !== ""
      ? [`  ${renderCopy(log.request, { request })}`]
      : []),
    ...(detail === undefined ? [] : [`  ${renderCopy(log.error, { detail })}`]),
    ...(line.hint === undefined ? [] : [`  ${renderCopy(log.hint, { hint: line.hint })}`]),
  ].join("\n");
}

function readLines(file: string): string[] {
  try {
    return readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "");
  } catch {
    return [];
  }
}

/**
 * 解析每一行，只留 since 以后写的。日志按时间先后写，所以一行过了 since，后面的行也都算。
 * 写坏了的行不知道时间，它前面的行已过 since 时才留下。
 */
function pick(lines: readonly string[], since: number | undefined): Entry[] {
  const picked: Entry[] = [];
  let recent = since === undefined;
  for (const text of lines) {
    const line = parseLine(text);
    if (line === undefined) {
      if (recent) picked.push({ raw: truncate(text, rawLimit) });
      continue;
    }
    recent ||= since === undefined || Date.parse(line.time) >= since;
    if (recent) picked.push({ line });
  }
  return picked;
}

function parseLine(text: string): LogLine | undefined {
  try {
    const parsed = logLineSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/** 报错的原文：错误对象写成「名字: 说明」，字符串照原样。调用栈不报，太长的截断。 */
function errorDetail(value: unknown): string | undefined {
  if (typeof value === "string") return value === "" ? undefined : truncate(value, detailLimit);
  if (typeof value !== "object" || value === null) return undefined;
  const message: unknown = Reflect.get(value, "message");
  const name: unknown = Reflect.get(value, "name");
  if (typeof message !== "string" || message === "") return undefined;
  const text = typeof name === "string" && name !== "" ? `${name}: ${message}` : message;
  return truncate(text, detailLimit);
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 日志里的时间是 UTC，写成北京时间，精确到秒，例如 2026-09-28 11:00:01。 */
function beijingTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : beijingSecond(date);
}
