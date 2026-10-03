// Markdown 的渲染：主线全文用。用 marked 切成块，自己画成 React 元素，不用 innerHTML。
// 正文里的 HTML 一律当文字显示，链接只认网址和邮箱，图片只留说明文字。
// 二级、三级标题带着行号当锚点（line-行号），主线页右边的目录据此滚过去。
import { marked, type Token, type Tokens } from "marked";
import { type ReactNode, useMemo } from "react";
import { cx } from "@/lib/cx";

/** 一段文字里出现的字符实体，marked 不还原，这里还原最常见的几个。 */
const entities = new Map([
  ["&amp;", "&"],
  ["&lt;", "<"],
  ["&gt;", ">"],
  ["&quot;", '"'],
  ["&#39;", "'"],
]);

const plain = (text: string) =>
  text.replace(/&(?:amp|lt|gt|quot|#39);/gu, (m) => entities.get(m) ?? m);

/** 这个位置的链接能不能点：网址和邮箱可以，其余（脚本、本机路径）只显示文字。 */
const linkable = (href: string) => /^(?:https?:|mailto:)/iu.test(href);

function Inline({ tokens }: { tokens: readonly Token[] | undefined }): ReactNode {
  return (tokens ?? []).map((token, index) => <InlineToken key={index} token={token} />);
}

function InlineToken({ token }: { token: Token }): ReactNode {
  switch (token.type) {
    case "text": {
      const text = token as Tokens.Text;
      return text.tokens === undefined ? plain(text.text) : <Inline tokens={text.tokens} />;
    }
    case "escape":
      return (token as Tokens.Escape).text;
    case "strong":
      return (
        <strong className="font-semibold">
          <Inline tokens={(token as Tokens.Strong).tokens} />
        </strong>
      );
    case "em":
      return (
        <em>
          <Inline tokens={(token as Tokens.Em).tokens} />
        </em>
      );
    case "del":
      return (
        <del className="text-tertiary">
          <Inline tokens={(token as Tokens.Del).tokens} />
        </del>
      );
    case "codespan":
      return (
        <code className="rounded-sm bg-secondary px-1 py-0.5 font-mono text-[0.9em] wrap-anywhere">
          {plain((token as Tokens.Codespan).text)}
        </code>
      );
    case "br":
      return <br />;
    case "link": {
      const link = token as Tokens.Link;
      return linkable(link.href) ? (
        <a
          href={link.href}
          target="_blank"
          rel="noreferrer"
          className="text-brand-secondary hover:underline"
        >
          <Inline tokens={link.tokens} />
        </a>
      ) : (
        <Inline tokens={link.tokens} />
      );
    }
    case "image":
      return (token as Tokens.Image).text;
    default:
      // 行内的 HTML 和认不出的，按原文显示。
      return (token as { raw: string }).raw;
  }
}

/** 一个块占几行：它的原文里有几个换行。 */
const linesOf = (raw: string) => raw.split("\n").length - 1;

const headings = new Map([
  [1, "text-title"],
  [2, "scroll-mt-6 pt-6 text-heading"],
  [3, "scroll-mt-6 pt-3 text-ui font-semibold"],
]);

/** top 为真时是全文最外面一层，标题按原文的行号加锚点；列表和引用里面的不加。 */
function Blocks({ tokens, top = false }: { tokens: readonly Token[]; top?: boolean }) {
  let line = 1;
  return tokens.map((token, index) => {
    const at = top ? line : undefined;
    line += linesOf(token.raw);
    return <BlockToken key={index} token={token} line={at} />;
  });
}

function BlockToken({ token, line }: { token: Token; line: number | undefined }): ReactNode {
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      const Tag = `h${Math.min(heading.depth, 6)}` as "h1";
      return (
        <Tag
          id={
            line !== undefined && (heading.depth === 2 || heading.depth === 3)
              ? `line-${line}`
              : undefined
          }
          className={headings.get(heading.depth) ?? "text-ui font-semibold"}
        >
          <Inline tokens={heading.tokens} />
        </Tag>
      );
    }
    case "paragraph":
      return (
        <p className="text-body wrap-anywhere">
          <Inline tokens={(token as Tokens.Paragraph).tokens} />
        </p>
      );
    case "text": {
      // 列表项里没有空行隔开的文字。
      const text = token as Tokens.Text;
      return (
        <p className="text-body wrap-anywhere">
          {text.tokens === undefined ? plain(text.text) : <Inline tokens={text.tokens} />}
        </p>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      const Tag = list.ordered ? "ol" : "ul";
      return (
        <Tag
          {...(list.ordered && list.start !== "" ? { start: list.start } : {})}
          className={cx(
            "pl-6 marker:text-tertiary [&>li+li]:mt-1",
            list.ordered ? "list-decimal" : "list-disc",
          )}
        >
          {list.items.map((item, index) =>
            item.task ? (
              // 任务项本来就不带序号和圆点，复选框和内容并排。
              <li key={index} className="flex list-none items-start gap-2">
                <input
                  type="checkbox"
                  checked={item.checked === true}
                  disabled
                  aria-label={item.checked === true ? "已勾选" : "未勾选"}
                  className="mt-1.5 shrink-0"
                />
                <div className="flex min-w-0 flex-col gap-1">
                  <Blocks tokens={item.tokens} />
                </div>
              </li>
            ) : (
              // 列表项不能用 flex：display 不是 list-item，序号和圆点就没了。多块内容的间距用相邻选择器。
              <li key={index} className="[&>*+*]:mt-1">
                <Blocks tokens={item.tokens} />
              </li>
            ),
          )}
        </Tag>
      );
    }
    case "table":
      return <Table table={token as Tokens.Table} />;
    case "code":
      return (
        <pre className="rounded-lg bg-secondary p-3 font-mono text-meta whitespace-pre-wrap wrap-anywhere">
          {(token as Tokens.Code).text}
        </pre>
      );
    case "blockquote":
      return (
        <blockquote className="flex flex-col gap-2 border-l-2 border-secondary pl-4 text-secondary">
          <Blocks tokens={(token as Tokens.Blockquote).tokens} />
        </blockquote>
      );
    case "hr":
      return <hr className="my-2 border-secondary" />;
    default:
      // 块级的 HTML 和认不出的，按原文显示，不当成标签。
      return <p className="text-body whitespace-pre-wrap wrap-anywhere">{token.raw.trim()}</p>;
  }
}

const align = { left: "text-left", center: "text-center", right: "text-right" } as const;

function Table({ table }: { table: Tokens.Table }) {
  return (
    // 单元格的字能在任何位置换行，所以表在窄窗口里也是缩窄，不出横向滚动条；外面这一层只是兜底。
    // 每格留一个最小宽度，不然短词（「这一步」「写计划」）被长的几列挤成一字一行。
    <div className="overflow-x-auto rounded-lg ring-1 ring-secondary">
      <table className="w-full text-left text-ui">
        <thead className="bg-secondary text-meta text-tertiary">
          <tr>
            {table.header.map((cell, index) => (
              <th
                key={index}
                className={cx(
                  "min-w-[4.5rem] px-3 py-2 font-normal wrap-anywhere",
                  table.align[index] != null && align[table.align[index]],
                )}
              >
                <Inline tokens={cell.tokens} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-secondary">
          {table.rows.map((row, r) => (
            <tr key={r} className="align-top">
              {row.map((cell, index) => (
                <td
                  key={index}
                  className={cx(
                    "min-w-[4.5rem] px-3 py-2 wrap-anywhere",
                    table.align[index] != null && align[table.align[index]],
                  )}
                >
                  <Inline tokens={cell.tokens} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 主线一行一句，回车就是换行，所以按 GitHub 的写法把换行也画出来。 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const tokens = useMemo(() => marked.lexer(text, { gfm: true, breaks: true }), [text]);
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      <Blocks tokens={tokens} top />
    </div>
  );
}
