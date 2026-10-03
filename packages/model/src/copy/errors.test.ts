import { describe, expect, it } from "vitest";
import { errorCodes } from "../errors.ts";
import { parseQueueId, parseQueueIdList, parseSceneId } from "../ids.ts";
import { renamedStages } from "../names.ts";
import type { Result } from "../result.ts";
import { parseLegacyRoundId, parseRoundLabel, parseRoundRef } from "../round-label.ts";
import { stageWordOf } from "../round-name.ts";
import { flattenCopy, renderCopy } from "./define.ts";
import { backendCopy, errorCodeCopy, errorCodeCopyOf, parseCopy } from "./errors.ts";

describe("错误码的默认说明", () => {
  it("每个错误码都有一条，顺序和错误码表相同", () => {
    expect(errorCodeCopy.map((row) => row.code)).toEqual(errorCodes.map((row) => row.code));
  });

  it("按错误码取到的就是自己那一条", () => {
    for (const row of errorCodeCopy) expect(errorCodeCopyOf(row.code)).toBe(row);
  });

  it("INTERNAL 的改法写日志的位置，不传位置时类型检查报错", () => {
    const logPath = "/tmp/ploop-home/logs/backend.log";
    expect(renderCopy(errorCodeCopyOf("INTERNAL").hint, { logPath })).toContain(logPath);
    // @ts-expect-error 少了 logPath
    renderCopy(errorCodeCopyOf("INTERNAL").hint);
  });

  it("要体检和命令行太旧时，改法写明要运行的命令", () => {
    expect(renderCopy(errorCodeCopyOf("NEEDS_DOCTOR").hint)).toContain("ploop doctor");
    expect(renderCopy(errorCodeCopyOf("CLIENT_TOO_OLD").hint)).toContain("ploop setup");
  });
});

describe("「01 架构」第八节报给 AI 的话", () => {
  // 原表一行对应一条。后端没开的那一行是自动拉起、不打印，没有文案。
  it("只有要报的五种情况，顺序和原表相同", () => {
    expect(Object.keys(backendCopy)).toEqual([
      "startFailed",
      "portTaken",
      "busyTimeout",
      "serverError",
      "nodeTooOld",
    ]);
  });

  it("拉起后八秒内没有就绪：附日志最后几行，建议在前台启动看完整报错", () => {
    const { message, hint } = backendCopy.startFailed;
    const logTail = "第一行\n第二行";
    expect(renderCopy(message, { logTail })).toContain(logTail);
    expect(renderCopy(hint)).toContain("ploop backend start --foreground");
  });

  it("端口被别的程序占用：写明占用的进程，建议用 PLOOP_PORT 换端口", () => {
    const { message, hint } = backendCopy.portTaken;
    expect(renderCopy(message, { port: 4731, owner: "nginx，进程号 812" })).toContain(
      "nginx，进程号 812",
    );
    expect(renderCopy(hint)).toContain("PLOOP_PORT");
  });

  it("后端在迁移或恢复：超时后写明在做什么、已经做了多久", () => {
    const text = renderCopy(backendCopy.busyTimeout.message, { task: "恢复快照", seconds: 130 });
    expect(text).toContain("恢复快照");
    expect(text).toContain("130 秒");
  });

  it("后端返回服务器错误：转述错误码和日志位置，建议运行 ploop doctor", () => {
    const { message, hint } = backendCopy.serverError;
    expect(renderCopy(message, { code: "INTERNAL" })).toContain("INTERNAL");
    const logPath = "/tmp/ploop-home/logs/backend.log";
    expect(renderCopy(hint, { logPath })).toContain(logPath);
    expect(renderCopy(hint, { logPath })).toContain("ploop doctor");
  });

  it("Node 版本不够：写明需要的版本和当前版本，建议运行 ploop setup", () => {
    const { message, hint } = backendCopy.nodeTooOld;
    const text = renderCopy(message, { current: "22.11.0", required: "24.12.0" });
    expect(text).toContain("22.11.0");
    expect(text).toContain("24.12.0");
    expect(renderCopy(hint)).toContain("ploop setup");
  });
});

describe("第 1 步的解析失败", () => {
  function errorOf<E>(result: Result<unknown, E>): E {
    if (result.ok) throw new Error("这里应当解析失败");
    return result.error;
  }

  // 每种失败都用真的解析函数触发一次，记下属于哪一组、错误码是什么。
  const observed: [string, string][] = [
    ["roundLabel", errorOf(parseRoundLabel("v2-落地"))],
    ["roundLabel", errorOf(parseRoundLabel("v2-land-3"))],
    ["roundLabel", errorOf(parseRoundLabel("v2-修复-3"))],
    ["roundLabel", errorOf(parseRoundLabel("v0-构思-1"))],
    ["legacyRoundId", errorOf(parseLegacyRoundId("gate-fix"))],
    ["roundRef", errorOf(parseRoundRef("落地第三轮"))],
    ["queueId", errorOf(parseQueueId("q12"))],
    ["queueId", errorOf(parseQueueId("Q0"))],
    ["sceneId", errorOf(parseSceneId("s3"))],
    ["sceneId", errorOf(parseSceneId("S0"))],
    ...Object.keys(errorOf(parseQueueIdList("Q12,q15"))).map((key): [string, string] => [
      "queueIdList",
      key,
    ]),
  ];
  const keys = new Set(flattenCopy("parse", parseCopy).map((item) => item.key));

  it.each(observed)("%s 的 %s 有报错和改法", (group, error) => {
    expect(keys.has(`parse.${group}.${error}.message`)).toBe(true);
    expect(keys.has(`parse.${group}.${error}.hint`)).toBe(true);
  });

  it("文案里没有解析函数不会返回的错误码", () => {
    const listed = [...keys].map((key) => key.replace(/\.(message|hint)$/u, ""));
    const expected = observed.map(([group, error]) => `parse.${group}.${error}`);
    expect([...new Set(listed)].sort()).toEqual([...new Set(expected)].sort());
  });

  it("指一个阶段的参数按标识的写法写错时，用阶段写法的文案", () => {
    const error = errorOf(parseRoundRef("v2-修复-3"));
    expect(error).toBe("renamedStage");
    expect(keys.has(`parse.roundLabel.${error}.message`)).toBe(true);
  });

  it("阶段改过名时，改法写明现在的名字", () => {
    const text = "v2-修复-3";
    const old = stageWordOf(text);
    const now = renamedStages.get(old) ?? "";
    const { message, hint } = parseCopy.roundLabel.renamedStage;
    expect(renderCopy(message, { text, old })).toBe(
      "阶段「v2-修复-3」用了改过名的阶段名「修复」。",
    );
    expect(renderCopy(hint, { old, now })).toBe("「修复」现在叫「落地」，按新名字写。");
  });

  it("列表里写错的几个一次报出", () => {
    const { bad } = errorOf(parseQueueIdList("Q12,q15,Q0"));
    const text = renderCopy(parseCopy.queueIdList.bad.message, {
      count: bad.length,
      bad: bad.join("、"),
    });
    expect(text).toBe("有 2 个队列事项的编号写错了：q15、Q0。");
  });
});
