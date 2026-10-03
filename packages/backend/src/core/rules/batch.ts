import { defineRule, type PageSections, presentRuleInfo } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import { batchCoveredSamples } from "./batch.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 round.batch.covered：这一轮拿出来、还在进行中的事，每一件都出现在某张卡上。
// 意思见「07 校验」第一节的例子和第四节的 check_queue_source。旧 build-report.py 的
// check_queue_file 要求这个阶段还没做完的事都拿进这一页，按内容的开头几个字对。
// 现在拿出来改在开始一轮时自动完成，卡上按编号引用，所以只查这一轮拿出的事：
// - 开始时取消的、这一轮里做完的、退回待办或改成等待的，都不再算，只查还在进行中的。
// - 这一轮之前给出的某一页已经引用过的，不用再引用。上下文里写着是哪一页。
// 引用写在有卡片编号的七个区块的 queue 里，见 model 的 page/fields.ts。

/** 这一页引用的全部队列事项的编号。 */
function queueRefsOf(page: PageSections): ReadonlySet<string> {
  const lists = [
    page.align,
    page.scenes,
    page.spec,
    page.asks,
    page.findings,
    page.improvements,
    page.changes,
  ];
  const refs = new Set<string>();
  for (const items of lists) {
    for (const item of items ?? []) for (const id of item.queue ?? []) refs.add(id);
  }
  return refs;
}

/** 报错里的内容只写开头，太长的截断。 */
const contentMax = 30;

function short(content: string): string {
  const chars = [...content];
  return chars.length <= contentMax ? content : `${chars.slice(0, contentMax).join("")}……`;
}

export const batchCovered = defineRule({
  ...presentRuleInfo.batchCovered,
  copy: backendRulesCopy.batchCovered,
  check: (subject: PresentSubject, context) => {
    const refs = queueRefsOf(subject.page);
    return context.batch
      .filter((item) => item.coveredBy === undefined && !refs.has(item.id))
      .map((item) => ({ where: item.id, params: { id: item.id, content: short(item.content) } }));
  },
  samples: batchCoveredSamples,
});
