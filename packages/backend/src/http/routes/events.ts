import { eventsQuerySchema, type StreamEvent, streamEventOf } from "@product-loop/model";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { StoredEvent } from "../../core/events.ts";
import type { AppDeps } from "../deps.ts";
import { queryParams } from "../validate.ts";

// GET /events：工作台订阅的事件流，见「05 接口」第五节。
// 事件在事务提交以后由通知发来，所以工作台收到时数据已经能读到。
// 每十五秒写一行注释保持连接。后端开始退出或浏览器断开时结束。
// 断线重连不补发：工作台重连以后让全部查询重取，所以不看 Last-Event-ID。

/** 保持连接的注释行多久写一次。 */
export const heartbeatMs = 15_000;

/** 事件表的一行写成事件流里的内容。 */
function payloadOf(event: StoredEvent): StreamEvent {
  return {
    kind: event.kind,
    project: event.projectId,
    objectType: event.objectType,
    objectId: event.objectId,
    at: event.createdAt.toISOString(),
  };
}

export function eventRoutes(deps: AppDeps) {
  return new Hono().get("/events", queryParams(eventsQuerySchema), (c) => {
    const { project } = c.req.valid("query");
    return streamSSE(c, async (stream) => {
      const pending: StoredEvent[] = [];
      let beat = false;
      let done = false;
      let wake: (() => void) | undefined;
      const poke = () => wake?.();
      const finish = () => {
        done = true;
        poke();
      };
      const off = deps.notifier.subscribe((event) => {
        if (project !== undefined && event.projectId !== project) return;
        pending.push(event);
        poke();
      });
      const offStopping = deps.process.onStopping(finish);
      stream.onAbort(finish);
      let timer: unknown;
      const tick = () => {
        beat = true;
        poke();
        timer = deps.waitClock.setTimeout(tick, heartbeatMs);
      };
      timer = deps.waitClock.setTimeout(tick, heartbeatMs);
      try {
        // 先写一行，响应头随之发出，浏览器的 EventSource 由此知道连上了
        await stream.write(": open\n\n");
        while (!done) {
          if (pending.length === 0 && !beat) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = undefined;
            continue;
          }
          if (beat) {
            beat = false;
            await stream.write(": keepalive\n\n");
          }
          for (const event of pending.splice(0)) {
            const name = streamEventOf(event.kind);
            if (name === undefined) continue;
            await stream.writeSSE({
              id: String(event.id),
              event: name,
              data: JSON.stringify(payloadOf(event)),
            });
          }
        }
      } finally {
        off();
        offStopping();
        deps.waitClock.clearTimeout(timer);
      }
    });
  });
}
