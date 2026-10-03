import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { check, expectRun, type Scene, started, type World } from "../lib.ts";

// S36 登录时自动启动后端。用户，想一登录电脑后端就在，不想等第一条命令拉起它时。
// 只有用户要才装。装错或卸不掉，登录项会一直留在系统里，所以要能装、能查、能卸。
// 全部在沙盒里做：家目录是临时的，启动项写进它下面的 Library/LaunchAgents，不碰真实的。
// launchctl 换成只记参数的假脚本（PLOOP_LAUNCHCTL），不碰真实的 launchd。
// 摆的状态：命令装好（集中存储里有 app/current/backend.mjs），项目开了工，后端开着。

/** 假 launchctl 的日志：每次被调用记一行参数。 */
const logOf = (w: World) => join(w.home, "launchctl.log");

/** 假 launchctl 被调用过的每一行，一行一次。 */
function calls(w: World): string[] {
  return existsSync(logOf(w)) ? readFileSync(logOf(w), "utf8").trimEnd().split("\n") : [];
}

/** 沙盒里放启动项的文件夹：<临时家目录>/Library/LaunchAgents。 */
const agentsDir = (w: World) => join(w.home, "Library", "LaunchAgents");

/** 文件夹里的文件，文件夹不在就是空的。 */
const listed = (dir: string): string[] => (existsSync(dir) ? readdirSync(dir) : []);

export const scene: Scene = {
  scene: "S36",
  setup: (w) => {
    // 只记参数的假 launchctl：先设好，后面每一条 ploop 命令都用它，绝不碰真实的 launchd。
    const fake = join(w.home, "fake-launchctl");
    mkdirSync(w.home, { recursive: true });
    writeFileSync(fake, `#!/bin/sh\necho "$@" >> '${logOf(w)}'\nexit 0\n`, { mode: 0o755 });
    w.env.PLOOP_LAUNCHCTL = fake;
    // 命令装好：打包的运行目录装进沙盒的集中存储。直接运行源码时没有打包的产物，放一个空的后端入口。
    if (w.app === undefined) {
      const current = join(w.store, "app", "current");
      mkdirSync(current, { recursive: true });
      writeFileSync(join(current, "backend.mjs"), "");
    } else {
      expectRun(w.ploop(["setup"]), 0, "装好了");
    }
    // 开工，后端开着。
    started(w);
    expectRun(w.ploop(["status"]), 0);
    check(existsSync(join(w.store, "run", "backend.json")), "后端没有开着");
  },
  steps: [
    {
      do: "命令装好、后端开着，敲 ploop backend autostart status",
      expect:
        "写「登录时自动启动后端：没装」，下一步写 ploop backend autostart on。装命令、开工和拉起后端，都没有装启动项。",
      run: (w) => {
        expectRun(
          w.ploop(["backend", "autostart", "status"]),
          0,
          "登录时自动启动后端：没装",
          "ploop backend autostart on",
        );
        // 只有用户敲 on 才装：装命令、开工、拉起后端以后，启动项的文件夹里什么都没有，launchctl 一次也没被调用。
        check(
          listed(agentsDir(w)).length === 0,
          `没敲 on 就有启动项了：${listed(agentsDir(w)).join("、")}`,
        );
        check(calls(w).length === 0, `launchctl 被调用过：${calls(w).join("｜")}`);
      },
    },
    {
      do: "敲 ploop backend autostart on",
      expect:
        "写「装好了」、启动项的位置和运行的命令。崩溃了会自动重启，ploop backend stop 停下后不再拉起。",
      run: (w) => {
        const on = w.ploop(["backend", "autostart", "on"]);
        expectRun(
          on,
          0,
          "装好了：登录时自动启动后端",
          "启动项：",
          "运行：",
          "崩溃了会自动重启。",
          "ploop backend stop 停下后，启动项不再拉起它。",
        );
        // 启动项写在沙盒的家目录下，集中存储不在默认位置，文件名带哈希。
        const file = /^启动项：(.*)$/mu.exec(on.stdout)?.[1] ?? "";
        check(
          file.startsWith(agentsDir(w)) &&
            /com\.product-loop\.backend\.[0-9a-f]{8}\.plist$/u.test(file),
          `启动项写到了 ${file}，不在沙盒的 LaunchAgents 里，或者文件名不对`,
        );
        check(existsSync(file), "启动项文件没有写出来");
        const plist = readFileSync(file, "utf8");
        const entry = join(w.store, "app", "current", "backend.mjs");
        check(plist.includes(`<string>${entry}</string>`), "启动项里没有后端入口的路径");
        check(on.stdout.includes(`运行：${process.execPath} ${entry}`), "输出里没有运行的命令");
        // 装的时候先卸再装：两次 launchctl 调用，都指向这份启动项。
        const label = file.replace(/^.*\//u, "").replace(/\.plist$/u, "");
        const uid = process.getuid?.() ?? 0;
        check(
          JSON.stringify(calls(w)) ===
            JSON.stringify([`bootout gui/${uid}/${label}`, `bootstrap gui/${uid} ${file}`]),
          `launchctl 的调用不对：${calls(w).join("｜")}`,
        );
        w.memo.set("file", file);
      },
    },
    {
      do: "再敲 ploop backend autostart status",
      expect: "写「已装」和「已加载：是」。",
      run: (w) => {
        const file = w.memo.get("file") as string;
        const status = w.ploop(["backend", "autostart", "status"]);
        expectRun(status, 0, "登录时自动启动后端：已装", `启动项：${file}`, "已加载：是");
      },
    },
    {
      do: "敲 ploop backend autostart off",
      expect: "写「卸掉了」，启动项文件删掉。下一条命令仍会拉起后端。",
      run: (w) => {
        const file = w.memo.get("file") as string;
        const off = w.ploop(["backend", "autostart", "off"]);
        expectRun(off, 0, "卸掉了：登录时自动启动后端", "下一条命令会重新拉起它");
        check(!existsSync(file), "启动项文件还在");
        check(
          listed(agentsDir(w)).length === 0,
          `LaunchAgents 里还有：${listed(agentsDir(w)).join("、")}`,
        );
        // 卸掉以后，下一条命令仍会拉起后端：假 launchctl 拉起不了，后端由命令自己拉起。
        w.ploop(["backend", "stop"]);
        check(!existsSync(join(w.store, "run", "backend.json")), "后端没有停下");
        expectRun(w.ploop(["status"]), 0, "项目 app");
        check(existsSync(join(w.store, "run", "backend.json")), "下一条命令没有拉起后端");
      },
    },
  ],
};
