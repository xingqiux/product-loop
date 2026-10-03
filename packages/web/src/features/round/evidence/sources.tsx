// 来源：一条写一样东西，它叫什么、在它上面看到了什么。界面配截图，文字配原文摘录，原话不配图。
import { cx } from "@/lib/cx";
import { usePage } from "../context";
import { Figure } from "./figure";
import { Label, Paragraphs } from "./text";

type Source = {
  readonly name: string;
  readonly saw?: string | undefined;
  readonly img?: string | undefined;
  readonly outside?: true | undefined;
  readonly file?: string | undefined;
  readonly lines?: string | undefined;
  readonly quote?: true | undefined;
};

/** 原文摘录按来源在页面数据里的位置对回来，例如 asks[0].sources[1]。 */
export function Sources({ sources, at }: { sources: readonly Source[]; at: string }) {
  const { page } = usePage();
  let n = 0;
  return (
    <div className="flex flex-col gap-2">
      <Label>来源</Label>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((source, index) => {
          const quote = source.quote === true;
          if (!quote) n += 1;
          const excerpt = page.excerpts.find((item) => item.where === `${at}.sources[${index}]`);
          return (
            <div
              key={`${source.name}-${index}`}
              className={cx(
                "flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary",
                quote && "md:col-span-2 xl:col-span-3",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cx(
                    "flex h-5 shrink-0 items-center justify-center rounded-full bg-brand-solid text-label text-white",
                    quote ? "px-2" : "w-5",
                  )}
                >
                  {quote ? "用户说" : n}
                </span>
                <span className="text-ui font-medium">{source.name}</span>
                {source.outside && (
                  <span className="ml-auto shrink-0 text-label whitespace-nowrap text-tertiary">
                    外部
                  </span>
                )}
              </div>
              {source.saw !== undefined && (
                <Paragraphs
                  text={quote && !source.saw.startsWith("「") ? `「${source.saw}」` : source.saw}
                  className="text-ui text-secondary"
                />
              )}
              {source.img !== undefined && <Figure img={source.img} />}
              {excerpt !== undefined && <Excerpt excerpt={excerpt} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ExcerptData = {
  readonly file: string;
  readonly lines: string;
  readonly start: number;
  readonly mark: readonly number[] | null;
  readonly text: string;
};

function Excerpt({ excerpt }: { excerpt: ExcerptData }) {
  const marked = new Set(excerpt.mark ?? []);
  return (
    <div className="flex flex-col gap-1">
      <pre className="overflow-x-auto rounded-md bg-secondary p-2 font-mono text-label leading-5">
        {excerpt.text.split("\n").map((line, index) => {
          const number = excerpt.start + index;
          return (
            <div
              key={number}
              className={cx(
                "flex gap-3",
                marked.has(number) && "-mx-2 rounded-sm bg-brand-primary px-2 text-primary",
              )}
            >
              <span className="w-8 shrink-0 text-right text-quaternary select-none">{number}</span>
              <span className="whitespace-pre-wrap">{line}</span>
            </div>
          );
        })}
      </pre>
      <p className="font-mono text-label text-tertiary">
        {excerpt.file}:{excerpt.lines}
      </p>
    </div>
  );
}
