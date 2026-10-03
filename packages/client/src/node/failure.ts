import { backendCopy, type ErrorBody, type Issue, renderCopy } from "@product-loop/model";
import { nodeCopy } from "./copy.ts";

// 后端起不来的几种原因。命令行都按「后端起不来」处理，以退出码 5 结束，
// 见「01 架构」第八节和约定 0002 第 7 条。failureIssue 把原因写成报错：什么不对、怎么改。

/** 本机的 Node 版本低于要求，不拉起后端。 */
export type NodeTooOld = {
  readonly kind: "nodeTooOld";
  /** 要用来运行后端的 Node。 */
  readonly node: string;
  /** 它的版本，例如 22.11.0。 */
  readonly current: string;
  /** 需要的最低版本。 */
  readonly required: string;
};

type StartFailedCommon = {
  readonly kind: "startFailed";
  /** 从拉起到放弃等了多久，毫秒。没有拉起时是 0。 */
  readonly waitedMs: number;
  /** 日志里这一次拉起以后写的最后几行，已写成给人看的中文。 */
  readonly logTail: readonly string[];
  readonly logFile: string;
  /** 用来运行后端的 Node，和后端的入口文件。 */
  readonly node: string;
  readonly entry: string;
};

/** 起不来的具体原因。 */
export type StartFailedReason =
  | {
      /** 进程退出了。退出码的含义见共用定义的 backendExitCode，被信号结束时没有退出码。 */
      readonly reason: "exited";
      readonly exitCode?: number;
      readonly signal?: string;
    }
  /** 到时没有就绪，进程还在。它可能还在迁移数据库，所以不结束它。 */
  | { readonly reason: "timeout" }
  /** 没能运行 Node。 */
  | { readonly reason: "spawnFailed"; readonly detail: string }
  /** 入口文件不在。 */
  | { readonly reason: "entryMissing" };

/** 拉起了，却没有开始服务；或者根本拉不起来。 */
export type StartFailed = StartFailedCommon & StartFailedReason;

/** 旧后端没能退出的具体原因。 */
type ReplaceFailedReason =
  /** 它没有答应退出，例如六十秒内一直在做快照。error 是它的回答。 */
  | { readonly reason: "refused"; readonly error: ErrorBody }
  /** 答应了，却一直没有结束。 */
  | { readonly reason: "stillRunning"; readonly waitedMs: number };

/** 构建号不同，旧后端没能退出。 */
export type ReplaceFailed = {
  readonly kind: "replaceFailed";
  /** 旧后端的进程号和构建号。 */
  readonly pid: number;
  readonly build: string;
} & ReplaceFailedReason;

/** 拉起的后端和命令行的构建号不同：入口文件来自另一次构建。 */
export type BuildMismatch = {
  readonly kind: "buildMismatch";
  readonly expected: string;
  readonly actual: string;
  readonly pid: number;
  readonly entry: string;
};

export type EnsureFailure = NodeTooOld | StartFailed | ReplaceFailed | BuildMismatch;

/** 调用接口的失败是不是后端起不来。另两种是后端给出的报错和连不上，见 client.ts 的 CallError。 */
export function isEnsureFailure(error: object): error is EnsureFailure {
  return "kind" in error;
}

/** 等过了这么多秒才放弃的，报错里写明等了几秒。八秒以内的用「八秒内没有就绪」的说法。 */
const readySeconds = 8;

/** 写成报错：什么不对、怎么改。拉起过的，位置写日志文件。 */
export function failureIssue(failure: EnsureFailure): Issue {
  switch (failure.kind) {
    case "nodeTooOld": {
      const { message, hint } = backendCopy.nodeTooOld;
      const { current, required } = failure;
      return { message: renderCopy(message, { current, required }), hint: renderCopy(hint) };
    }
    case "startFailed":
      return startFailedIssue(failure);
    case "replaceFailed":
      return replaceFailedIssue(failure);
    case "buildMismatch": {
      const { message, hint } = nodeCopy.failure.buildMismatch;
      const { actual, expected } = failure;
      return { message: renderCopy(message, { actual, expected }), hint: renderCopy(hint) };
    }
  }
}

function startFailedIssue(failure: StartFailed): Issue {
  const words = nodeCopy.failure;
  const where = failure.logFile;
  const logTail =
    failure.logTail.length > 0 ? failure.logTail.join("\n") : renderCopy(nodeCopy.log.none);
  switch (failure.reason) {
    case "entryMissing": {
      const { message, hint } = words.entryMissing;
      return { message: renderCopy(message, { entry: failure.entry }), hint: renderCopy(hint) };
    }
    case "spawnFailed": {
      const { message, hint } = words.spawnFailed;
      const params = { node: failure.node, detail: failure.detail };
      return { message: renderCopy(message, params), hint: renderCopy(hint) };
    }
    case "exited": {
      if (failure.exitCode === undefined) {
        const { message, hint } = words.killed;
        const params = { signal: failure.signal ?? "", logTail };
        return { message: renderCopy(message, params), hint: renderCopy(hint), where };
      }
      const { message, hint } = words.exited;
      const params = { code: failure.exitCode, logTail };
      return { message: renderCopy(message, params), hint: renderCopy(hint), where };
    }
    case "timeout": {
      const seconds = Math.round(failure.waitedMs / 1000);
      if (seconds <= readySeconds) {
        const { message, hint } = backendCopy.startFailed;
        return { message: renderCopy(message, { logTail }), hint: renderCopy(hint), where };
      }
      const { message, hint } = words.slow;
      return { message: renderCopy(message, { seconds, logTail }), hint: renderCopy(hint), where };
    }
  }
}

function replaceFailedIssue(failure: ReplaceFailed): Issue {
  const words = nodeCopy.failure;
  if (failure.reason === "refused") {
    const { message, hint } = words.replaceRefused;
    return {
      message: renderCopy(message, { answer: failure.error.message }),
      hint: renderCopy(hint),
    };
  }
  const { message, hint } = words.stillRunning;
  const seconds = Math.round(failure.waitedMs / 1000);
  return {
    message: renderCopy(message, { seconds, pid: failure.pid }),
    hint: renderCopy(hint, { pid: failure.pid }),
  };
}
