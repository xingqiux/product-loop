import { renderCopy } from "@product-loop/model";
import { processCopy } from "../copy/process.ts";
import type { Busy, GlobalWork, ProcessGate } from "../http/deps.ts";
import type { Logger } from "./log.ts";

// 后端进程的状态：在不在做全局操作，是不是在退出。接口层据此返回 BUSY、关掉用完的连接。
// 全局操作见「01 架构」第七节：迁移数据、从快照恢复。这期间写请求和 shutdown 返回 BUSY，
// 并带 Retry-After，命令行按它重试，最多六十秒。每日快照不算全局操作，快照期间写请求等它做完。

export type ProcessState = ProcessGate & {
  /** 开始退出。之后的响应都带 Connection: close。 */
  readonly markStopping: () => void;
};

export function createProcessState(options: {
  readonly now: () => Date;
  readonly log?: Logger | undefined;
}): ProcessState {
  const { now, log } = options;
  let busy: Busy | undefined;
  let stopping = false;
  const listeners = new Set<() => void>();
  const during = async <T>(work: GlobalWork, task: () => Promise<T>): Promise<T> => {
    // 全局操作期间写请求都返回 BUSY，发起第二件的请求走不到这里。走到了就是程序写错了。
    if (busy !== undefined) throw new Error(`已经在做 ${busy.work}，同时只能做一件全局操作。`);
    const since = now();
    busy = { work, since };
    const label = renderCopy(processCopy.busy.task[work]);
    log?.info("busyBegin", {
      message: renderCopy(processCopy.log.busyBegin, { task: label }),
      work,
    });
    try {
      return await task();
    } finally {
      busy = undefined;
      const seconds = Math.round((now().getTime() - since.getTime()) / 1000);
      const message = renderCopy(processCopy.log.busyEnd, { task: label, seconds });
      log?.info("busyEnd", { message, work, seconds });
    }
  };
  return {
    busy: () => busy,
    stopping: () => stopping,
    onStopping: (listener) => {
      if (stopping) {
        listener();
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    during,
    markStopping: () => {
      stopping = true;
      for (const listener of listeners) listener();
      listeners.clear();
    },
  };
}
