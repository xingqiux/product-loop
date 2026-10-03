import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkWriting } from "../writing/check.ts";
import type { ProjectWritingSpec } from "../writing/glossary.ts";
import { checkReply } from "../writing/reply.ts";
import { type WritingResult, writingRules } from "../writing/rules.ts";
import { type RuleRun, runRules } from "./run.ts";
import { type WritingSubject, writingRuleList } from "./writing.ts";

// 写作规则只是把 checkWriting 和 checkReply 查出的问题按编号分给各条规则。
// 这里拿旧脚本对照用的全部文字，核对经过规则框架和直接调用查出的问题一样。

type Case = { readonly id: string; readonly kind: string; readonly text: string };

const file = new URL("../../../../tools/legacy/out/writing-cases.json", import.meta.url);
const cases = (JSON.parse(readFileSync(file, "utf8")) as { readonly cases: readonly Case[] }).cases;

const noSpec: ProjectWritingSpec = { banned: [], exceptions: [] };

/** 拦截和警告写成排好序的「编号：报错」，顺序不同不算不同。 */
function sorted({ block, warn }: WritingResult | RuleRun) {
  const lines = (list: readonly { readonly rule: string; readonly message: string }[]) =>
    list.map((x) => `${x.rule}：${x.message}`).sort();
  return { block: lines(block), warn: lines(warn) };
}

function viaRules(subject: WritingSubject, spec = noSpec) {
  return sorted(runRules(writingRuleList, subject, { writingSpec: spec }));
}

describe("写作规则和写作校验查出的问题相同", () => {
  it("每条规则的级别和报错取自 writingRules", () => {
    expect(writingRuleList.map((rule) => rule.id)).toEqual(Object.keys(writingRules));
    for (const rule of writingRuleList) {
      const def = writingRules[rule.id as keyof typeof writingRules];
      expect(rule.level).toBe(def.level);
      expect(rule.copy.message).toBe(def.copy);
      // 只有停用的说法、回复的首行和文件名、措辞一类的五项带提示，别的规则没有
      const hint = (def as { hint?: unknown }).hint;
      expect(rule.copy.hint).toBe(hint);
      const withHint = [
        "writing.term.banned",
        "writing.reply.firstLine",
        "writing.reply.fileName",
        "writing.wording.redBlue",
        "writing.wording.interpunct",
        "writing.wording.spoken",
        "writing.wording.numberRef",
        "writing.wording.statistics",
      ];
      expect(hint !== undefined).toBe(withHint.includes(rule.id));
    }
  });

  it("旧脚本对照用的每一段文字，按页面文字查和按会话回复查都相同", () => {
    expect(cases.length).toBeGreaterThan(100);
    const reply = new Set(["selftest", "reply"]);
    const differ = cases.filter((c) => {
      const kind = reply.has(c.kind) ? "reply" : "text";
      const direct = kind === "reply" ? checkReply(c.text) : checkWriting(c.text);
      return JSON.stringify(viaRules({ kind, text: c.text })) !== JSON.stringify(sorted(direct));
    });
    expect(differ.map((c) => c.id)).toEqual([]);
  });

  it("项目主线加的停用说法和例外也一样生效", () => {
    const spec: ProjectWritingSpec = {
      banned: [{ phrase: "看板", replacement: "队列" }],
      exceptions: ["约翰·史密斯"],
    };
    const text = "看板上写着约翰·史密斯的名字。";
    const direct = sorted(checkWriting(text, { project: spec }));
    expect(direct.block).toEqual([
      "writing.term.banned：出现了术语表停用的说法「看板」，统一的术语是「队列」",
    ]);
    expect(direct.warn).toEqual([]);
    expect(viaRules({ kind: "text", text }, spec)).toEqual(direct);
  });

  it("同一段文字换了写作规范，重新查，不用上一次的结果", () => {
    const subject: WritingSubject = { kind: "text", text: "看板上写了负责人。" };
    const banned: ProjectWritingSpec = {
      banned: [{ phrase: "看板", replacement: "队列" }],
      exceptions: [],
    };
    expect(viaRules(subject).block).toEqual([]);
    expect(viaRules(subject, banned).block).toHaveLength(1);
    expect(viaRules(subject).block).toEqual([]);
  });
});
