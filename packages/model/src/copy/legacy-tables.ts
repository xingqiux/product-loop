import { copy } from "./define.ts";

// 旧队列和旧决定表迁移时的说明，见 legacy/queue-table.ts、legacy/decision-table.ts
// 和「08 版本与迁移」第五节。体检的报告和 migrate/ 里的对照表都用它们，写给做迁移的 AI 看。
// 每条是一句完整的话，写这一行或这一件要确认什么。

export const legacyQueueCopy = {
  /** 一件事要 AI 确认的地方，键是 LegacyQueueCheck 的 kind。 */
  check: {
    verify: copy("写着「已进第几轮」，查提交记录以后定为已完成或待办。"),
    statusUnknown: copy("状态写着「{text}」，迁移的对照里没有这种写法，暂按待核对。", {
      text: "先放着",
    }),
    proposerUnknown: copy("谁提的写着「{text}」，看不出是用户还是 AI，暂写 AI。", {
      text: "李昶乐",
    }),
    proposerMissing: copy("没写谁提的，暂写 AI。"),
    stageUnknown: copy("阶段写着「{text}」，不是五个阶段之一。", { text: "复盘" }),
    dateMissing: copy("没有日期，或者日期不是 2026-09-20 这样的写法。"),
    contentEmpty: copy("没写内容。"),
    fieldMissing: copy("建议的状态是{status}，但没写{field}。", {
      status: "已完成",
      field: "完成证据",
    }),
  },
  /** 整份文件的问题，键是 LegacyQueueProblem 的 kind。 */
  problem: {
    noTable: copy("队列.md 里没有表头带内容和状态两列的表格。"),
    columnCount: copy("第 {line} 行有 {count} 格，和队列表格的表头对不上，没有读。", {
      line: 12,
      count: 4,
    }),
    notQueue: copy("队列.json 的格式不对，读不出事项。"),
    itemShape: copy("队列.json 的第 {at} 件不是对象，没有读。", { at: 3 }),
  },
};

export const legacyDecisionCopy = {
  /** 一行要改的地方，键是 LegacyDecisionProblem 的 kind。 */
  problem: {
    dateMissing: copy("没有日期，迁移时缺日期。"),
    /** 没有日期，这一行的字里写着一个日期。 */
    dateSuggested: copy("没有日期。这一行写着 {date}，确认以后用它。", { date: "2026-09-20" }),
    dateInvalid: copy("日期写成「{text}」，要写成 2026-09-20 这样。", { text: "9 月 20 日" }),
    laterWithoutCase: copy("以后再说的一行没有案例。旧表格本来没有这一列，不补。"),
    caseMissing: copy("案例一格是空的。"),
    voidedByMissing: copy("写着已作废，没写被哪一条推翻。"),
    voidedByMany: copy("写着被第 {ids} 条推翻，决定只能记一条。", { ids: "41、42" }),
    voidUnclear: copy("文字里提到已作废，看不出是不是整条作废，暂按有效。"),
    idInvalid: copy("编号写成「{text}」，不是数字，已按出现的顺序另编。", { text: "3a" }),
    idDuplicate: copy("编号和第 {lines} 行重复，已另编。", { lines: "9、12" }),
    textMissing: copy("{field}一格是空的。", { field: "原因" }),
  },
  /** 没有读的一行，键是 LegacyDecisionSkip 的 reason。 */
  skip: {
    unknownTable: copy("这张表不是决定表，这一行没有读。"),
    columnCount: copy("这一行有 {count} 格，和哪张决定表都对不上，没有读。", { count: 6 }),
  },
};
