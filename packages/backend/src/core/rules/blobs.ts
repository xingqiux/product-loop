import { defineRule, type PageSections, presentRuleInfo } from "@product-loop/model";
import { backendRulesCopy } from "../../copy/rules.ts";
import { blobPresentSamples } from "./blobs.samples.ts";
import type { PresentSubject } from "./subject.ts";

// 规则 blob.present：页面引用的每张截图都已上传，见「07 校验」第四节和「05 接口」第七节。
// 截图先上传、后引用。命令行把页面数据里每个截图路径的哈希交给后端，后端查附件库里有没有。
// 这个路径没交哈希，或者附件库里没有这个哈希的完整一份，都算没上传，每个路径报一处。
// 截图的路径写在名为 img 的字段里：来源、图、证据和场景的 img，见 model 的 page/fields.ts。
// 线稿的 HTML 里的 img 标签不在其中，线稿只是文字。

type Path = readonly (string | number)[];

/** 页面数据里的一张截图：在哪个字段，写的路径。 */
export type ImageRef = { readonly where: Path; readonly path: string };

/** 页面数据里全部的截图路径，按字段在数据里的顺序。 */
export function imageRefsOf(page: PageSections): ImageRef[] {
  const found: ImageRef[] = [];
  const walk = (value: unknown, where: Path): void => {
    if (Array.isArray(value)) {
      for (const [i, item] of value.entries()) walk(item, [...where, i]);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, inner] of Object.entries(value)) {
      if (key === "img" && typeof inner === "string")
        found.push({ where: [...where, key], path: inner });
      else walk(inner, [...where, key]);
    }
  };
  walk(page, []);
  return found;
}

export const blobPresent = defineRule({
  ...presentRuleInfo.blobPresent,
  copy: backendRulesCopy.blobPresent,
  check: (subject: PresentSubject, context) => {
    const stored = new Set(
      context.images.filter((image) => image.stored).map((image) => image.path),
    );
    return imageRefsOf(subject.page)
      .filter((ref) => !stored.has(ref.path))
      .map((ref) => ({ where: ref.where, params: { path: ref.path } }));
  },
  samples: blobPresentSamples,
});
