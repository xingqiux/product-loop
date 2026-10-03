import { describe, expect, it } from "vitest";
import type { WaitClock } from "../../core/replies/wait.ts";
import { addProject } from "../../core/testing.ts";
import type { ProcessGate } from "../deps.ts";
import { host, testApp } from "../testing.ts";
import { heartbeatMs } from "./events.ts";

// 事件流：提交以后发、按项目筛、保持连接的注释行、后端退出时结束。

/** 打开事件流，逐段读出文字。 */
async function open(app: Awaited<ReturnType<typeof testApp>>["app"], path = "/api/v1/events") {
  const abort = new AbortController();
  const response = await app.request(path, { headers: { host }, signal: abort.signal });
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("事件流没有内容");
  const decoder = new TextDecoder();
  let buffer = "";
  /** 读到出现 text 为止，返回读到的全部文字。 */
  const until = async (text: string) => {
    while (!buffer.includes(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    return buffer;
  };
  /** 读到流结束。 */
  const end = async () => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return buffer;
      buffer += decoder.decode(value, { stream: true });
    }
  };
  return { response, until, end, close: () => abort.abort() };
}

/** 假的计时器：记下要定时执行的函数，由测试手动触发。 */
function fakeClock() {
  const fires: (() => void)[] = [];
  const clock: WaitClock = {
    setTimeout: (fire, ms) => {
      expect(ms).toBe(heartbeatMs);
      fires.push(fire);
      return fires.length;
    },
    clearTimeout: () => {},
  };
  return { clock, fire: () => fires.at(-1)?.() };
}

describe("GET /events", () => {
  it("连上以后先写一行注释，响应是服务器推送事件", async () => {
    const t = await testApp();
    const stream = await open(t.app);
    expect(stream.response.headers.get("Content-Type")).toContain("text/event-stream");
    expect(await stream.until(": open")).toContain(": open");
    stream.close();
  });

  it("提交以后发出，按前缀归到事件流的事件，带编号和内容", async () => {
    const t = await testApp();
    const stream = await open(t.app);
    await stream.until(": open");
    addProject(t.core, "/work/app");
    const text = await stream.until("project.registered");
    expect(text).toContain("event: project.changed\n");
    expect(text).toContain(
      'data: {"kind":"project.registered","project":"app","objectType":"project"',
    );
    expect(text).toMatch(/\nid: \d+\n/u);
    stream.close();
  });

  it("写了项目时只发这个项目的", async () => {
    const t = await testApp();
    const stream = await open(t.app, "/api/v1/events?project=b");
    await stream.until(": open");
    addProject(t.core, "/work/a");
    addProject(t.core, "/work/b");
    const text = await stream.until('"project":"b"');
    expect(text).not.toContain('"project":"a"');
    stream.close();
  });

  it("每十五秒写一行注释保持连接", async () => {
    const { clock, fire } = fakeClock();
    const t = await testApp({ waitClock: clock });
    const stream = await open(t.app);
    await stream.until(": open");
    fire();
    expect(await stream.until(": keepalive")).toContain(": keepalive");
    stream.close();
  });

  it("后端开始退出时结束", async () => {
    const listeners: (() => void)[] = [];
    const process: ProcessGate = {
      busy: () => undefined,
      stopping: () => false,
      onStopping: (listener) => {
        listeners.push(listener);
        return () => {};
      },
      during: (_work, task) => task(),
    };
    const t = await testApp({ process });
    const stream = await open(t.app);
    await stream.until(": open");
    for (const listener of listeners) listener();
    expect(await stream.end()).toBe(": open\n\n");
  });
});
