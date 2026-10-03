import type { Server } from "node:http";
import { renderCopy } from "@product-loop/model";
import { processCopy } from "../copy/process.ts";
import type { Logger } from "./log.ts";

// 后端的退出，见「01 架构」第六节：不再接新请求，等手上的请求做完，最多等五秒，
// 然后关闭数据库、删除 run/backend.json。停止信号和 POST /admin/shutdown 都走这里。
// 手上的请求做完、今天的快照也做完，就收尾退出。到了时限还没做完，断开全部连接再收尾。
// 收尾依次是：关数据库、删 backend.json、放开实例锁。这些做完再放开锁，下一个后端才能启动。
// 第二次收到停止信号时不再等，马上断开连接收尾，前台运行时连按两次 Ctrl-C 就能退出。

export type StopReason = "SIGTERM" | "SIGINT" | "request";

export type StopTarget = {
  readonly server: Pick<Server, "close" | "closeIdleConnections" | "closeAllConnections">;
  /** 今天的快照还在做。退出前等它做完，也算在时限里。 */
  readonly snapshotRunning: () => boolean;
  /** 开始退出。之后的响应都带 Connection: close。 */
  readonly markStopping: () => void;
  /** 服务停下以后依次执行。一步出错只记日志，后面的照样执行。 */
  readonly cleanup: readonly (() => void)[];
  readonly log: Logger;
  /** 收尾以后结束进程。进程入口传 process.exit，测试传假的。 */
  readonly exit: (code: number) => void;
};

export type StopTiming = {
  /** 等手上的请求和快照做完，最多等多久，毫秒。要在五秒内退出，留出收尾的时间。 */
  readonly graceMs: number;
  /** 退出期间每隔多久关一次空闲的连接，也是查快照做完没有的间隔，毫秒。 */
  readonly sweepMs: number;
};

export type Stopper = {
  /** 开始退出。已经在退出时，停止信号让它不再等，退出的请求什么也不改。 */
  readonly stop: (reason: StopReason) => Promise<void>;
};

export function createStopper(target: StopTarget, timing: StopTiming): Stopper {
  let stopping: Promise<void> | undefined;
  let hurry: (() => void) | undefined;
  const run = async (reason: StopReason) => {
    const { server, log } = target;
    target.markStopping();
    const why =
      reason === "request"
        ? renderCopy(processCopy.reason.request)
        : renderCopy(processCopy.reason.signal, { signal: reason });
    log.info("stopping", {
      message: renderCopy(processCopy.log.stopping, { reason: why }),
      reason,
    });
    const startedAt = Date.now();
    const hurried = new Promise<"forced">((resolve) => {
      hurry = () => resolve("forced");
    });
    let serverClosed = false;
    server.close(() => {
      serverClosed = true;
    });
    // 关掉 server 时空闲的连接已经关了。之后才空下来的连接，由这里定时关掉。
    let settled = false;
    const done = () => settled || (serverClosed && !target.snapshotRunning());
    const outcome = await Promise.race([
      poll(done, timing.sweepMs, () => server.closeIdleConnections(), timing.graceMs),
      hurried,
    ]);
    // 不再等了，定时检查也停下。
    settled = true;
    if (outcome !== "done") {
      server.closeAllConnections();
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      log.warn("forced", { message: renderCopy(processCopy.log.forced, { seconds }) });
    }
    for (const step of target.cleanup) {
      try {
        step();
      } catch (error) {
        log.error("cleanupFailed", { message: renderCopy(processCopy.log.cleanupFailed), error });
      }
    }
    log.info("stopped", { message: renderCopy(processCopy.log.stopped) });
    log.close();
    target.exit(0);
  };
  return {
    stop: (reason) => {
      if (stopping === undefined) {
        stopping = run(reason);
      } else if (reason !== "request") {
        hurry?.();
      }
      return stopping;
    },
  };
}

/**
 * 每隔 everyMs 执行一次 tick，再看 done。done 了返回 "done"，过了 limitMs 返回 "timeout"。
 * 先看一次 done：已经做完时不等。
 */
async function poll(
  done: () => boolean,
  everyMs: number,
  tick: () => void,
  limitMs: number,
): Promise<"done" | "timeout"> {
  const deadline = Date.now() + limitMs;
  while (!done()) {
    if (Date.now() >= deadline) return "timeout";
    await new Promise((resolve) => setTimeout(resolve, everyMs));
    tick();
  }
  return "done";
}
