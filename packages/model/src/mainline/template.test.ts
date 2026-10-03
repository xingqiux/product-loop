import { describe, expect, it } from "vitest";
import { parseMainline } from "./parse.ts";
import { designSpecItem, mainlinePart } from "./parts.ts";
import { mainlineTemplate } from "./template.ts";

describe("主线模板", () => {
  it("十个部分的标题都认得出，设计规范下面十二个部分的标题都认得出，都是空的", () => {
    const parsed = parseMainline(mainlineTemplate());
    expect(parsed.parts.map((entry) => entry.present)).toEqual(mainlinePart.keys.map(() => true));
    expect(parsed.designSpec.map((entry) => entry.status)).toEqual(
      designSpecItem.keys.map(() => "empty"),
    );
    expect(parsed.otherSections).toEqual([]);
  });

  it("只有标题，不写示例的正文", () => {
    const body = mainlineTemplate()
      .split("\n")
      .filter((line) => line.trim() !== "" && !line.startsWith("#"));
    expect(body).toEqual([]);
  });
});
