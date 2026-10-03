import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openPage, pasteImage, pick } from "../browser.ts";
import { check, expectRun, pause, type Scene, started, type World } from "../lib.ts";
import { presentAsk } from "../pages.ts";

// S30 出错以后恢复。AI 和用户，命令或页面出错时。出错后要能接着做，不用重点已经点过的选项，也不丢数据。
// 前五步是命令和页面出错：等回复到时限、页被撤回、提交时后端连不上、截图存不上，再导出一份。
// 后五步是数据坏了以后的恢复：快照、预告、恢复、快照以后才登记的项目、撤销恢复。
// 恢复动的是沙盒里的集中存储（w.store），临时的 PLOOP_HOME，不碰真实的。
// 摆的状态：app 给出了一页等回复；做了一份手动快照；快照以后才登记了项目 later，它有主线和一页。

const question = "队列看板放在哪里";
const later = "../later";

/** 快照文件名里的 UTC 时间换成北京时间，写到分钟：2026-09-30 19:29。 */
function beijingOf(name: string): string {
  const stamp = /^manual-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/u.exec(name);
  if (stamp === null) throw new Error(`快照名里没有时间：${name}`);
  const [, year, month, day, hour, minute] = stamp;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return new Date(utc + 8 * 60 * 60 * 1000).toISOString().slice(0, 16).replace("T", " ");
}

/** 这一步不用浏览器：窗口留着上一步的页，截图就成了别的步骤的样子，先放掉。 */
function noScreen(w: World): void {
  w.frame.current = undefined;
}

const ideas = "先记下这一条";

export const scene: Scene = {
  scene: "S30",
  setup: (w) => {
    started(w);
    presentAsk(w, ".", question);
    // 项目登记以后、状态好的时候做一份手动快照。
    const taken = w.ploop(["backup", "now"]);
    expectRun(taken, 0, "做好了快照：");
    const name = /做好了快照：(manual-\d{8}T\d{9}Z\.db)/u.exec(taken.stdout)?.[1];
    check(name !== undefined, `没有读出快照名：${taken.stdout}`);
    w.memo.set("snapshot", name);
    // 快照以后才登记的项目：主线写了内容，有阶段的文件。
    w.write(`${later}/.keep`, "");
    expectRun(w.ploop(["init", "--repo", "自己的"], join(w.root, later)), 0);
    w.write(`${later}/.product-loop/主线.md`, w.read(".product-loop/主线.md"));
    presentAsk(w, later, "退款页的按钮放在哪里");
    w.memo.set("laterMainline", w.read(`${later}/.product-loop/主线.md`));
  },
  steps: [
    {
      do: "等回复的命令等到时限，用户还没提交",
      expect: "退出码 7，写还没有回复和等了多久。再敲一次同样的命令接着等。",
      run: (w) => {
        noScreen(w);
        const first = w.ploop(["reply", "wait", "--timeout", "2"]);
        expectRun(first, 7, "还没有回复：第 1 版的构思阶段的第 1 页，等了 2 秒");
        check(
          first.stdout.includes("ploop reply wait"),
          `下一步没有写再敲 ploop reply wait：${first.stdout}`,
        );
        // 再敲一次同样的命令接着等：这一页还在等，同样是没有回复。
        expectRun(w.ploop(["reply", "wait", "--timeout", "2"]), 7, "还没有回复", "等了 2 秒");
      },
    },
    {
      do: "等的那一页被撤回，或被新的一页代替",
      expect: "退出码 8，写等的页已不在，下一步敲 ploop status。",
      run: async (w) => {
        noScreen(w);
        // 被撤回：命令挂着等，AI 撤回了这一页。
        const waiting = w.launch(["reply", "wait", "--timeout", "30"]);
        await pause(1500);
        check(waiting.running(), "reply wait 没有挂着等，已经退出了");
        expectRun(w.ploop(["page", "withdraw", "--reason", "补一个问题"]), 0);
        const gone = await waiting.done;
        expectRun(gone, 8, "页已不在", "已经撤回了");
        check(
          `${gone.stdout}${gone.stderr}`.includes("ploop status"),
          `下一步没有写 ploop status：${gone.stdout}${gone.stderr}`,
        );
        // 被新的一页代替：撤回以后马上给出新的一页，挂着的命令看到的是新的一页，也不再是它等的那一页。
        expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段的第 2 页");
        const again = w.launch(["reply", "wait", "--timeout", "30"]);
        await pause(1500);
        check(again.running(), "对新的一页敲的 reply wait 没有挂着等");
        expectRun(w.ploop(["page", "withdraw"]), 0);
        expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段的第 3 页");
        const replaced = await again.done;
        expectRun(replaced, 8, "页已不在");
        // 最后留下第 3 页在等，下一步在它上面点。
      },
    },
    {
      do: "用户点提交时后端连不上，AI 随后敲任一条命令",
      expect: "页面不丢内容，也不写已提交。后端拉起后再点提交，成功，点过的选项都在。",
      run: async (w) => {
        const page = await openPage(w, `/p/app/r/${encodeURIComponent("v1-构思-1")}`);
        w.memo.set("page", page);
        await pick(page, /放在页面最后/u);
        await page.getByPlaceholder("想法", { exact: true }).fill(ideas);
        await page.getByText("点过的都已存下").waitFor();
        // 后端要拉起在同一个端口上，页面才连得回来。
        const port = new URL(w.url("/")).port;
        expectRun(w.ploop(["backend", "stop"]), 0);
        await page.getByRole("button", { name: "提交", exact: true }).click();
        const dialog = page.getByRole("dialog");
        await dialog.getByRole("button", { name: "提交" }).click();
        await dialog.getByText("本机服务没有回应").waitFor({ timeout: 30_000 });
        const failed = await dialog.innerText();
        check(failed.includes("草稿已存下"), `没有写草稿的下落：${failed}`);
        check(!/[a-z]{4,}/u.test(failed.replace("ploop", "")), `还写着英文码：${failed}`);
        await dialog.getByRole("button", { name: "返回" }).click();
        // 页面不丢内容，也没有写已提交。
        check(await page.getByRole("radio", { name: /放在页面最后/u }).isChecked(), "选项没有了");
        check(
          (await page.getByPlaceholder("想法", { exact: true }).inputValue()) === ideas,
          "想法框里的字没有了",
        );
        const body = await page.locator("body").innerText();
        check(!body.includes("等 AI 取走") && !body.includes("已提交"), "连不上时写了已提交");
        // AI 随后敲任一条命令，命令拉起新的后端。
        w.env.PLOOP_PORT = port;
        expectRun(w.ploop(["status"]), 0, "项目 app");
        check(new URL(w.url("/")).port === port, "新的后端没有拉起在原来的端口上");
        await page.getByText("连不上，重连中").waitFor({ state: "detached", timeout: 30_000 });
        await page.getByRole("button", { name: "提交", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "提交" }).click();
        await page.getByText("等 AI 取走").waitFor({ timeout: 30_000 });
        // 点过的选项都在：页面上还选着，AI 取走的回复里也有。
        check(
          await page.getByRole("radio", { name: /放在页面最后/u }).isChecked(),
          "提交后选项没有了",
        );
        const taken = w.ploop(["reply", "wait", "--timeout", "10"]);
        expectRun(taken, 0, "选了选项 a", `想法：${ideas}`);
        await page.getByText("AI 已收到").waitFor({ timeout: 10_000 });
      },
    },
    {
      do: "贴一张截图，图存不上",
      expect: "备注框下面写存不上的原因，能重试，文字里不留「〔图 1〕」。",
      run: async (w) => {
        // 上一页已经回复了：AI 处理完（第 2 行是想法，也由 AI 定去处），给出新的一页，用户在新的一页上贴图。
        expectRun(w.ploop(["reply", "handle", "1", "不处理", "已经写进下一个阶段的疑问"]), 0);
        expectRun(w.ploop(["reply", "handle", "2", "队列", ideas, "--stage", "提升"]), 0);
        expectRun(w.ploop(["page", "present"]), 0, "第 1 版的构思阶段的第 4 页");
        const page = await openPage(w, `/p/app/r/${encodeURIComponent("v1-构思-1")}`);
        w.memo.set("page", page);
        // 附件库存不上：上传图片的请求失败，别的请求照常。
        await page.route(/\/api\/v1\/blobs\//u, (route) =>
          route.request().method() === "PUT"
            ? route.fulfill({
                status: 500,
                contentType: "application/json",
                body: JSON.stringify({
                  ok: false,
                  error: {
                    code: "INTERNAL",
                    message: "附件库写不进去，磁盘满了",
                    hint: "清出空间再贴一次。",
                  },
                }),
              })
            : route.continue(),
        );
        const box = page.getByPlaceholder("想法", { exact: true });
        await box.fill("窄屏下按钮被挡住");
        await pasteImage(box);
        const problem = page.getByText("截图存不上", { exact: false });
        await problem.waitFor();
        const text = await problem.innerText();
        check(text.includes("磁盘满了"), `没有写存不上的原因：${text}`);
        check(
          !(await box.inputValue()).includes("〔图 1〕"),
          `存不上的图，文字里还留着记号：${await box.inputValue()}`,
        );
        check((await page.getByAltText("图 1").count()) === 0, "存不上的图还出了缩略图");
        // 能重试：附件库好了以后点「重试」，缩略图和记号都有了，出错的一行和「重试」都不见了。
        await page.unroute(/\/api\/v1\/blobs\//u);
        await page.getByRole("button", { name: "重试", exact: true }).click();
        await page.getByAltText("图 1").waitFor();
        check((await box.inputValue()).includes("〔图 1〕"), "重试以后文字里没有〔图 1〕");
        check((await page.getByText("截图存不上").count()) === 0, "重试成功了，出错的话还在");
        check(
          (await page.getByRole("button", { name: "重试", exact: true }).count()) === 0,
          "重试成功了，「重试」还在",
        );
      },
    },
    {
      do: "敲 ploop export",
      expect: "在集中存储的 exports 下新建一个文件夹，里面有主线、决定、队列和每个阶段的文件。",
      run: (w) => {
        noScreen(w);
        const exported = w.ploop(["export"]);
        expectRun(exported, 0, "导出了：");
        const dir = /^导出了：(.*)，\d+ 个文件$/mu.exec(exported.stdout)?.[1] ?? "";
        check(
          dir.startsWith(join(w.store, "exports", "ploop-export-app-")),
          `导到了 ${dir}，不在集中存储的 exports 下`,
        );
        for (const file of ["主线.md", "决定.md", "队列.md", "rounds/v1-构思-1.json"]) {
          check(existsSync(join(dir, file)), `导出的文件夹里没有 ${file}`);
        }
        check(
          readFileSync(join(dir, "主线.md"), "utf8") === w.read(".product-loop/主线.md"),
          "导出的主线和项目缓存里的不一样",
        );
        check(readdirSync(join(dir, "rounds")).length >= 1, "没有导出阶段的文件");
        // 用户的项目目录里不多出东西。
        check(
          !readdirSync(w.root).some((name) => name.startsWith("ploop-export")),
          "项目里多了文件",
        );
      },
    },
    {
      do: "集中存储的数据坏了，敲 ploop backup list",
      expect: "列出快照，每份写时间，都是北京时间。",
      run: (w) => {
        noScreen(w);
        // 只在摆状态时直接改库：队列里的内容被写坏了。
        const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
        db.prepare("UPDATE queue_items SET content = '▒▒▒▒'").run();
        db.close();
        check(w.ploop(["queue", "list"]).stdout.includes("▒▒▒▒"), "没有摆出写坏的数据");
        const name = w.memo.get("snapshot") as string;
        const listed = w.ploop(["backup", "list"]);
        expectRun(listed, 0, "快照：", "每日：", "手动：", name);
        const rows = listed.stdout.split("\n").filter((line) => line.startsWith("  "));
        check(rows.length >= 2, `快照少于两份：${listed.stdout}`);
        for (const row of rows) {
          check(/^ {2}\d{4}-\d{2}-\d{2}/u.test(row), `这一行没有从时间起头：${row}`);
        }
        check(
          listed.stdout.includes(`  ${beijingOf(name)}  `),
          `手动快照的时间不是北京时间 ${beijingOf(name)}：${listed.stdout}`,
        );
        check(!/UTC|\dZ /u.test(listed.stdout.replace(name, "")), "快照的时间里还写着 UTC");
      },
    },
    {
      do: "敲 ploop backup restore 快照名",
      expect: "只做预告：写会换成哪份快照，哪些项目会没有。没加 --yes 不恢复，退出码 1。",
      run: (w) => {
        noScreen(w);
        const name = w.memo.get("snapshot") as string;
        const previewed = w.ploop(["backup", "restore", name]);
        expectRun(
          previewed,
          1,
          "没有恢复，先看一下会怎样。",
          `现在的数据库会换成 ${name}。`,
          "恢复以后，这 1 个项目就没有了：",
          "later（",
          "/proj/later）",
          "要恢复，先问用户；同意了加 --yes 再运行。",
        );
        // 什么都没动：写坏的数据还是写坏的，也没有留存的快照。
        check(w.ploop(["queue", "list"]).stdout.includes("▒▒▒▒"), "没加 --yes，数据却变了");
        check(
          !w.ploop(["backup", "list"]).stdout.includes("恢复前留存："),
          "没加 --yes，却留了恢复前的快照",
        );
      },
    },
    {
      do: "问过用户，加 --yes 再敲",
      expect: "写「恢复了」。恢复前的数据库留成 pre-restore 快照，完整性检查写没有问题。",
      run: (w) => {
        noScreen(w);
        const name = w.memo.get("snapshot") as string;
        const restored = w.ploop(["backup", "restore", name, "--yes"]);
        expectRun(restored, 0, `恢复了：${name}`, "完整性检查：没有问题", "pre-restore-");
        const pre = /(pre-restore-\S+?\.db)/u.exec(restored.stdout)?.[1];
        check(pre !== undefined, `没有写恢复前留存的快照名：${restored.stdout}`);
        w.memo.set("preRestore", pre);
        const listed = w.ploop(["backup", "list"]);
        expectRun(listed, 0, "恢复前留存：", pre ?? "");
        // 数据回到了快照的样子：队列里的内容是好的。
        const queue = w.ploop(["queue", "list"]);
        check(
          queue.stdout.includes(question) && !queue.stdout.includes("▒▒▒▒"),
          `恢复以后队列还是坏的：${queue.stdout}`,
        );
      },
    },
    {
      do: "恢复以后敲 ploop status",
      expect:
        "快照以后才登记的项目退出码 6，写集中存储里没有登记它。敲 ploop init 重新登记，主线和各阶段的文件保留。",
      run: (w) => {
        noScreen(w);
        const dir = join(w.root, later);
        const status = w.ploop(["status"], dir);
        expectRun(status, 6, "集中存储里没有登记它。");
        check(
          status.stderr.includes("ploop init"),
          `没有写敲 ploop init 重新登记：${status.stderr}`,
        );
        check(!status.stderr.includes("ploop doctor"), "还指向 ploop doctor");
        const again = w.ploop(["init"], dir);
        expectRun(again, 0, "重新登记了：项目 later，项目缓存原样保留");
        check(
          w.read(`${later}/.product-loop/主线.md`) === (w.memo.get("laterMainline") as string),
          "重新登记以后主线变了",
        );
        check(
          w.exists(`${later}/.product-loop/rounds/v1-构思-1/page.json`),
          "重新登记以后阶段的文件没有了",
        );
        expectRun(w.ploop(["status"], dir), 0, "项目 later");
      },
    },
    {
      do: "想撤销这次恢复，敲 ploop backup restore，写 pre-restore 快照的名字，加 --yes",
      expect: "回到恢复前的数据。",
      run: (w) => {
        noScreen(w);
        const pre = w.memo.get("preRestore") as string;
        const undone = w.ploop(["backup", "restore", pre, "--yes"]);
        expectRun(undone, 0, `恢复了：${pre}`, "完整性检查：没有问题");
        // 回到恢复前的数据：写坏的内容又回来了，later 还登记着。
        check(w.ploop(["queue", "list"]).stdout.includes("▒▒▒▒"), "没有回到恢复前的数据");
        expectRun(w.ploop(["status"], join(w.root, later)), 0, "项目 later");
        // 恢复前的那一页也回来了：提交、取走、处理过的回复都在。
        expectRun(w.ploop(["status"]), 0, "项目 app");
      },
    },
  ],
};
