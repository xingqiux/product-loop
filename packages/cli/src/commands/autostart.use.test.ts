import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentLabelFor } from "./autostart.ts";
import { sandbox } from "./testing.ts";

// ploop backend autostart 对着真的命令行跑，launchctl 换成只记参数的假脚本，
// 家目录是临时的，不碰真实的 ~/Library/LaunchAgents 和 launchd。

/** 沙盒里装好一个假的 app/current/backend.mjs 和一个记参数的假 launchctl。 */
function withFakeLaunchctl() {
  const s = sandbox();
  mkdirSync(join(s.store, "app", "current"), { recursive: true });
  writeFileSync(join(s.store, "app", "current", "backend.mjs"), "");
  const log = s.at("launchctl.log");
  const fake = s.at("fake-launchctl");
  writeFileSync(fake, `#!/bin/sh\necho "$@" >> '${log}'\nexit 0\n`, { mode: 0o755 });
  s.env.PLOOP_LAUNCHCTL = fake;
  const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trimEnd().split("\n") : []);
  return { s, calls };
}

describe.skipIf(process.platform !== "darwin")(
  "ploop backend autostart",
  { timeout: 60_000 },
  () => {
    it("status、on、off 走一遍：只有 on 才装，off 删干净", () => {
      const { s, calls } = withFakeLaunchctl();
      // 沙盒的集中存储不在默认位置，启动项的标签带路径的哈希，不会碰到真实的启动项。
      const label = agentLabelFor({ env: s.env, cwd: s.home, userHome: s.home });
      expect(label).not.toBe("com.product-loop.backend");
      const file = s.at(`Library/LaunchAgents/${label}.plist`);

      const none = s.ploop(".", "backend", "autostart", "status");
      expect(none.stdout).toBe(
        "登录时自动启动后端：没装\n\n下一步：\n  1. ploop backend autostart on\n",
      );
      expect(existsSync(file)).toBe(false);
      expect(calls()).toEqual([]);

      const on = s.ploop(".", "backend", "autostart", "on");
      expect(on.stdout.split("\n")[0]).toBe("装好了：登录时自动启动后端");
      expect(on.code).toBe(0);
      const plist = readFileSync(file, "utf8");
      expect(plist).toContain(`<string>${process.execPath}</string>`);
      expect(plist).toContain(`<string>${join(s.store, "app", "current", "backend.mjs")}</string>`);
      const uid = process.getuid?.() ?? 0;
      expect(calls()).toEqual([`bootout gui/${uid}/${label}`, `bootstrap gui/${uid} ${file}`]);

      const status = s.ploop(".", "backend", "autostart", "status");
      expect(status.stdout).toContain("登录时自动启动后端：已装\n");
      expect(status.stdout).toContain("已加载：是\n");

      const off = s.ploop(".", "backend", "autostart", "off");
      expect(off.stdout.split("\n")[0]).toBe("卸掉了：登录时自动启动后端");
      expect(off.code).toBe(0);
      expect(existsSync(file)).toBe(false);
    });

    it("没有 ploop setup 装好的后端：on 退出码 4，不写启动项", () => {
      const s = sandbox();
      const on = s.ploop(".", "backend", "autostart", "on");
      expect(on.stderr).toContain("找不到装好的后端");
      expect(on.code).toBe(4);
      expect(existsSync(s.at("Library"))).toBe(false);
    });
  },
);
