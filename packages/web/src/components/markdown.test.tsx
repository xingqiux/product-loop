import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./markdown.tsx";

// 主线全文的渲染：表格、加粗、行内代码、列表要画出来，HTML 和脚本链接不能生效。

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("表格、加粗、行内代码和列表画成对应的元素，不留符号", () => {
    const out = html(
      [
        "# 标题",
        "",
        "一句 **加粗** 和 `code`",
        "",
        "| 名 | 值 |",
        "| --- | ---: |",
        "| a | 1 |",
        "",
        "1. 第一",
        "2. 第二",
        "",
        "- 甲",
        "- 乙",
      ].join("\n"),
    );
    expect(out).toContain("<strong");
    expect(out).toContain(">加粗</strong>");
    expect(out).toContain("<code");
    expect(out).toContain("<table");
    expect(out).toContain("<th");
    expect(out).toContain("text-right");
    expect(out).toContain("<ol");
    expect(out).toContain("<ul");
    expect(out).not.toContain("**");
    expect(out).not.toContain("|");
    expect(out).not.toContain("`");
  });

  it("列表项不用 flex，序号和圆点才不会丢", () => {
    const out = html("1. 第一\n2. 第二\n\n- 甲\n- 乙\n\n- [x] 做完\n- [ ] 没做");
    expect(out).toContain("list-decimal");
    expect(out).toContain("list-disc");
    // 有序、无序列表的每一项都是普通的 li，任务项自己不带符号。
    const items = [...out.matchAll(/<li([^>]*)>/gu)].map((match) => match[1] ?? "");
    expect(items).toHaveLength(6);
    for (const attrs of items.slice(0, 4))
      expect(attrs).not.toMatch(/\b(flex|grid|block|inline)\b/u);
    for (const attrs of items.slice(4)) expect(attrs).toContain("list-none");
  });

  it("二级、三级标题的锚点是它在原文里的行号，目录据此滚过去", () => {
    const out = html("# 一\n\n前言\n\n## 二\n\n| a |\n| - |\n| b |\n\n### 三\n");
    expect(out).toMatch(/<h2 id="line-5"/u);
    expect(out).toMatch(/<h3 id="line-11"/u);
    expect(out).not.toMatch(/<h1 id=/u);
  });

  it("表格每一格有最小宽度，短词不被长的几列挤成一字一行", () => {
    const out = html(
      "| 这一步 | 这一批里具体做什么 |\n| --- | --- |\n| 写计划 | 把要做的事一条一条列出来 |",
    );
    expect(out.match(/<t[hd] class="[^"]*min-w-\[4\.5rem\]/gu)).toHaveLength(4);
  });

  it("一行一句：回车画成换行", () => {
    expect(html("第一句\n第二句")).toContain("<br/>");
  });

  it("正文里的 HTML 当文字显示，脚本链接不能点", () => {
    const out = html(
      "前面 <script>alert(1)</script> [点我](javascript:alert(1)) [好的](https://a.example/)\n\n<script>alert(2)</script>",
    );
    expect(out).not.toContain("<script");
    expect(out).toContain("&lt;script&gt;alert(1)");
    expect(out).toContain("&lt;script&gt;alert(2)");
    expect(out).not.toContain('href="javascript');
    expect(out).toContain('href="https://a.example/"');
  });

  it("引用、分隔线和代码块也能画", () => {
    const out = html("> 引一句\n\n---\n\n```\nlet a = 1 < 2\n```");
    expect(out).toContain("<blockquote");
    expect(out).toContain("<hr");
    expect(out).toContain("let a = 1 &lt; 2");
  });
});
