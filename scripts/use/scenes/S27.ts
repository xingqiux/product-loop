import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { openPage, pickFirstEverywhere } from "../browser.ts";
import { check, expectRun, pause, type Scene, type World } from "../lib.ts";
import { presentThink } from "../pages.ts";

// S27 后端没开时。AI 敲命令时，用户工作台开着时。后端是本机的进程，会退出。
// 命令报错或页面丢内容，用户会当场要求修。
// 摆的状态：一个项目，构思阶段的一页在等用户回复，后端已停。全部在沙盒里做。
// 沙盒平常的端口写 0，每次拉起换一个。这个场景要看页面断线以后自己连回来，页面开在旧的地址上，
// 新的后端要占同一个端口，所以场景开头挑一个空闲的端口固定下来，不用真实的 4731。

const runFile = (w: World) => join(w.store, "run", "backend.json");

/** 后端在运行时 backend.json 里的进程号和端口。 */
function runInfo(w: World): { pid: number; port: number } | undefined {
  return existsSync(runFile(w))
    ? (JSON.parse(readFileSync(runFile(w), "utf8")) as { pid: number; port: number })
    : undefined;
}

/** 等后端起来或者退出，最多十秒。 */
async function waitBackend(w: World, running: boolean): Promise<void> {
  for (let i = 0; i < 100 && (runInfo(w) !== undefined) !== running; i++) await pause(100);
  check((runInfo(w) !== undefined) === running, running ? "后端没有起来" : "后端没有退出");
}

/** 一个空闲的端口：先占住再放开。 */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
}

export const scene: Scene = {
  scene: "S27",
  setup: async (w) => {
    // 断线重连要回到同一个地址，端口不能每次换：用一个随机挑的空闲端口，不碰真实的 4731。
    w.env.PLOOP_PORT = String(await freePort());
    w.memo.set("path", presentThink(w));
    expectRun(w.ploop(["backend", "stop"]), 0);
  },
  steps: [
    {
      do: "后端没在运行，敲 ploop status",
      expect: "命令自己拉起后端，输出和后端开着时一样，不多一行。",
      run: (w) => {
        check(runInfo(w) === undefined, "开始时后端已经在运行");
        const first = w.ploop(["status"]);
        expectRun(first, 0, "项目 app：第 1 版的构思阶段，等用户回复");
        check(runInfo(w) !== undefined, "命令没有拉起后端");
        // 后端开着时再敲一次：输出一字不差，标准错误里也没有多出「正在启动后端」这样的一行。
        const again = w.ploop(["status"]);
        check(
          first.stdout === again.stdout,
          `拉起后端时输出不一样：${first.stdout}对${again.stdout}`,
        );
        check(first.stderr === again.stderr, `拉起后端时多打印了：${first.stderr}`);
        check(first.stderr === "", `标准错误里有内容：${first.stderr}`);
        w.memo.set("status", first.stdout);
      },
    },
    {
      do: "敲 ploop backend status",
      expect: "写在运行、进程、端口、工作台地址和构建号。",
      run: (w) => {
        const info = runInfo(w);
        check(info !== undefined, "后端没有在运行");
        const run = w.ploop(["backend", "status"]);
        expectRun(
          run,
          0,
          `在运行：后端，进程 ${info?.pid}，端口 ${info?.port}`,
          `工作台：http://127.0.0.1:${info?.port}/`,
          "构建号：",
        );
      },
    },
    {
      do: "工作台开着，敲 ploop backend stop",
      expect: "几秒后页面顶上写「连不上，重连中」。提交区写「存不上」，不写英文码。",
      run: async (w) => {
        const page = await openPage(w, w.memo.get("path") as string);
        w.memo.set("page", page);
        await page.getByRole("button", { name: "提交", exact: true }).waitFor();
        expectRun(w.ploop(["backend", "stop"]), 0);
        const stopped = Date.now();
        await page.getByText("连不上，重连中").waitFor({ timeout: 15_000 });
        check(Date.now() - stopped < 10_000, "断线以后十秒还没有写连不上");
        // 断线时提交区写「存不上」，不管用户点没点过；点了以后还是写它，不写英文码。
        await page.getByText("存不上", { exact: true }).waitFor({ timeout: 5000 });
        await pickFirstEverywhere(page);
        await pause(2000);
        const text = await page.locator("body").innerText();
        const submitArea = text.split("提交").at(-1) ?? "";
        check(!/[A-Za-z]{3,}/u.test(submitArea), `提交区写了英文码：${submitArea}`);
        check(text.includes("存不上"), `提交区没有写「存不上」：${submitArea.trim()}`);
      },
    },
    {
      do: "连不上时在备注框里写几个字，再敲任一条 ploop 命令",
      expect: "命令拉起新的后端。十秒内页面恢复，顶上的提示消失，刚写的备注存下来。",
      run: async (w) => {
        const page = w.memo.get("page") as Page;
        await page.getByPlaceholder("想法", { exact: true }).fill("断线时写的想法");
        check(runInfo(w) === undefined, "后端已经在运行了");
        const started = Date.now();
        expectRun(w.ploop(["status"]), 0);
        check(runInfo(w) !== undefined, "命令没有拉起新的后端");
        // 从敲命令起，十秒内页面恢复。
        await page
          .getByText("连不上，重连中")
          .waitFor({ state: "detached", timeout: Math.max(1, 10_000 - (Date.now() - started)) });
        await page.getByText("点过的都已存下").waitFor({ timeout: 10_000 });
        // 刚写的备注存下来：换一个窗口打开同一页，想法还在。
        const again = await openPage(w, w.memo.get("path") as string);
        await again.getByRole("button", { name: "提交", exact: true }).waitFor();
        check(
          (await again.getByPlaceholder("想法", { exact: true }).inputValue()) === "断线时写的想法",
          "刚写的备注没有存下来",
        );
      },
    },
    {
      do: "强行结束后端进程，再敲 ploop status",
      expect: "命令照常拉起新的，输出和平时一样。",
      run: async (w) => {
        const info = runInfo(w);
        check(info !== undefined, "后端没有在运行");
        process.kill(info?.pid ?? 0, "SIGKILL");
        await pause(300);
        const run = w.ploop(["status"]);
        expectRun(run, 0);
        check(run.stdout === (w.memo.get("status") as string), `输出和平时不一样：${run.stdout}`);
        check(run.stderr === "", `标准错误里有内容：${run.stderr}`);
        const now = runInfo(w);
        check(now !== undefined && now.pid !== info?.pid, "没有拉起新的后端进程");
      },
    },
    {
      do: "后端的入口文件找不到，敲 ploop status",
      expect: "退出码 5，写明怎么改：运行 ploop setup，重新安装这一版。",
      run: async (w) => {
        expectRun(w.ploop(["backend", "stop"]), 0);
        await waitBackend(w, false);
        w.env.PLOOP_BACKEND_ENTRY = join(w.home, "没有这个目录", "backend.mjs");
        try {
          const run = w.ploop(["status"]);
          expectRun(run, 5, "ploop setup");
          check(run.stderr.includes("重新安装这一版"), `没有写明重新安装这一版：${run.stderr}`);
        } finally {
          delete w.env.PLOOP_BACKEND_ENTRY;
        }
      },
    },
    {
      do: "敲 ploop backend logs",
      expect: "打印最近的日志，写成中文。",
      run: (w) => {
        const run = w.ploop(["backend", "logs"]);
        expectRun(run, 0, "日志的最后");
        const lines = run.stdout.trimEnd().split("\n").slice(1);
        check(lines.length > 0, "日志是空的");
        for (const line of lines) {
          check(
            /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d (信息|警告|错误)：/u.test(line),
            `日志的这一行不是中文的格式：${line}`,
          );
        }
      },
    },
    {
      do: "想自己启动后端，敲 ploop backend start",
      expect:
        "后端没在运行就启动，写进程和端口。已在运行时再敲一次，写「后端已在运行」，进程不变。",
      run: async (w) => {
        // 后端没在运行：先停下（已经停了也不要紧），再自己启动。
        w.ploop(["backend", "stop"]);
        await waitBackend(w, false);
        const first = w.ploop(["backend", "start"]);
        const info = runInfo(w);
        check(info !== undefined, "backend start 以后后端没有在运行");
        expectRun(first, 0, `启动了：后端，进程 ${info?.pid}，端口 ${info?.port}`);
        // 已在运行：再敲一次，写「后端已在运行」，进程和端口都不变。
        const again = w.ploop(["backend", "start"]);
        expectRun(again, 0, `后端已在运行：进程 ${info?.pid}，端口 ${info?.port}`);
        const now = runInfo(w);
        check(
          now?.pid === info?.pid && now?.port === info?.port,
          `再敲一次以后进程变了：${info?.pid} 变成 ${now?.pid}`,
        );
        // 进程真的在：给它发一个空信号。
        process.kill(info?.pid ?? 0, 0);
      },
    },
  ],
};
