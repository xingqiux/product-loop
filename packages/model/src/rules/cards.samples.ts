import { validPage } from "../page/page.samples.ts";
import { pageSectionsSchema } from "../page/sections.ts";
import type { PageContext, PageSubject } from "./cards.ts";
import type { RuleSamples } from "./rule.ts";

// 页面规则第一批的样本，见「07 校验」第六节。options.samples.ts 和 sources.samples.ts 也用这里的基础数据。
// 基础数据取数据定义的合格样本 validPage。三种卡片都有，另有写了 only 的卡、最后一个「不改」和三种来源。
// 会命中的样本在它上面改一处，改完再过一遍数据定义，因为规则只查通过了定义的页面数据。
// 旧 skill 的反例样本里有同样改法的，why 里写明是哪一份，第 29 步按它对照。

/** 字段的路径，写法和问题的 path 相同。 */
type SamplePath = readonly (string | number)[];

/** 一处修改：路径和新的值。值写 undefined 时删掉这一处。 */
export type Change = readonly [SamplePath, unknown];

type Samples = RuleSamples<PageSubject, PageContext>;

/** 按路径改一处。路径不对说明样本写错了，直接抛出。 */
function apply(root: unknown, [path, value]: Change): void {
  const last = path.at(-1);
  let node = root;
  for (const part of path.slice(0, -1)) {
    if (typeof node !== "object" || node === null) break;
    node = (node as Record<string | number, unknown>)[part];
  }
  if (last === undefined || typeof node !== "object" || node === null) {
    throw new Error(`样本里没有 ${path.join(".")}`);
  }
  const parent = node as Record<string | number, unknown>;
  if (value !== undefined) parent[last] = value;
  else if (Array.isArray(parent) && typeof last === "number") parent.splice(last, 1);
  else delete parent[last];
}

/** 基础数据：数据定义的合格样本，解析以后的样子。 */
export const basePage: PageSubject = pageSectionsSchema.parse(validPage);

/** 这一批规则不要上下文。 */
export const noContext: PageContext = {};

/** 在基础数据的拷贝上改几处，再过一遍数据定义。改完不合定义时抛出，说明样本写错了。 */
export function pageWith(...changes: readonly Change[]): PageSubject {
  const page: unknown = JSON.parse(JSON.stringify(validPage));
  for (const change of changes) apply(page, change);
  return pageSectionsSchema.parse(page);
}

/** 基础数据里几张卡在报错里的称呼：区块的名字和卡的标题。 */
export const baseCards = {
  ask: { section: "疑问", title: "队列看板放在哪里" },
  followUp: { section: "疑问", title: "上次你自己做这件事是什么时候" },
  finding: { section: "发现问题", title: "每一块名字下面的说明没有必要" },
  improvement: { section: "提升", title: "队列看板加一个筛选" },
};

const { ask, followUp, improvement } = baseCards;
const base = { subject: basePage, context: noContext };

/** 写了 only 的提升卡上再加的一个选项。 */
const secondFilter = {
  key: "b",
  title: "按提出者筛选",
  diffs: ["看板上方一个下拉框。"],
  why: "提出者多的项目好找。",
  cost: "多一个下拉框。",
};

export const cardSamples = {
  "card.only.one": {
    base,
    hits: [
      {
        why: "写了 only 的卡又加了一个选项",
        subject: pageWith(
          [["improvements", 0, "options", 1], secondFilter],
          [["improvements", 0, "shared"], { text: "筛选都放在看板上方。" }],
        ),
        expect: [{ where: ["improvements", 0, "options"], params: { ...improvement, count: 2 } }],
      },
      {
        why: "写了 only 的卡没有选项",
        subject: pageWith([["improvements", 0, "options"], undefined]),
        expect: [{ where: ["improvements", 0, "options"], params: { ...improvement, count: 0 } }],
      },
    ],
  },
  "card.only.dropped": {
    base,
    hits: [
      {
        why: "写了只有这一个方向，却没有列出排除掉的方向，同旧样本 legacy-109",
        subject: pageWith([["asks", 0, "options", 1], undefined], [["asks", 0, "only"], true]),
        expect: [{ where: ["asks", 0, "dropped"], params: ask }],
      },
      {
        why: "写了 only 的卡删掉了排除掉的方向",
        subject: pageWith([["improvements", 0, "dropped"], undefined]),
        expect: [{ where: ["improvements", 0, "dropped"], params: improvement }],
      },
    ],
  },
  "card.only.needed": {
    base,
    hits: [
      {
        why: "只有一个选项，没有写明只有这一个方向，同旧样本 legacy-108",
        subject: pageWith([["asks", 0, "options", 1], undefined]),
        expect: [{ where: ["asks", 0, "only"], params: ask }],
      },
      {
        why: "只有一个选项的卡删掉了 only，留着排除掉的方向",
        subject: pageWith([["improvements", 0, "only"], undefined]),
        expect: [{ where: ["improvements", 0, "only"], params: improvement }],
      },
    ],
  },
  "card.row.width": {
    base,
    hits: [
      {
        why: "行名九个字，刚过上限，同旧样本 legacy-100",
        subject: pageWith([["asks", 0, "rows", 0], "页面上会出现的变化"]),
        expect: [
          {
            where: ["asks", 0, "rows", 0],
            params: { ...ask, row: "页面上会出现的变化", width: 9 },
          },
        ],
      },
      {
        why: "行名夹着英文，显示起来一样宽，同旧样本 legacy-101",
        subject: pageWith([["asks", 0, "rows", 0], "是否支持 markdown 渲染"]),
        expect: [
          {
            where: ["asks", 0, "rows", 0],
            params: { ...ask, row: "是否支持 markdown 渲染", width: 10 },
          },
        ],
      },
    ],
  },
  "card.shared.required": {
    base,
    hits: [
      {
        why: "两个选项的卡删掉了 shared，同旧样本 legacy-092",
        subject: pageWith([["asks", 0, "shared"], undefined]),
        expect: [{ where: ["asks", 0, "shared"], params: { ...ask, count: 2 } }],
      },
    ],
  },
  "card.stance.pick": {
    base,
    hits: [
      {
        why: "看法选了卡上没有的选项",
        subject: pageWith([["asks", 0, "stance", "pick"], "c"]),
        expect: [{ where: ["asks", 0, "stance", "pick"], params: { ...ask, pick: "c" } }],
      },
      {
        why: "没有选项的卡写了看法",
        subject: pageWith([["asks", 1, "stance"], { pick: "a", because: "用户每周只做一次。" }]),
        expect: [{ where: ["asks", 1, "stance", "pick"], params: { ...followUp, pick: "a" } }],
      },
    ],
  },
} satisfies Record<string, Samples>;
