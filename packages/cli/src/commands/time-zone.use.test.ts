import { describe, expect, it } from "vitest";
import { sandbox } from "./testing.ts";

// 命令输出里的时间一律按北京时间写，和本机的时区无关（决定 188）。用 TZ 换两个时区，同一件事的时间不变。

function firstTime(text: string): string {
  return /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/u.exec(text)?.[0] ?? "";
}

describe("时间按北京时间显示", { timeout: 60_000 }, () => {
  it("queue show 的时间不随 TZ 变", () => {
    const s = sandbox();
    expect(s.ploop("proj/app", "init", "--repo", "自己的").code).toBe(0);
    expect(s.ploop("proj/app", "queue", "add", "保存按钮被挡住", "--stage", "落地").code).toBe(0);

    s.env.TZ = "Asia/Shanghai";
    const shanghai = firstTime(s.ploop("proj/app", "queue", "show", "Q1").stdout);
    s.env.TZ = "America/Los_Angeles";
    const losAngeles = firstTime(s.ploop("proj/app", "queue", "show", "Q1").stdout);

    expect(shanghai).not.toBe("");
    expect(losAngeles).toBe(shanghai);
  });
});
