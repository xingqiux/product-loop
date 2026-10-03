import {
  checkDecisionFields,
  type ErrorBody,
  err,
  errorBody,
  errorCodeCopyOf,
  type Issue,
  issuesOf,
  ok,
  type Result,
  renderCopy,
} from "@product-loop/model";
import { replyCopy } from "../copy/reply.ts";

// ploop reply handle 处理的几行，发给后端以前先查一遍，回来的报错再改写一遍。
// 后端按数组校验，报错的位置是 [0].decision 这样的数组下标，AI 看不懂该改哪里。
// 这里把下标换成第几行、把字段换成命令里对应的选项，缺项在发出去以前就说清楚，
// 决定三项缺的和 ploop decision add 一样按规矩 decision.fields 拦截，退出码 1。

const { errors } = replyCopy;

/** 命令里没有对应选项的字段，用它在说明里的叫法。键是「去处.字段」。 */
const optionOf: Readonly<Record<string, string>> = {
  "决定.decision": "--decision",
  "决定.reason": "--reason",
  "决定.case": "--case",
  "队列.item.stage": "--stage",
  "队列.item.content": "说明",
  "队列.id": "说明",
  "主线.part": "说明",
  "主线.revision": "--revision",
  "当场做.evidence": "说明",
  "不处理.reason": "说明",
};

/** 去处对应的说明该怎么写，取 errors.detailHints 里的一条。键是「去处.字段」。 */
const detailHintOf: Readonly<Record<string, keyof typeof errors.detailHints>> = {
  "队列.item.content": "queue",
  "队列.id": "queue",
  "主线.part": "mainline",
  "当场做.evidence": "doneHere",
  "不处理.reason": "noAction",
};

type Entry = Readonly<Record<string, unknown>>;

const isObject = (value: unknown): value is Entry =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** 文件里写的是一个数组，或者只处理一行时写一个对象。别的写法报错。 */
export function entriesOf(parsed: unknown, file: string): Result<unknown[], ErrorBody> {
  if (Array.isArray(parsed)) return ok(parsed);
  if (isObject(parsed)) return ok([parsed]);
  const e = errors.fileShape;
  return err(
    errorBody("BAD_REQUEST", [
      { message: renderCopy(e.message, { file }), hint: renderCopy(e.hint), where: file },
    ]),
  );
}

/** 第几行：处理的行号，文件里没写行号时按第几项。 */
function lineName(entries: readonly unknown[], index: number): string {
  const entry = entries[index];
  const line = isObject(entry) ? entry.line : undefined;
  return typeof line === "number"
    ? renderCopy(errors.at.line, { line })
    : renderCopy(errors.at.item, { n: index + 1 });
}

/** 一个位置写成 [0].item.stage 这样的，换成「第 3 行的 --stage」。 */
function placeOf(entries: readonly unknown[], index: number, field: string, args: boolean): string {
  const line = lineName(entries, index);
  const entry = entries[index];
  // 行号本身没问题、问题出在这一行的去处上时，位置就是这一行，不写「第 3 行的 line」。
  const lineIsNumber = isObject(entry) && typeof entry.line === "number";
  if (field === "" || (field === "line" && lineIsNumber)) return line;
  const to = isObject(entry) && typeof entry.to === "string" ? entry.to : "";
  const name = args ? (optionOf[`${to}.${field}`] ?? field) : field;
  return renderCopy(errors.at.field, { line, field: name });
}

/** 后端回来的报错，把数组下标改成第几行，再把泛泛的怎么改换成这个字段该怎么写。 */
export function readableError(
  error: ErrorBody,
  entries: readonly unknown[],
  args: boolean,
): ErrorBody {
  const generic = renderCopy(errorCodeCopyOf("BAD_REQUEST").hint);
  const mapped = issuesOf(error).map((issue): Issue => {
    const at = /^\[(\d+)\]\.?(.*)$/u.exec(issue.where ?? "");
    if (at === null) return issue;
    const index = Number(at[1]);
    const field = at[2] ?? "";
    const message = issue.message.replace(
      /\[(\d+)\]\.?([^\s「」，。、：（）]*)/gu,
      (_all, n: string, name: string) => placeOf(entries, Number(n), name, args),
    );
    const entry = entries[index];
    const to = isObject(entry) && typeof entry.to === "string" ? entry.to : "";
    const key = detailHintOf[`${to}.${field}`];
    const hint =
      issue.hint === generic
        ? renderCopy(key === undefined ? errors.entryHint : errors.detailHints[key])
        : issue.hint;
    return { ...issue, message, hint, where: placeOf(entries, index, field, args) };
  });
  const [first, ...rest] = mapped;
  if (first === undefined) return error;
  return errorBody(error.code, [first, ...rest]);
}

/**
 * 发出去以前查一遍：决定三项缺了按规矩 decision.fields 拦截，
 * 队列里放进新的一件没写阶段，说明要写 --stage。返回第一类有问题的，都没问题时返回 undefined。
 */
export function checkEntries(entries: readonly unknown[], args: boolean): ErrorBody | undefined {
  const blocked: Issue[] = [];
  const invalid: Issue[] = [];
  entries.forEach((entry, index) => {
    if (!isObject(entry)) return;
    if (entry.to === "决定") {
      for (const issue of checkDecisionFields(entry)) {
        const field = issue.where ?? "";
        blocked.push({
          ...issue,
          hint: renderCopy(errors.decisionHint),
          where: placeOf(entries, index, field, args),
        });
      }
    }
    const item = entry.item;
    if (
      entry.to === "队列" &&
      isObject(item) &&
      (item.stage === undefined || item.stage === null)
    ) {
      invalid.push({
        message: renderCopy(errors.stageMissing.message, { line: lineName(entries, index) }),
        hint: renderCopy(errors.stageMissing.hint),
        where: placeOf(entries, index, "item.stage", args),
      });
    }
  });
  const [b, ...b2] = blocked;
  if (b !== undefined) return errorBody("RULE_BLOCKED", [b, ...b2]);
  const [i, ...i2] = invalid;
  return i === undefined ? undefined : errorBody("BAD_REQUEST", [i, ...i2]);
}
