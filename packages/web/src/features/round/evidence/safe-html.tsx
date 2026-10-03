// 线稿和中保真线稿是 AI 写的 HTML 片段，见「06 工作台」第九节。
// 先按白名单滤掉脚本、内嵌框架和事件属性，再放进 Shadow DOM：线稿的样式不漏到页面上，
// 页面的样式重置也不改线稿。截图的路径换成附件的地址。
import { useLayoutEffect, useRef } from "react";
import { useImageUrl } from "../context";
import sketchCss from "./sketch.css?inline";

const allowedTags = new Set([
  "div",
  "span",
  "p",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "s",
  "small",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "img",
  "figure",
  "figcaption",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "code",
  "pre",
  "blockquote",
  "label",
  "button",
  "input",
  "select",
  "option",
  "textarea",
  "section",
  "header",
  "footer",
  "nav",
  "aside",
  "main",
  "a",
  "svg",
  "path",
  "rect",
  "circle",
  "line",
  "polyline",
  "polygon",
  "g",
  "text",
]);

const allowedAttrs = new Set([
  "class",
  "style",
  "src",
  "alt",
  "title",
  "colspan",
  "rowspan",
  "width",
  "height",
  "type",
  "value",
  "placeholder",
  "checked",
  "disabled",
  "selected",
  "viewbox",
  "d",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "points",
  "fill",
  "stroke",
  "stroke-width",
  "transform",
  "text-anchor",
  "role",
  "aria-label",
]);

/** 按白名单清理。不认得的标签连同内容去掉，属性只留白名单里的，地址不许是脚本。 */
function sanitize(html: string, imageUrl: (path: string) => string | undefined): DocumentFragment {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (!allowedTags.has(tag)) {
        child.remove();
        continue;
      }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (!allowedAttrs.has(name) || value.startsWith("javascript:") || value.includes("url(")) {
          child.removeAttribute(attr.name);
        }
      }
      if (tag === "img") {
        const src = child.getAttribute("src") ?? "";
        const url = /^(?:https?:|data:image\/)/u.test(src) ? src : imageUrl(src);
        if (url === undefined) child.removeAttribute("src");
        else child.setAttribute("src", url);
      }
      if (tag === "a") child.removeAttribute("href");
      walk(child);
    }
  };
  walk(doc.body);
  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(doc.body.childNodes));
  return fragment;
}

export function SafeHtml({ html, className }: { html: string; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const imageUrl = useImageUrl();
  useLayoutEffect(() => {
    const element = host.current;
    if (element === null) return;
    const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = sketchCss;
    root.replaceChildren(style, sanitize(html, imageUrl));
  }, [html, imageUrl]);
  return <div ref={host} className={className} />;
}
