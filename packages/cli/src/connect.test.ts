import { existsSync } from "node:fs";
import { errorBody, errorCodeInfo } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import { backendEntry, callFailure, connect } from "./connect.ts";

describe("后端的入口", () => {
  it("开发时是源码里后端的 main.ts，从命令行自己的位置找到", () => {
    const entry = backendEntry({}, "/anywhere");
    expect(entry.endsWith("/packages/backend/src/main.ts")).toBe(true);
    expect(existsSync(entry)).toBe(true);
  });

  it("PLOOP_BACKEND_ENTRY 优先，相对路径按当前目录展开", () => {
    const env = { PLOOP_BACKEND_ENTRY: "dist/backend.mjs" };
    expect(backendEntry(env, "/work")).toBe("/work/dist/backend.mjs");
    expect(backendEntry({ PLOOP_BACKEND_ENTRY: "/opt/b.mjs" }, "/work")).toBe("/opt/b.mjs");
  });
});

describe("调用接口失败时的报错", () => {
  const logFile = "/h/logs/backend.log";

  it("后端起不来：退出码 5，写明原因和怎么改", () => {
    const failure = {
      kind: "nodeTooOld",
      node: "/n",
      current: "22.11.0",
      required: "24.12.0",
    } as const;
    const error = callFailure(failure, logFile);
    expect(error).toEqual({
      code: "INTERNAL",
      message: "本机的 Node 版本是 22.11.0，低于需要的 24.12.0。",
      hint: "运行 ploop setup，重新绑定 Node。",
    });
    expect(errorCodeInfo(error.code).exit).toBe(5);
  });

  it("拉起以后没拿到应答：退出码 5，位置写日志文件", () => {
    const error = callFailure(
      { unreachable: "timeout", detail: "The operation timed out." },
      logFile,
    );
    expect(error).toMatchObject({
      code: "INTERNAL",
      message: "没有收到后端的应答：The operation timed out.",
      where: logFile,
    });
    expect(errorCodeInfo(error.code).exit).toBe(5);
  });

  it("后端给出的报错照原样", () => {
    const body = errorBody("NOT_FOUND", [{ message: "没有叫「x」的项目。" }]);
    expect(callFailure(body, logFile)).toBe(body);
  });
});

describe("会话标识 PLOOP_SESSION", () => {
  const backendFor = (session: string) =>
    connect({
      cwd: "/nowhere",
      userHome: "/nowhere",
      env: { PLOOP_HOME: "/nowhere/.product-loop", PLOOP_SESSION: session },
      notice: () => undefined,
    });

  it.each(["会话甲", "sess 甲", "a b", "s\u00e9ss"])(
    "写了中文或别的非英文字符「%s」：不发请求，按用法错误报，写怎么改（F22）",
    async (value) => {
      const backend = backendFor(value);
      const call = await backend.call(async () => {
        throw new Error("不该发请求");
      });
      expect(call).toEqual({
        ok: false,
        error: {
          code: "BAD_REQUEST",
          message: `环境变量 PLOOP_SESSION 的值「${value}」里有中文或别的非英文字符。`,
          hint: "只写英文字母、数字和短横，例如 PLOOP_SESSION=sessA。",
        },
      });
      const raw = await backend.raw("/api/v1/projects");
      expect(raw.ok).toBe(false);
      expect(!raw.ok && errorCodeInfo(raw.error.code).exit).toBe(2);
    },
  );
});
