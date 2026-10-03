import { existsSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Page } from "playwright-core";
import { openPage } from "../browser.ts";
import {
  addMigration,
  cloneRepo,
  copySkill,
  differences,
  installedPloop,
  installedWorld,
  pnpm,
  pnpmInstall,
  setVersion,
  skillTarget,
} from "../install.ts";
import { check, expectRun, pause, type Scene, type World } from "../lib.ts";
import { presentThink, projectId } from "../pages.ts";

// S28 升级到新版本。用户，拉了新版本的代码以后。要用上新命令和新规则，又不丢旧项目的数据。
// 升级后项目打不开或数据丢了，用户会要求马上修。
// 全部在沙盒里做：临时家目录、临时集中存储、端口写 0。仓库的副本放在临时目录里，
// 摆状态时在副本里把版本号改成 1.0.0，装上（旧版本），建项目、给出一页、记一条决定。
// 「拉了新版本的代码」在第 1 步做：在副本里把命令行版本号和 skill 版本号改成 1.2.0，
// 再加一条数据库迁移（新版本改了数据库结构），敲 pnpm install 和 pnpm ploop:setup。
// 版本号第一段是 1，才看得到「第二段比这一版低」和「第一段比这一版低」两种情况，
// 仓库现在的 0.0.1 做不到这两种。

type Built = { readonly build: string; readonly version: string };

const oldVersion = "1.0.0";
const newVersion = "1.2.0";

/** 副本里刚打好的构建号和版本号。 */
function builtOf(repo: string): Built {
  return JSON.parse(readFileSync(join(repo, "dist", "app", "build.json"), "utf8")) as Built;
}

/** 后端在运行时 backend.json 里的进程号。 */
function backendPid(w: World): number | undefined {
  const file = join(w.store, "run", "backend.json");
  return existsSync(file)
    ? (JSON.parse(readFileSync(file, "utf8")) as { pid: number }).pid
    : undefined;
}

/** 直接改沙盒的库：把项目停在哪一版 skill 改成 version。只在摆状态时这样做。 */
function stopSkillAt(w: World, version: string): void {
  const db = new DatabaseSync(join(w.store, "data", "ploop.db"));
  db.prepare("UPDATE projects SET skill_version = ? WHERE id = ?").run(version, projectId(w));
  db.close();
}

/** status 的行，去掉新规则那一句：升级前后要一样的那几行。 */
const statusLines = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith("skill 有这个项目还没用上的新规则"))
    .join("\n");

const newerRules = "skill 有这个项目还没用上的新规则";

export const scene: Scene = {
  scene: "S28",
  setup: (w) => {
    // 旧版本：副本里的版本号是 1.0.0，装上。
    const repo = cloneRepo(w);
    w.memo.set("repo", repo);
    setVersion(repo, "0.0.1", oldVersion);
    expectRun(pnpmInstall(w, repo), 0);
    expectRun(pnpm(w, repo, "pnpm ploop:setup", ["ploop:setup"]), 0);
    w.memo.set("old", builtOf(repo));
    // 旧版本用过一阵：一个项目，构思阶段的一页在等用户回复，一条决定。skill 也是旧的。
    const old = installedWorld(w);
    w.memo.set("path", presentThink(old));
    expectRun(
      old.ploop([
        "decision",
        "add",
        "--decision",
        "队列看板放在每一页的最后",
        "--reason",
        "用户每一页都要看到队列",
        "--case",
        "第 1 版的构思阶段第 1 行",
      ]),
      0,
    );
    const before = old.ploop([]);
    expectRun(before, 0, "项目 app：第 1 版的构思阶段，等用户回复");
    w.memo.set("before", before.stdout);
    const oldPid = backendPid(w);
    check(oldPid !== undefined, "旧版本的后端没有在运行");
    w.memo.set("oldPid", oldPid);
    copySkill(w, repo);
    writeFileSync(join(skillTarget(w), "SKILL.md"), "旧版本的 skill\n");
    rmSync(join(skillTarget(w), "references", "落地.md"));
  },
  steps: [
    {
      do: "在仓库里更新代码，敲 pnpm install 和 pnpm ploop:setup",
      expect:
        "写「装好了」、新的版本号和构建号。版本号变了时，旧版本还留在 ~/.product-loop/app 下。",
      run: (w) => {
        const repo = w.memo.get("repo") as string;
        // 更新代码：版本号升上去，数据库多一条迁移。
        setVersion(repo, oldVersion, newVersion);
        addMigration(repo);
        expectRun(pnpmInstall(w, repo), 0);
        const run = pnpm(w, repo, "pnpm ploop:setup", ["ploop:setup"]);
        expectRun(run, 0);
        const built = builtOf(repo);
        w.memo.set("new", built);
        check(built.version === newVersion, `构建出来的版本号是 ${built.version}`);
        const text = `${run.stdout}\n${run.stderr}`;
        check(
          text.includes(`装好了：${newVersion}（构建号 ${built.build}）`),
          `没有写「装好了」、新的版本号和构建号：${text.slice(-500)}`,
        );
        const app = join(w.store, "app");
        check(existsSync(join(app, oldVersion, "ploop.mjs")), "旧版本没有留在 app 下");
        check(existsSync(join(app, newVersion, "ploop.mjs")), "新版本没有装到 app 下");
        check(readlinkSync(join(app, "current")) === newVersion, "current 没有指向新版本");
      },
    },
    {
      do: "敲 ploop --version",
      expect: "写新的版本号和构建号。",
      run: (w) => {
        const built = w.memo.get("new") as Built;
        const run = installedPloop(w, ["--version"]);
        expectRun(run, 0, `构建号：${built.build}`);
        check(
          run.stdout.split("\n")[0]?.trim() === newVersion,
          `第一行不是新的版本号：${run.stdout}`,
        );
      },
    },
    {
      do: "这一版改了数据库结构时，敲 ploop backup list",
      expect: "列出升级前留的「迁移前」快照。",
      run: (w) => {
        // 新的后端第一次开库，先留下迁移前的快照，再做迁移。
        const run = installedPloop(w, ["backup", "list"]);
        expectRun(run, 0, "迁移前：");
        check(
          /pre-migration-\d{8}T\d{9}Z\.db/u.test(run.stdout),
          `没有列出迁移前的快照：${run.stdout}`,
        );
      },
    },
    {
      do: "在一个已有的项目里敲 ploop",
      expect: "新后端被拉起。写的第几版、阶段和在等的页，和升级前一样。",
      run: (w) => {
        const run = installedPloop(w, []);
        expectRun(run, 0);
        // 项目的 skill 停在 1.0.0，比新版本低，多出一句新规则，别的行和升级前一字不差。
        check(
          statusLines(run.stdout) === statusLines(w.memo.get("before") as string),
          `升级后写的和升级前不一样：${run.stdout}对${w.memo.get("before")}`,
        );
        const built = w.memo.get("new") as Built;
        const backend = installedPloop(w, ["backend", "status"]);
        expectRun(backend, 0, `构建号：${built.build}`);
        const pid = backendPid(w);
        check(pid !== undefined && pid !== w.memo.get("oldPid"), "后端还是升级前的那个进程");
      },
    },
    {
      do: "打开工作台",
      expect: "项目、页、决定和队列都还在，顶上没有连不上的提示。",
      run: async (w) => {
        const pid = projectId(w);
        const page = await openPage(w, "/");
        await page.getByRole("link", { name: pid, exact: true }).waitFor();
        const row = page.getByRole("row").filter({ hasText: "第 1 版的构思阶段" });
        check((await row.innerText()).includes("等用户回复"), "首页上这个项目不是等用户回复");
        await noLostBanner(page);
        // 队列：升级前放进去的两件事。
        await page.goto(w.url(`/p/${pid}/queue`));
        await page.getByText("队列看板放在哪里").first().waitFor();
        await page.getByText("决定表要能切换全部").first().waitFor();
        await noLostBanner(page);
        // 决定：升级前记的那一条。
        await page.goto(w.url(`/p/${pid}/decisions`));
        await page.getByText("队列看板放在每一页的最后").first().waitFor();
        await noLostBanner(page);
        // 页：等用户回复的那一页，卡还在。
        await page.goto(w.url(w.memo.get("path") as string));
        await page.getByRole("heading", { name: "第 1 版的构思阶段" }).waitFor();
        await page.getByRole("button", { name: "提交", exact: true }).waitFor();
        await page
          .getByRole("navigation", { name: "这一页的每一条" })
          .getByRole("button", { name: "队列看板放在哪里" })
          .waitFor();
        await noLostBanner(page);
      },
    },
    {
      do: "项目的 skill 版本第二段比这一版低时，敲 ploop",
      expect: "多写一句「skill 有这个项目还没用上的新规则」。别的命令照常。",
      run: (w) => {
        stopSkillAt(w, "1.1.0");
        const run = installedPloop(w, []);
        expectRun(run, 0, `${newerRules}。`);
        // 别的命令照常：读的、改数据的都不拦。
        expectRun(installedPloop(w, ["queue", "list"]), 0);
        expectRun(installedPloop(w, ["queue", "add", "升级后加的一件事", "--stage", "检查"]), 0);
      },
    },
    {
      do: "项目的 skill 版本第一段比这一版低时，敲任一条改数据的命令",
      expect: "退出码 6。写项目停在旧版，先敲 ploop doctor。",
      run: (w) => {
        stopSkillAt(w, "0.9.0");
        const run = installedPloop(w, ["queue", "add", "旧版本的项目加不进去", "--stage", "检查"]);
        expectRun(run, 6, "停在 skill 0.9.0", "ploop doctor");
        // 读数据的命令照常，能看到要先做什么。
        expectRun(installedPloop(w, []), 0);
      },
    },
    {
      do: "把仓库里 skill 文件夹里的内容再复制一遍到 ~/.claude/skills/product-loop",
      expect: "里面的文件和仓库里的一致。",
      run: (w) => {
        const repo = w.memo.get("repo") as string;
        const target = skillTarget(w);
        check(
          differences(join(repo, "skill"), target).length > 0,
          "复制以前旧 skill 就和仓库里的一致",
        );
        copySkill(w, repo);
        const problems = differences(join(repo, "skill"), target);
        check(problems.length === 0, `复制以后还有不一致的文件：${problems.join("；")}`);
        check(existsSync(join(target, "references", "落地.md")), "缺的文件没有补上");
      },
    },
    {
      do: "新版装出问题，敲 ploop setup --version 旧版本号",
      expect: "切回已装过的版本，ploop --version 写旧版本号。",
      run: (w) => {
        const old = w.memo.get("old") as Built;
        const run = installedPloop(w, ["setup", "--version", oldVersion]);
        expectRun(run, 0, `切换到了：${oldVersion}（构建号 ${old.build}）`);
        check(
          readlinkSync(join(w.store, "app", "current")) === oldVersion,
          "current 没有切回旧版本",
        );
        const version = installedPloop(w, ["--version"]);
        expectRun(version, 0, `构建号：${old.build}`);
        check(
          version.stdout.split("\n")[0]?.trim() === oldVersion,
          `第一行不是旧的版本号：${version.stdout}`,
        );
      },
    },
  ],
};

/** 页面顶上没有「连不上」的提示。等一下，让页面有时间连接。 */
async function noLostBanner(page: Page): Promise<void> {
  await pause(600);
  check((await page.getByText("连不上").count()) === 0, "顶上写着连不上");
}
