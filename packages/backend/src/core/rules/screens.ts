import { defineRule, parseSceneId, presentRuleInfo } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import { coverChangedSamples } from "./screens.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 screens.coverChanged：检查阶段的元素清单盖住这一版新出现和变过的每一屏，
// 见「07 校验」第四节的 screens.cover-changed。屏按场景编号和步号对，不看宽度。
// 变过的屏由调用的一方从屏的记录里取，只在检查轮里取，别的阶段的上下文是空列表。
// 元素清单里的场景编号写成 S03 和 S3 都算同一个。

/** 场景编号和步号拼成的键。编号读不出时用原文。 */
function keyOf(scene: string, step: number): string {
  const parsed = parseSceneId(scene);
  return `${parsed.ok ? String(parsed.value) : scene}:${String(step)}`;
}

export const coverChanged = defineRule({
  ...presentRuleInfo.coverChanged,
  copy: backendRulesCopy.coverChanged,
  check: (subject: PresentSubject, context) => {
    const covered = new Set(
      (subject.page.screens ?? []).flatMap((screen) =>
        screen.where === undefined ? [] : [keyOf(screen.where.scene, screen.where.step)],
      ),
    );
    return context.changedScreens
      .filter((screen) => !covered.has(keyOf(screen.scene, screen.step)))
      .map((screen) => ({
        where: ["screens"],
        params: { scene: screen.scene, step: screen.step },
      }));
  },
  samples: coverChangedSamples,
});
