import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeBrowser } from "./browser.ts";
import { repoRoot, type Scene, type World, world } from "./lib.ts";
import { alignProblems } from "./mainline.ts";

// 这个软件自己的使用代码的运行器，见第一期计划第 69 到 71 步。
// 用法：node scripts/use/run.ts [场景编号…]，不写就跑全部。通常由 ploop use run -- 调用。
// 场景分三类，各类有哪些编号，见 design/主线.md 的场景清单开头：
// 人的场景起浏览器点工作台，见 browser.ts；AI 的场景只敲命令；安装、后端、升级、恢复和整版的场景两样都用。
// 每个场景从干净的临时目录开始，一步一步走，核对输出和退出码。
// 每一步的 do 和 expect 和 design/主线.md 逐字相同，对不上就报，退出码 1，见 mainline.ts。
// 每一步走完，有窗口的场景按 1440 和 700 两个宽度各截一张，步号相同、宽度不同，各写一项。
// 命令行的场景没有屏，不编截图，使用记录的事实里记下这一步敲过的命令、退出码和输出的开头。
// 结果按使用代码的输出格式写进 PLOOP_USE_OUT 下的 use-run.json，截图放在 screens/ 下。
// 没有这个变量时写进一个临时目录。有一步没有通过，退出码 1。

type StepOutput = {
  step: number;
  width?: number;
  do: string;
  expect: string;
  result: "通过" | "断了" | "没走";
  screenshot?: string;
  facts?: Record<string, unknown>;
  error?: string;
};

/** 每一步都截这两个宽度：宽屏和半屏窗口最窄的宽度。 */
const widths = [1440, 700] as const;

const scenesDir = join(repoRoot, "scripts", "use", "scenes");

/** 场景文件按编号排：S13.ts、S14.ts……。 */
async function loadScenes(only: readonly string[]): Promise<Scene[]> {
  const files = readdirSync(scenesDir)
    .filter((name) => /^S\d+\.ts$/u.test(name))
    .sort((a, b) => Number(a.slice(1, -3)) - Number(b.slice(1, -3)));
  const scenes: Scene[] = [];
  for (const file of files) {
    const id = file.slice(0, -3);
    if (only.length > 0 && !only.includes(id)) continue;
    const module = (await import(join(scenesDir, file))) as { scene: Scene };
    scenes.push(module.scene);
  }
  return scenes;
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** 这一步的窗口按各个宽度截图，存进 screens/。窗口没有开着，或者截不了，返回空。 */
async function shoot(
  w: World,
  outDir: string,
  scene: string,
  step: number,
  onlyCurrent: boolean,
): Promise<{ width: number; screenshot: string; facts: Record<string, unknown> }[]> {
  const frame = w.frame.current;
  if (frame === undefined || !frame.isOpen()) return [];
  const own = frame.width();
  const wanted = onlyCurrent ? [own] : [own, ...widths.filter((width) => width !== own)];
  const shots: { width: number; screenshot: string; facts: Record<string, unknown> }[] = [];
  for (const width of wanted) {
    try {
      const { png, facts } = await frame.shoot(width);
      const path = `screens/${scene}-${step}-${width}.png`;
      mkdirSync(join(outDir, "screens"), { recursive: true });
      writeFileSync(join(outDir, path), png);
      shots.push({ width, screenshot: path, facts });
    } catch {
      // 窗口在这一步里关了，或者截不了：这一宽度没有截图，不当成断点
    }
  }
  return shots;
}

/** 写了产品缺口、这次却走通的步：缺口已经修好，该把 gap 删掉。 */
const fixed: string[] = [];

async function runScene(scene: Scene, outDir: string): Promise<StepOutput[]> {
  const w = world();
  const out: StepOutput[] = [];
  let broken: string | undefined;
  try {
    try {
      await scene.setup?.(w);
    } catch (error) {
      broken = `摆状态时出错：${reason(error)}`;
    }
    for (const [i, step] of scene.steps.entries()) {
      const base = { step: i + 1, do: step.do, expect: step.expect };
      if (broken !== undefined) {
        out.push({ ...base, result: "没走", error: broken });
        continue;
      }
      w.commands.length = 0;
      let failure: string | undefined;
      try {
        await step.run(w);
        if (step.gap !== undefined) fixed.push(`${scene.scene} 第 ${i + 1} 步`);
      } catch (error) {
        failure = reason(error);
        // 已知的产品缺口照常记成断了，但不停下这个场景，后面的步接着走，才看得到它们是不是通过
        if (step.gap === undefined) broken = `第 ${i + 1} 步断了`;
      }
      const commands = w.commands.splice(0).map((note) => ({ ...note }));
      // 断在这一步的只截当时的宽度；已知的产品缺口场景接着走，两个宽度都截
      const shots = await shoot(
        w,
        outDir,
        scene.scene,
        i + 1,
        failure !== undefined && step.gap === undefined,
      );
      const gap = failure !== undefined && step.gap !== undefined ? { knownGap: step.gap } : {};
      const first = commands.length === 0 ? {} : { commands };
      if (shots.length === 0) {
        out.push({
          ...base,
          result: failure === undefined ? "通过" : "断了",
          ...(Object.keys({ ...first, ...gap }).length === 0
            ? {}
            : { facts: { ...first, ...gap } }),
          ...(failure === undefined ? {} : { error: failure }),
        });
        continue;
      }
      for (const [j, shot] of shots.entries()) {
        out.push({
          ...base,
          width: shot.width,
          result: failure === undefined ? "通过" : "断了",
          screenshot: shot.screenshot,
          facts: { ...shot.facts, ...(j === 0 ? first : {}), ...gap },
          ...(failure === undefined ? {} : { error: failure }),
        });
      }
    }
  } finally {
    await w.cleanup();
  }
  return out;
}

const only = process.argv.slice(2);
const startedAt = new Date().toISOString();
const outDir = process.env.PLOOP_USE_OUT ?? mkdtempSync(join(tmpdir(), "ploop-use-out-"));
mkdirSync(outDir, { recursive: true });
const loaded = await loadScenes(only);
const problems = alignProblems(loaded, only.length === 0);
for (const problem of problems) console.log(`对不上主线：${problem}`);
const results: { scene: string; steps: StepOutput[] }[] = [];
for (const scene of loaded) {
  const steps = await runScene(scene, outDir);
  results.push({ scene: scene.scene, steps });
  const failed = steps.filter((step) => step.result !== "通过");
  console.log(
    failed.length === 0
      ? `${scene.scene} 走通了`
      : `${scene.scene} 第 ${failed[0]?.step} 步${failed[0]?.result}：${failed[0]?.error}`,
  );
}
await closeBrowser();
for (const step of fixed) console.log(`产品缺口已修好：${step}走通了，把它的 gap 删掉`);
const run = {
  schemaVersion: 1,
  startedAt,
  finishedAt: new Date().toISOString(),
  environment: `node ${process.version}，${process.platform}，Chrome 无头，窗口宽 ${widths.join(" 和 ")} 像素`,
  scenes: results,
};
writeFileSync(join(outDir, "use-run.json"), `${JSON.stringify(run, null, 2)}\n`);
console.log(`结果：${join(outDir, "use-run.json")}`);
const allPassed = results.every(({ steps }) => steps.every((step) => step.result === "通过"));
process.exit(allPassed && problems.length === 0 && fixed.length === 0 ? 0 : 1);
