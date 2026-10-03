// 事件流，见「06 工作台」第九节和「05 接口」第五节。
// 收到事件就让对应的查询重取。断线以后浏览器自己重连，连上以后全部查询重取一次，断线期间漏掉的变化由此补上。
// 后端拒绝时浏览器不再重连，这里隔几秒重新打开。
import { streamEventNames, streamEventSchema } from "@product-loop/model";
import type { QueryClient } from "@tanstack/react-query";
import { keysOf } from "./query-keys.ts";

/** 连接的状态：还没连上、连着、断了在重连。 */
export type Connection = "connecting" | "open" | "lost";

/** EventSource 里用到的部分，测试时换成假的。 */
export type EventSourceLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onerror: ((event: Event) => void) | null;
  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
};

type Options = {
  readonly onStatus: (status: Connection) => void;
  readonly open?: (url: string) => EventSourceLike;
  /** 后端拒绝以后隔多久重新打开，毫秒。 */
  readonly retryMs?: number;
  readonly setTimer?: (run: () => void, ms: number) => () => void;
};

const closed = 2;

/** 订阅事件流，返回取消订阅。 */
export function subscribeEvents(queryClient: QueryClient, options: Options): () => void {
  const open = options.open ?? ((url) => new EventSource(url) as EventSourceLike);
  const setTimer =
    options.setTimer ??
    ((run, ms) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    });
  let source: EventSourceLike | undefined;
  let cancelRetry: (() => void) | undefined;
  let everLost = false;
  let stopped = false;

  const connect = () => {
    const current = open("/api/v1/events");
    source = current;
    current.onopen = () => {
      options.onStatus("open");
      if (everLost) void queryClient.invalidateQueries();
      everLost = false;
    };
    current.onerror = () => {
      everLost = true;
      options.onStatus("lost");
      if (current.readyState === closed && !stopped) {
        current.close();
        cancelRetry = setTimer(connect, options.retryMs ?? 3_000);
      }
    };
    for (const name of streamEventNames) {
      current.addEventListener(name, (message) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(message.data);
        } catch {
          return;
        }
        const event = streamEventSchema.safeParse(parsed);
        if (!event.success) return;
        for (const queryKey of keysOf(name, event.data)) {
          void queryClient.invalidateQueries({ queryKey });
        }
      });
    }
  };

  options.onStatus("connecting");
  connect();
  return () => {
    stopped = true;
    cancelRetry?.();
    source?.close();
  };
}
