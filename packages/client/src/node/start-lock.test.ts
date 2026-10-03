import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { startLockAge, takeOverStartLock, tryStartLock } from "./start-lock.ts";
import { tempDir } from "./testing.ts";

// 启动锁 run/start.lock，见「01 架构」第六节第 5 步。

function setup() {
  const dir = tempDir("ploop-start-lock-");
  let time = Date.parse("2026-09-28T03:00:00Z");
  const owner = (pid: number) => ({ pid, now: () => time });
  return {
    dir,
    file: join(dir, "start.lock"),
    owner,
    advance: (ms: number) => {
      time += ms;
    },
    now: () => time,
  };
}

describe("启动锁", () => {
  it("占到时写下进程号、时间和随机编号，修改时间是现在", () => {
    const s = setup();
    expect(tryStartLock(s.file, s.owner(4242))).toBeDefined();
    const content = JSON.parse(readFileSync(s.file, "utf8"));
    expect(content).toMatchObject({ pid: 4242, startedAt: "2026-09-28T03:00:00.000Z" });
    expect(content.token).toMatch(/^[0-9a-f-]{36}$/u);
    expect(startLockAge(s.file, s.now())?.ageMs).toBe(0);
  });

  it("别人占着时占不到，放开以后能占到", () => {
    const s = setup();
    const first = tryStartLock(s.file, s.owner(1));
    expect(tryStartLock(s.file, s.owner(2))).toBeUndefined();
    first?.release();
    expect(existsSync(s.file)).toBe(false);
    expect(tryStartLock(s.file, s.owner(2))).toBeDefined();
  });

  it("refresh 把修改时间更新成现在", () => {
    const s = setup();
    const lock = tryStartLock(s.file, s.owner(1));
    s.advance(20_000);
    expect(startLockAge(s.file, s.now())?.ageMs).toBe(20_000);
    lock?.refresh();
    expect(startLockAge(s.file, s.now())?.ageMs).toBe(0);
  });

  it("锁不在时 startLockAge 返回 undefined", () => {
    expect(startLockAge(join(setup().dir, "start.lock"), 0)).toBeUndefined();
  });

  it("接手：删掉看过的那一把，接着能占到，原来的一方不再动它", () => {
    const s = setup();
    const old = tryStartLock(s.file, s.owner(1));
    s.advance(31_000);
    const age = startLockAge(s.file, s.now());
    expect(age?.ageMs).toBe(31_000);
    expect(takeOverStartLock(s.file, age?.ino ?? -1)).toBe(true);
    const mine = tryStartLock(s.file, s.owner(2));
    expect(mine).toBeDefined();
    // 原来的一方醒来：更新和放开都不动别人的锁。
    s.advance(5_000);
    old?.refresh();
    old?.release();
    expect(JSON.parse(readFileSync(s.file, "utf8")).pid).toBe(2);
    expect(startLockAge(s.file, s.now())?.ageMs).toBe(5_000);
    expect(readdirSync(s.dir)).toEqual(["start.lock"]);
  });

  it("看过以后锁已经换成别人新占的：放回原处，不删", () => {
    const s = setup();
    tryStartLock(s.file, s.owner(1))?.release();
    const stale = statSync(s.dir).ino;
    tryStartLock(s.file, s.owner(3));
    expect(takeOverStartLock(s.file, stale)).toBe(false);
    expect(JSON.parse(readFileSync(s.file, "utf8")).pid).toBe(3);
    expect(readdirSync(s.dir)).toEqual(["start.lock"]);
  });

  it("两个会话同时接手同一把：只有一个接得到", () => {
    const s = setup();
    writeFileSync(s.file, JSON.stringify({ pid: 1, startedAt: "", token: "old" }));
    utimesSync(s.file, 0, 0);
    const ino = startLockAge(s.file, s.now())?.ino ?? -1;
    expect([takeOverStartLock(s.file, ino), takeOverStartLock(s.file, ino)]).toEqual([true, false]);
    expect(readdirSync(s.dir)).toEqual([]);
  });
});
