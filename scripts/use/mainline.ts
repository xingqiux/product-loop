import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot, type Scene } from "./lib.ts";

// 使用代码和主线逐字对齐。主线只留一份准本，是 design/主线.md（决定 230）。
// 场景的步数、每步的 do 和 expect 都要和主线里的一样，不一样就报，当场改代码，不改主线迁就。

type MainlineStep = { readonly do: string; readonly expect: string };

/** 主线场景清单里的每个场景：编号写成 S14，步骤按主线的先后。 */
export function mainlineScenes(): Map<string, MainlineStep[]> {
  const lines = readFileSync(join(repoRoot, "design", "主线.md"), "utf8").split("\n");
  const scenes = new Map<string, MainlineStep[]>();
  let current: MainlineStep[] | undefined;
  for (const line of lines) {
    if (line.startsWith("## ")) current = undefined;
    const head = /^### (S\d+) /u.exec(line);
    if (head?.[1] !== undefined) {
      current = [];
      scenes.set(head[1], current);
      continue;
    }
    const step = /^\d+\. (.*)$/u.exec(line);
    if (current === undefined || step?.[1] === undefined) continue;
    const [doText = "", ...rest] = step[1].split(" → ");
    current.push({ do: doText.trim(), expect: rest.join(" → ").trim() });
  }
  return scenes;
}

/** 使用代码和主线对不上的地方，一条一句。all 为真时，主线里有、使用代码里没有的场景也报。 */
export function alignProblems(scenes: readonly Scene[], all: boolean): string[] {
  const mainline = mainlineScenes();
  const problems: string[] = [];
  for (const scene of scenes) {
    const written = mainline.get(scene.scene);
    if (written === undefined) {
      problems.push(`${scene.scene} 不在主线里`);
      continue;
    }
    if (written.length !== scene.steps.length) {
      problems.push(
        `${scene.scene} 主线有 ${written.length} 步，使用代码有 ${scene.steps.length} 步`,
      );
    }
    for (const [i, step] of scene.steps.entries()) {
      const line = written[i];
      if (line === undefined) continue;
      if (step.do !== line.do) {
        problems.push(
          `${scene.scene} 第 ${i + 1} 步的 do 和主线不同：「${step.do}」，主线「${line.do}」`,
        );
      }
      if (step.expect !== line.expect) {
        problems.push(
          `${scene.scene} 第 ${i + 1} 步的 expect 和主线不同：「${step.expect}」，主线「${line.expect}」`,
        );
      }
    }
  }
  if (all) {
    const have = new Set(scenes.map((scene) => scene.scene));
    for (const id of mainline.keys()) {
      if (!have.has(id)) problems.push(`主线里的 ${id} 没有使用代码`);
    }
  }
  return problems;
}
