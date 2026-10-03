import { describe, expect, it } from "vitest";
import { queueAttrs } from "./sheet-attrs.ts";

const item = {
  stage: "落地",
  status: "待办",
  proposer: "AI",
  createdAt: "2026-09-28T02:05:00.000Z",
};

const names = (attrs: ReturnType<typeof queueAttrs>) => attrs.map(([name]) => name);

describe("队列事项展示卡片的属性表", () => {
  it("没有备注时不写「备注」这一行，也不补一句「无」", () => {
    const attrs = queueAttrs(item);
    expect(names(attrs)).toEqual(["阶段", "状态", "提出", "加入时间"]);
    expect(JSON.stringify(attrs)).not.toContain("无");
  });

  it("备注只写了空白也算没有", () => {
    expect(names(queueAttrs({ ...item, note: " \n " }))).not.toContain("备注");
  });

  it("有备注时写在第一行，紧接着标题里的内容，换行留给展示卡片分段", () => {
    const attrs = queueAttrs({ ...item, note: "第一行\n第二行", acceptance: "五列" });
    expect(attrs[0]).toEqual(["备注", "第一行\n第二行"]);
    expect(names(attrs)).toEqual(["备注", "阶段", "状态", "提出", "加入时间", "验收标准"]);
  });
});
