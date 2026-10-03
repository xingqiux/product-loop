import { readFileSync } from "node:fs";
import { convertLegacyPage, type LegacyPageContext, stage as stageEnum } from "@product-loop/model";
import { describe, expect, it } from "vitest";
import {
  queueEntriesOf,
  sceneEntriesOf,
} from "../../../../model/src/legacy/convert-page.samples.ts";
import { mainlineStatus, pushRevision } from "../mainline.ts";
import { startRound } from "../rounds/start.ts";
import { addProject, emptyCore } from "../testing.ts";
import { checkHistoryPage } from "./check.ts";

// 旧的反例样本和历史页面，和新的校验逐份对照，见第一期计划第 29、63 步和 docs/校验对照表.md。
// - 反例样本：转换以后按平时的方式校验，页面日期取很晚的一天，规则都不跳过。判定和旧的不同的，
//   每一份都在下面的表里归了类，表和对照表的第一节一一对应。
// - check_mainline 的两份样本依赖主线，在这里按开始一轮补对（反例对照里的 check_mainline 在这里补对）。
// - 历史页面：model 的八页真实页面按历史页面模式校验，拦截的每一处在对照表的第二节归了类。

type SampleFile = { readonly json?: unknown; readonly text?: string };
type Sample = {
  readonly id: string;
  readonly input: unknown;
  readonly actual: string;
  readonly files?: Readonly<Record<string, SampleFile>>;
  readonly messages: readonly { readonly check: string; readonly level: string }[];
};

const repoFile = (path: string) => new URL(`../../../../../${path}`, import.meta.url);
const samples = (
  JSON.parse(readFileSync(repoFile("tools/legacy/out/samples.json"), "utf8")) as {
    readonly samples: readonly Sample[];
  }
).samples;
const skillMainline = readFileSync(
  repoFile("packages/model/src/mainline/__fixtures__/skill-own.md"),
  "utf8",
);
const scenes = sceneEntriesOf(skillMainline);

/** 规则都不跳过的一天。 */
const farFuture = "2099-01-01";

/** 新的判定：拦截、警告或通过。 */
function verdictOf(sample: Sample): string {
  const context: LegacyPageContext = {
    queue: queueEntriesOf(sample.files?.["队列.json"]?.json),
    scenes,
  };
  const converted = convertLegacyPage(sample.input, context);
  if (!converted.ok) return "block";
  const { page, stage } = converted.value;
  const check = checkHistoryPage(page, stage, farFuture);
  return check.block.length > 0 ? "block" : check.warn.length > 0 ? "warn" : "pass";
}

/**
 * 判定是否拦截和旧的不同的样本，和归到的类。
 * - backend：依赖队列文件、主线或落地记录，在后端对照（第 44 步和这里）。
 * - intended：有意的改动，依据写在对照表里。
 */
const differences: ReadonlyMap<string, "backend" | "intended"> = new Map([
  // 旧的拦截，新的放过
  ["legacy-009", "intended"],
  ["legacy-013", "intended"],
  ["legacy-014", "backend"],
  ["legacy-015", "backend"],
  ["legacy-016", "backend"],
  ["legacy-017", "backend"],
  ["legacy-018", "backend"],
  ["legacy-019", "backend"],
  ["legacy-023", "backend"],
  ["legacy-025", "intended"],
  ["legacy-033", "backend"],
  ["legacy-034", "backend"],
  ["legacy-054", "intended"],
  ["legacy-055", "intended"],
  ["legacy-061", "backend"],
  ["legacy-089", "intended"],
  // 旧的放过，新的拦截
  ["legacy-057", "intended"],
  ["legacy-058", "intended"],
  ["legacy-088", "intended"],
  ["legacy-106", "intended"],
  ["legacy-113", "intended"],
]);

describe("反例样本逐份对照", () => {
  it("是否拦截和旧的不同的，都在对照表里归了类", () => {
    const differ = samples
      .filter((sample) => (sample.actual === "block") !== (verdictOf(sample) === "block"))
      .map((sample) => sample.id);
    expect(differ).toEqual([...differences.keys()].sort());
  });

  it("归到后端对照的，都是依赖队列文件、主线或落地记录的检查", () => {
    const contextual = new Set(["check_queue_source", "check_mainline", "check_land"]);
    const backend = samples.filter((sample) => differences.get(sample.id) === "backend");
    for (const sample of backend) {
      expect(sample.messages.some((message) => contextual.has(message.check))).toBe(true);
    }
  });
});

describe("check_mainline 在后端对照", () => {
  const mainlineSamples = samples.filter((sample) =>
    sample.messages.some((message) => message.check === "check_mainline"),
  );

  /** 用样本的主线开始一轮，阶段取样本页面的阶段。 */
  async function startWith(sample: Sample) {
    return (await startWithCore(sample)).result;
  }

  async function startWithCore(sample: Sample) {
    const core = await emptyCore();
    addProject(core, "/work/app");
    const text = sample.files?.["主线.md"]?.text ?? "";
    const pushed = pushRevision(core.ctx, "app", { text, baseRevision: null, source: "cache" });
    if (!pushed.ok) throw new Error(pushed.error.message);
    const label = (sample.input as { stage?: string }).stage ?? "";
    const stage = stageEnum.key(label);
    if (stage === undefined) throw new Error(`样本的阶段认不出：${label}`);
    return { core, result: startRound(core.ctx, "app", { stage }) };
  }

  it("检查阶段缺设计规范的：进入检查时由 mainline.spec.twelve 拦截，缺的几样相同", async () => {
    const blocked = mainlineSamples.filter((sample) => sample.actual === "block");
    expect(blocked.map((sample) => sample.id)).toEqual(["legacy-061"]);
    for (const sample of blocked) {
      const { core, result } = await startWithCore(sample);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error).toMatchObject({ code: "RULE_BLOCKED", rule: "mainline.spec.twelve" });
      // 缺的几样只在 ploop mainline check 里列，这里写件数，动效和无障碍两样一定在缺的里面。
      expect(result.error.message).toMatch(/^设计规范缺 \d+ 个部分/u);
      const missing = mainlineStatus(core.ctx.db, "app").missingDesignSpec;
      expect(missing).toEqual(expect.arrayContaining(["motion", "accessibility"]));
    }
  });

  it("别的阶段旧的提醒，现在不查十二样（有意的改动，只在进入检查时查一次）", async () => {
    const warned = mainlineSamples.filter((sample) => sample.actual === "warn");
    expect(warned.map((sample) => sample.id)).toEqual(["legacy-062"]);
    for (const sample of warned) {
      const result = await startWith(sample);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const rules = result.value.warnings.map((issue) => issue.rule);
      expect(rules).not.toContain("mainline.spec.twelve");
    }
  });
});

describe("历史页面逐份对照", () => {
  const fixture = (path: string) =>
    readFileSync(repoFile(`packages/model/src/legacy/__fixtures__/pages/${path}`), "utf8");
  const skillOwn: LegacyPageContext = {
    queue: queueEntriesOf(JSON.parse(fixture("skill-own/queue.json"))),
    scenes,
  };

  /**
   * 每一页按历史页面模式拦截的地方。当时这些页都通过了旧的构建校验，所以每一处都是差异。
   * 类别见对照表第二节：第二类是有意的改动，第三类是历史数据本身的问题，迁移时由 AI 按报错改。
   */
  const expected: readonly (readonly [string, readonly string[]])[] = [
    // 第三类：位置写的场景名在主线里找不到
    ["skill-own/2026-09-19/think-2.json", ["page.field.missing asks[2].where.scene"]],
    ["skill-own/2026-09-19/report-2.json", []],
    // 和规则同一天生成的页，按天分不出先后，历史页面模式跳过当天起执行的规则
    ["skill-own/2026-09-20/check-2.json", []],
    ["skill-own/2026-09-20/fix-2.json", []],
    // 落地页的提升转换时挪进疑问（决定 189）
    ["skill-own/2026-09-20/land-17.json", []],
    ["skill-own/2026-09-20/think-27.json", []],
    ["skill-own/2026-09-20/use-1.json", []],
    // 第二类：区块按阶段收紧
    ["skill-own/2026-09-20/improve-1.json", ["page.stage.changes changes"]],
  ];

  it("八页的拦截逐处和对照表相同", () => {
    const actual = expected.map(([path]) => {
      const context = path.startsWith("skill-own/") ? skillOwn : { queue: [], scenes: [] };
      const converted = convertLegacyPage(JSON.parse(fixture(path)), context);
      if (!converted.ok) return [path, [converted.error.message]] as const;
      const { page, stage, date } = converted.value;
      const pageDate = date ?? path.split("/")[1] ?? farFuture;
      const check = checkHistoryPage(page, stage, pageDate);
      return [path, check.block.map((issue) => `${issue.rule} ${issue.where ?? ""}`)] as const;
    });
    expect(actual).toEqual(expected);
  });
});
