import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { useRunOutputSchema } from "@product-loop/model";
import { describe, expect, it } from "vitest";

// 这个软件自己的使用代码，见第一期计划第 69 到 71 步和第二期计划第 21 步。
// 运行 scripts/use/run.ts，主线的 S1 到 S37 一个不落：人的场景在浏览器里点工作台，
// AI 的场景像 AI 一样把命令敲一遍，安装、后端、升级、恢复和整版的场景两样都用。
// pnpm use 打好运行目录时，使用代码对着产物跑。结果按使用代码的输出格式写出，每一步都要通过，产品做不到主线写的步骤除外：那些步在场景里写了 gap，如实记成断了。
// 每一步的 do 和 expect 和 design/主线.md 逐字相同，对不上运行器就报「对不上主线」。
// 有窗口的步骤，每一步存 1440 和 700 两个宽度的截图，截图文件都在。命令行的步骤没有屏，不编截图。

const repo = new URL("../../../", import.meta.url).pathname;

/** 主线里的场景编号，S1 到 S37。 */
const sceneIds = Array.from({ length: 37 }, (_, i) => `S${i + 1}`);

/**
 * 一步一步都在工作台里点的场景：每一步都要有截图，只有命令行的步骤除外。
 * S11 第 1 步是会话里敲一条命令报上去，S25 第 1 步是 AI 敲命令取消一件事，这两步没有屏，不编截图。
 */
const screenScenes = [
  ...Array.from({ length: 12 }, (_, i) => `S${i + 1}`),
  "S22",
  "S23",
  "S24",
  "S25",
  "S32",
  "S33",
  "S34",
];
const commandOnly = new Set(["S11:1", "S25:1"]);

describe("这个软件自己的使用代码", { timeout: 1_500_000 }, () => {
  it("S1 到 S37 每一步都通过，use-run.json 合乎输出格式，截图齐全", () => {
    const out = mkdtempSync(join(tmpdir(), "ploop-use-code-"));
    try {
      const ran = spawnSync(process.execPath, [join(repo, "scripts/use/run.ts")], {
        cwd: repo,
        env: { ...process.env, PLOOP_USE_OUT: out },
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      expect(
        ran.stdout + ran.stderr,
        "使用代码和主线对不上，或者写了 gap 的步已经走通",
      ).not.toMatch(/对不上主线|产品缺口已修好/u);
      const run = useRunOutputSchema.parse(
        JSON.parse(readFileSync(join(out, "use-run.json"), "utf8")),
      );
      expect(run.scenes.map((scene) => scene.scene)).toEqual(sceneIds);
      const steps = run.scenes.flatMap((scene) => scene.steps);
      // 断了的步只能是已知的产品缺口：场景里写了 gap，运行器记在事实里，说明主线写的和实际。
      // 产品修好了它就走通，运行器提醒删掉 gap；这里不放过没有写 gap 的断点和没走的步。
      const notPassed = steps.filter((step) => step.result !== "pass");
      expect(notPassed.filter((step) => step.facts?.knownGap === undefined)).toEqual([]);
      expect(ran.status).toBe(notPassed.length === 0 ? 0 : 1);

      // 每张截图都是文件，写了截图就写了宽度。
      for (const step of steps) {
        if (step.screenshot === undefined) continue;
        expect(step.width, `${step.screenshot} 没有写宽度`).toBeDefined();
        expect(existsSync(join(out, step.screenshot)), `${step.screenshot} 不在`).toBe(true);
      }
      // 每一步在 1440 和 700 两个宽度下各有一张。
      for (const scene of run.scenes) {
        const byStep = Map.groupBy(scene.steps, (step) => step.step);
        for (const [number, entries] of byStep) {
          const shots = entries.filter((step) => step.screenshot !== undefined);
          if (screenScenes.includes(scene.scene) && !commandOnly.has(`${scene.scene}:${number}`)) {
            expect(shots.length, `${scene.scene} 第 ${number} 步没有截图`).toBeGreaterThan(0);
          }
          if (shots.length === 0) continue;
          const widths = shots.map((step) => step.width);
          expect(widths, `${scene.scene} 第 ${number} 步缺 1440 宽的截图`).toContain(1440);
          expect(widths, `${scene.scene} 第 ${number} 步缺 700 宽的截图`).toContain(700);
        }
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
