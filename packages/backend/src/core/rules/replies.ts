import {
  defineRule,
  type HandledLine,
  handleRuleInfo,
  presentRuleInfo,
  renderCopy,
  roundNameOfLabel,
} from "@product-loop/model";
import { repliesCopy } from "../../copy/replies.ts";
import { backendRulesCopy } from "../../copy/rules.ts";
import { imagesReadSamples, lineHandledSamples } from "./replies.samples.ts";

// 依赖回复的两条规则，见「07 校验」第四节的新规则。
// reply.line.handled：上一份回复的每一行都有了去处，下一页才给得出来，下一轮才开得了。
//   见「03 数据模型」第二节：还有没处理的行时，下一页给不出来。
//   在给出信息时和别的后端规则一起执行，开始一轮时由 rounds/start.ts 单独执行。
//   它只看上下文里还有行没处理的回复，不看要给出的页面，所以查的数据写成 unknown。
//   后端取的是这个项目全部还有行没处理的回复，每一份报一处，写明是哪几行。
// reply.images.read：处理带图的行时，要确认已经读过这一行的图，见「04 命令行」第十节。
//   命令行的 --read-images 给每一行写上已读。以前处理时已经确认读过的，不再要求。
//   想法框里的行也在这里处理，带图时同样要先读图。

/** 没处理的行号写成「第 3 行、第 5 行」。 */
function linesText(lines: readonly number[]): string {
  return lines.map((line) => renderCopy(repliesCopy.where, { line })).join("、");
}

export const lineHandled = defineRule({
  ...presentRuleInfo.lineHandled,
  copy: backendRulesCopy.lineHandled,
  check: (_subject: unknown, context) =>
    context.unhandledReplies.map((reply) => ({
      where: roundNameOfLabel(reply.round),
      params: { round: roundNameOfLabel(reply.round), lines: linesText(reply.lines) },
    })),
  samples: lineHandledSamples,
});

export const imagesRead = defineRule({
  ...handleRuleInfo.imagesRead,
  copy: backendRulesCopy.imagesRead,
  check: (lines: readonly HandledLine[]) =>
    lines.flatMap((line, i) =>
      line.images === 0 || line.imagesRead
        ? []
        : [{ where: [i, "imagesRead"], params: { line: line.line, count: line.images } }],
    ),
  samples: imagesReadSamples,
});
