import type { Rule } from "@product-loop/model";
import { unclearReworded } from "./align.ts";
import { batchCovered } from "./batch.ts";
import { blobPresent } from "./blobs.ts";
import { cardsNone } from "./cards.ts";
import { imagesRead, lineHandled } from "./replies.ts";
import { coverChanged } from "./screens.ts";
import { oneWaiting } from "./waiting.ts";

// 后端的规则，见「07 校验」第三节：要查数据库的规则放在后端的内核里，写法和共用定义里的相同。
// 说明登记在 model 的 rules/backend.ts，这里展开说明，加上检查、报错和样本。
// 总测试逐条核对两边对得上，见 registry.test.ts。

export type { PresentContext } from "./subject.ts";

/**
 * 给出信息时执行的后端规则，顺序和 model 的 presentRuleInfo 相同。
 * 查的数据是 PresentSubject，每条只拿到自己要的上下文，合起来是 PresentContext。
 * reply.line.handled 不看页面，开始一轮时由 rounds/start.ts 单独执行。
 */
export const backendRuleList: readonly Rule[] = [
  batchCovered,
  oneWaiting,
  cardsNone,
  blobPresent,
  lineHandled,
  coverChanged,
  unclearReworded,
];

/** 处理回复时执行的后端规则，顺序和 model 的 handleRuleInfo 相同。查的数据是要处理的各行。 */
export const handleRuleList: readonly Rule[] = [imagesRead];

export { lineHandled };
