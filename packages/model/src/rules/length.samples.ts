import type { RuleContextOf, RuleSamples } from "./rule.ts";

// 规矩 queue.content.tooLong 和 decision.decision.tooLong 的样本，见「07 校验」第六节。
// 基础数据刚好 40 个字，是合格的最长写法；会命中的样本多一个字。
// 标点和空白不算字，一串英文或数字算一个字，链接不算，见 writing/check.ts 的 writingLength。

type Samples = RuleSamples<string, RuleContextOf<never>>;

// 40 个字，逗号不算。
const queueFit =
  "队列看板按阶段分五列，等待的事放在最上面，停了七天的卡片要淡一些，点开卡片能看各项属性";
// 41 个字。
const queueLong =
  "队列看板按阶段分五列，等待的事放在最上面，停了七天的卡片要淡一些，点开卡片能看到各项属性";
// 40 个字，逗号不算。
const decisionFit =
  "决定表默认只列有效的，能切换成全部，作废的划掉写明被哪一条推翻，能按词搜索决定原因案例";
// 41 个字。
const decisionLong =
  "决定表默认只列有效的，能切换成全部，作废的划掉并写明被哪一条推翻，能按词搜索决定原因案例";

/** 命中的一条：字数写现在的，上限写 40。 */
const hit = (where: string, length: number) => ({ where, params: { length, limit: 40 } });

const queueContent: Samples = {
  base: { subject: queueFit, context: {} },
  hits: [
    {
      why: "内容 41 个字，比上限多一个字",
      subject: queueLong,
      expect: [hit("content", 41)],
    },
    {
      why: "一段话写成内容：标点不算字，字照样超过",
      subject:
        "看板上每一列先摆八件，超过的折叠起来。点开折叠的部分能看到全部，再点一次收起来。不同阶段的列各自折叠。",
      expect: [hit("content", 46)],
    },
    {
      why: "英文和数字一串算一个字，路径不会让一句话显得很长，但别的字超过就是超过",
      subject:
        "把 packages/web/src/features/queue/board.tsx 里每列先摆的件数从 8 件改成 12 件，同时让折叠的一列显示还有几件没摆出来，并且补上测试和场景",
      expect: [hit("content", 44)],
    },
  ],
};

const decision: Samples = {
  base: { subject: decisionFit, context: {} },
  hits: [
    {
      why: "「决定」一项 41 个字，比上限多一个字",
      subject: decisionLong,
      expect: [hit("decision", 41)],
    },
    {
      why: "把原因也写进了决定：一句话变成一段话",
      subject:
        "队列看板默认按阶段分列，因为用户按阶段找事，按状态分列时同一阶段的事散在几列里，要来回找。",
      expect: [hit("decision", 41)],
    },
  ],
};

export const lengthSamples = { queueContent, decision };
