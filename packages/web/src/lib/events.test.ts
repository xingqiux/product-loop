import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { type Connection, type EventSourceLike, subscribeEvents } from "./events.ts";
import { keys } from "./query-keys.ts";

// 事件流：收到事件让对应的查询重取，断线重连以后全部重取。

class FakeSource implements EventSourceLike {
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();

  addEventListener(name: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(name, listener);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  emit(name: string, data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.listeners.get(name)?.({ data: payload } as MessageEvent<string>);
  }
}

function setup() {
  const queryClient = new QueryClient();
  const sources: FakeSource[] = [];
  const statuses: Connection[] = [];
  const timers: (() => void)[] = [];
  const stop = subscribeEvents(queryClient, {
    onStatus: (status) => statuses.push(status),
    open: () => {
      const source = new FakeSource();
      sources.push(source);
      return source;
    },
    setTimer: (run) => {
      timers.push(run);
      return () => {};
    },
  });
  for (const key of [keys.queue("app"), keys.decisions("app"), keys.projects, keys.queue("web")]) {
    queryClient.setQueryData(key, 1);
  }
  const stale = () =>
    queryClient
      .getQueryCache()
      .getAll()
      .filter((query) => query.isStale() && query.state.isInvalidated)
      .map((query) => JSON.stringify(query.queryKey))
      .sort();
  return { queryClient, sources, statuses, timers, stop, stale };
}

/** 页面上会开着的几个查询：各版的进度、这个阶段、状态。 */
function queryKeys(queryClient: QueryClient): void {
  for (const project of ["app", "web"]) {
    for (const key of [keys.versions(project), keys.rounds(project), keys.status(project)]) {
      queryClient.setQueryData(key, 1);
    }
  }
}

const event = (project: string) => ({
  kind: "queue.moved",
  project,
  objectType: "queueItem",
  objectId: "7",
  at: "2026-09-29T08:00:00.000+08:00",
});

describe("事件流", () => {
  it("队列变了：这个项目的队列和所有项目的列表重取，别的不动", () => {
    const t = setup();
    t.sources[0]?.emit("queue.changed", event("app"));
    expect(t.stale()).toEqual(['["project","app","queue"]', '["projects"]']);
  });

  it("提交、给出页面这类让阶段的状态变了的事件：页头的阶段条和各版的进度也重取", () => {
    for (const name of ["submission.created", "page.presented", "page.withdrawn"]) {
      const t = setup();
      queryKeys(t.queryClient);
      t.sources[0]?.emit(name, event("app"));
      expect(t.stale(), name).toEqual(
        expect.arrayContaining(['["project","app","versions"]', '["project","app","rounds"]']),
      );
      expect(t.stale(), name).not.toContain('["project","web","versions"]');
    }
  });

  it("内容不对的事件不理", () => {
    const t = setup();
    t.sources[0]?.emit("queue.changed", "不是 JSON");
    t.sources[0]?.emit("queue.changed", { project: "app" });
    expect(t.stale()).toEqual([]);
  });

  it("断线重连以后全部重取；第一次连上不重取", () => {
    const t = setup();
    const source = t.sources[0] as FakeSource;
    source.onopen?.(new Event("open"));
    expect(t.stale()).toEqual([]);
    source.onerror?.(new Event("error"));
    source.onopen?.(new Event("open"));
    expect(t.stale()).toHaveLength(4);
    expect(t.statuses).toEqual(["connecting", "open", "lost", "open"]);
  });

  it("后端拒绝以后隔一会儿重新打开；取消订阅以后关掉", () => {
    const t = setup();
    const first = t.sources[0] as FakeSource;
    first.readyState = 2;
    first.onerror?.(new Event("error"));
    expect(t.timers).toHaveLength(1);
    t.timers[0]?.();
    expect(t.sources).toHaveLength(2);
    t.stop();
    expect(t.sources[1]?.closed).toBe(true);
  });
});
