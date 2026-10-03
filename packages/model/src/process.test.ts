import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  backendExitCode,
  defaultPort,
  envPort,
  instanceLockFileName,
  isNodeTooOld,
  logDirName,
  logFileName,
  logLineSchema,
  parseRunInfo,
  type RunInfo,
  requiredNode,
  resolveHome,
  rotatedLogFileName,
  runDirName,
  runInfoFileName,
  runInfoSchema,
  startLockFileName,
} from "./process.ts";

// 后端进程和命令行共用的约定，见「01 架构」第六节和第八节。两边都从这里取，不各写一份。

const info: RunInfo = {
  pid: 51234,
  port: 4731,
  build: "dev",
  schemaVersion: 1790000000000,
  startedAt: "2026-09-28T08:00:00.000Z",
  home: "/tmp/ploop-home",
  node: "v24.20.0",
  entry: "/work/product-loop/packages/backend/src/main.ts",
};

/** 环境变量名是全大写，Biome 的命名规则不许写进对象字面量，所以这样拼。 */
const ploopPort = (value: string) => ({ PLOOP_PORT: value });

describe("集中存储里的文件", () => {
  it("run/ 下是运行信息和两把锁，logs/ 下是日志，名字和「01 架构」第六节相同", () => {
    expect([runDirName, runInfoFileName, instanceLockFileName, startLockFileName]).toEqual([
      "run",
      "backend.json",
      "backend.lock",
      "start.lock",
    ]);
    expect([logDirName, logFileName]).toEqual(["logs", "backend.log"]);
  });

  it("轮转下来的日志依次是 backend.log.1、.2、.3", () => {
    expect([1, 2, 3].map(rotatedLogFileName)).toEqual([
      "backend.log.1",
      "backend.log.2",
      "backend.log.3",
    ]);
  });
});

describe("backend.json 的格式", () => {
  it("写好的内容能读回来", () => {
    expect(parseRunInfo(JSON.stringify(info))).toEqual(info);
  });

  it("多出来的字段不管，新版本加了字段，旧版本照样能读", () => {
    expect(parseRunInfo(JSON.stringify({ ...info, extra: "新版本的字段" }))).toEqual(info);
    expect(runInfoSchema.safeParse({ ...info, extra: 1 }).success).toBe(true);
  });

  it("不是 JSON、缺了字段、端口不对，都读成没有", () => {
    const { port: _port, ...noPort } = info;
    expect(parseRunInfo("{")).toBeUndefined();
    expect(parseRunInfo(JSON.stringify(noPort))).toBeUndefined();
    expect(parseRunInfo(JSON.stringify({ ...info, port: 0 }))).toBeUndefined();
    expect(parseRunInfo("null")).toBeUndefined();
  });
});

describe("日志的一行", () => {
  const line = {
    time: "2026-09-28T03:00:01.234Z",
    level: "error",
    pid: 51234,
    event: "dbNewer",
    message: "数据库已被更新版本的程序迁移过，这一版的后端不能打开它。",
    hint: "运行 ploop setup 安装新版本。",
  };

  it("时间、级别、进程号、事件和说明必有，hint 可以没有", () => {
    expect(logLineSchema.parse(line)).toEqual(line);
    const { hint: _hint, ...noHint } = line;
    expect(logLineSchema.parse(noHint)).toEqual(noHint);
    const { message: _message, ...noMessage } = line;
    expect(logLineSchema.safeParse(noMessage).success).toBe(false);
  });

  it("按事件而定的字段照原样留着", () => {
    const extra = { ...line, databaseLatest: 1, appLatest: 0, error: { name: "Error" } };
    expect(logLineSchema.parse(extra)).toEqual(extra);
  });

  it("级别只有 info、warn、error 三种", () => {
    expect(logLineSchema.safeParse({ ...line, level: "debug" }).success).toBe(false);
  });
});

describe("后端进程的退出码", () => {
  it("0 是正常或安静退出，1 到 5 是起不来的五种原因", () => {
    expect(backendExitCode).toEqual({
      ok: 0,
      crashed: 1,
      badSettings: 2,
      dbNewer: 3,
      portTaken: 4,
      nodeTooOld: 5,
    });
  });
});

describe("需要的 Node 版本", () => {
  it("和根目录 package.json 的 engines 相同", () => {
    const root = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    );
    expect(root.engines.node).toBe(`>=${requiredNode}`);
  });

  it.each([
    ["22.11.0", true],
    ["v22.11.0", true],
    ["24.11.9", true],
    ["24.12.0", false],
    ["v24.20.0", false],
    ["26.0.0", false],
  ])("%s 低于要求：%s", (version, tooOld) => {
    expect(isNodeTooOld(version)).toBe(tooOld);
  });
});

describe("端口", () => {
  it("默认端口是 4731", () => {
    expect(defaultPort).toBe(4731);
  });

  it("PLOOP_PORT 没写或写了空值时不改端口", () => {
    expect(envPort({})).toEqual({ ok: true, value: undefined });
    expect(envPort(ploopPort(""))).toEqual({ ok: true, value: undefined });
  });

  it("PLOOP_PORT 写 0 到 65535 的整数", () => {
    expect(envPort(ploopPort("0"))).toEqual({ ok: true, value: 0 });
    expect(envPort(ploopPort("4731"))).toEqual({ ok: true, value: 4731 });
    expect(envPort(ploopPort("65535"))).toEqual({ ok: true, value: 65535 });
  });

  it.each(["47x1", "-1", "65536", "4731.5", " 4731"])("PLOOP_PORT 写 %j 时报错", (value) => {
    expect(envPort(ploopPort(value))).toEqual({ ok: false, error: { value } });
  });
});

describe("集中存储的目录", () => {
  /** 环境变量名是全大写，Biome 的命名规则不许写进对象字面量，所以这样拼。 */
  const ploopHome = (value: string) => ({ PLOOP_HOME: value });
  const dirs = { userHome: "/Users/someone", cwd: "/Users/someone/proj/app" };

  it("PLOOP_HOME 优先，末尾的斜杠和 .、.. 整理掉", () => {
    expect(resolveHome(ploopHome("/tmp/ploop-a"), dirs)).toBe("/tmp/ploop-a");
    expect(resolveHome(ploopHome("/tmp//x/./../ploop-a/"), dirs)).toBe("/tmp/ploop-a");
  });

  it("PLOOP_HOME 写相对路径时按当前目录展开", () => {
    expect(resolveHome(ploopHome("ploop-b"), dirs)).toBe("/Users/someone/proj/app/ploop-b");
    expect(resolveHome(ploopHome("../ploop-c"), dirs)).toBe("/Users/someone/proj/ploop-c");
  });

  it("没写 PLOOP_HOME 或写了空值时，用家目录下的 .product-loop", () => {
    expect(resolveHome({}, dirs)).toBe("/Users/someone/.product-loop");
    expect(resolveHome(ploopHome(""), dirs)).toBe("/Users/someone/.product-loop");
  });
});
