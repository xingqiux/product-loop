import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogFields, Logger } from "./log.ts";
import { createStopper, type StopTarget } from "./stop.ts";

// 后端的退出，见「01 架构」第六节。服务、快照和收尾都换成假的，时钟也是假的。
// 真的进程收到 SIGTERM 以后五秒内退出，在 main.use.test.ts 里用子进程测。

const timing = { graceMs: 4000, sweepMs: 25 };

type Fake = {
  readonly target: StopTarget;
  /** 按先后记下的每一步。 */
  readonly steps: string[];
  /** 日志的事件，按先后。 */
  readonly events: string[];
  /** 手上的请求都做完了：服务的 close 回调被调用。 */
  drain(): void;
  snapshot: boolean;
};

function fake(): Fake {
  const steps: string[] = [];
  const events: string[] = [];
  let onClosed: (() => void) | undefined;
  const record = (event: string, _fields: LogFields) => {
    events.push(event);
  };
  const log: Logger = {
    file: "/tmp/ploop-home/logs/backend.log",
    info: record,
    warn: record,
    error: record,
    close: () => steps.push("closeLog"),
  };
  const state: Fake = {
    steps,
    events,
    snapshot: false,
    drain: () => onClosed?.(),
    target: {
      server: {
        close: ((callback?: () => void) => {
          steps.push("close");
          onClosed = callback;
        }) as StopTarget["server"]["close"],
        closeIdleConnections: () => steps.push("closeIdle"),
        closeAllConnections: () => steps.push("closeAll"),
      },
      snapshotRunning: () => state.snapshot,
      markStopping: () => steps.push("markStopping"),
      cleanup: [() => steps.push("closeDatabase"), () => steps.push("removeRunInfo")],
      log,
      exit: (code) => steps.push(`exit ${code}`),
    },
  };
  return state;
}

/** 去掉定时关空闲连接的那几步，只看顺序。 */
const main = (steps: readonly string[]) => steps.filter((step) => step !== "closeIdle");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("后端的退出", () => {
  it("不再接新连接，手上的请求做完以后收尾：关库、删 backend.json，再以 0 退出", async () => {
    const f = fake();
    const stopped = createStopper(f.target, timing).stop("SIGTERM");
    expect(main(f.steps)).toEqual(["markStopping", "close"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(main(f.steps)).toEqual(["markStopping", "close"]);
    f.drain();
    await vi.advanceTimersByTimeAsync(timing.sweepMs);
    await stopped;
    expect(main(f.steps)).toEqual([
      "markStopping",
      "close",
      "closeDatabase",
      "removeRunInfo",
      "closeLog",
      "exit 0",
    ]);
    expect(f.events).toEqual(["stopping", "stopped"]);
  });

  it("退出期间定时关掉空闲下来的连接", async () => {
    const f = fake();
    void createStopper(f.target, timing).stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(timing.sweepMs * 4);
    expect(f.steps.filter((step) => step === "closeIdle")).toHaveLength(4);
  });

  it("到了时限请求还没做完：断开全部连接，照样收尾退出，日志写明", async () => {
    const f = fake();
    const stopped = createStopper(f.target, timing).stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(timing.graceMs + timing.sweepMs);
    await stopped;
    expect(main(f.steps)).toEqual([
      "markStopping",
      "close",
      "closeAll",
      "closeDatabase",
      "removeRunInfo",
      "closeLog",
      "exit 0",
    ]);
    expect(f.events).toEqual(["stopping", "forced", "stopped"]);
  });

  it("今天的快照还在做：等它做完再关库", async () => {
    const f = fake();
    f.snapshot = true;
    const stopped = createStopper(f.target, timing).stop("request");
    f.drain();
    await vi.advanceTimersByTimeAsync(1000);
    expect(main(f.steps)).toEqual(["markStopping", "close"]);
    f.snapshot = false;
    await vi.advanceTimersByTimeAsync(timing.sweepMs);
    await stopped;
    expect(main(f.steps).slice(2)).toEqual([
      "closeDatabase",
      "removeRunInfo",
      "closeLog",
      "exit 0",
    ]);
    expect(f.events).toEqual(["stopping", "stopped"]);
  });

  it("第二次收到停止信号：不再等，马上断开连接收尾", async () => {
    const f = fake();
    const stopper = createStopper(f.target, timing);
    const first = stopper.stop("SIGTERM");
    await vi.advanceTimersByTimeAsync(100);
    const second = stopper.stop("SIGINT");
    expect(second).toBe(first);
    await first;
    expect(main(f.steps)).toEqual([
      "markStopping",
      "close",
      "closeAll",
      "closeDatabase",
      "removeRunInfo",
      "closeLog",
      "exit 0",
    ]);
  });

  it("退出的请求来了两次：只退一次，第二次不催", async () => {
    const f = fake();
    const stopper = createStopper(f.target, timing);
    const first = stopper.stop("request");
    expect(stopper.stop("request")).toBe(first);
    f.drain();
    await vi.advanceTimersByTimeAsync(timing.sweepMs);
    await first;
    expect(f.steps.filter((step) => step.startsWith("exit"))).toEqual(["exit 0"]);
    expect(f.steps).not.toContain("closeAll");
  });

  it("收尾的一步出错：记进日志，后面的步骤照做，照样退出", async () => {
    const f = fake();
    const target: StopTarget = {
      ...f.target,
      cleanup: [
        () => {
          throw new Error("disk I/O error");
        },
        () => f.steps.push("removeRunInfo"),
      ],
    };
    const stopped = createStopper(target, timing).stop("SIGTERM");
    f.drain();
    await vi.advanceTimersByTimeAsync(timing.sweepMs);
    await stopped;
    expect(main(f.steps).slice(2)).toEqual(["removeRunInfo", "closeLog", "exit 0"]);
    expect(f.events).toEqual(["stopping", "cleanupFailed", "stopped"]);
  });
});
