import type { PageImage, RuleContextOf, RuleSamples } from "@product-loop/model";
import { basePage, pageWith } from "./page.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 blob.present 的样本。基础数据：页面引用三张截图，命令行交了三个哈希，附件库里都有。

type Context = RuleContextOf<"images">;

const hash = (digit: string) => digit.repeat(64);

const images: readonly PageImage[] = [
  { path: "img/home.png", hash: hash("a"), stored: true },
  { path: "img/board.png", hash: hash("b"), stored: true },
  { path: "img/after.png", hash: hash("c"), stored: true },
];

const subject = (page = basePage): PresentSubject => ({ page, purpose: "ask" });

export const blobPresentSamples: RuleSamples<PresentSubject, Context> = {
  base: { subject: subject(), context: { images } },
  hits: [
    {
      why: "更改的改后图附件库里没有",
      subject: subject(),
      context: {
        images: images.map((image) =>
          image.path === "img/after.png" ? { ...image, stored: false } : image,
        ),
      },
      expect: [{ where: ["changes", 0, "after", "img"], params: { path: "img/after.png" } }],
    },
    {
      why: "来源的截图没有交哈希",
      subject: subject(),
      context: { images: images.filter((image) => image.path !== "img/home.png") },
      expect: [{ where: ["asks", 0, "sources", 0, "img"], params: { path: "img/home.png" } }],
    },
    {
      why: "证据里多引用了一张图，没有上传",
      subject: subject(
        pageWith((page) => {
          const [card] = page.asks;
          if (card !== undefined) {
            Object.assign(card, { evidence: [{ type: "截图", img: "img/zoom.png" }] });
          }
        }),
      ),
      context: { images },
      expect: [{ where: ["asks", 0, "evidence", 0, "img"], params: { path: "img/zoom.png" } }],
    },
  ],
};
