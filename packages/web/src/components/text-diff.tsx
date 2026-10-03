// 文字的逐行对比：后端算好，这里只上色。删的涂红划线，加的涂绿。更改的文字和主线的两版比较都用它。
import { cx } from "@/lib/cx";

type DiffRow = {
  readonly k: string;
  readonly parts: readonly (readonly [string, string])[];
};

const mark = new Map([
  ["del", "−"],
  ["ins", "+"],
  ["mix", "±"],
]);

export function TextDiff({ rows }: { rows: readonly DiffRow[] }) {
  return (
    <div className="overflow-x-auto rounded-xl ring-1 ring-secondary">
      {rows.map((row, index) =>
        row.k === "gap" ? (
          // 对比的行不会重排，用下标当键。
          <div key={index} className="px-4 py-1 text-meta text-quaternary">
            ……
          </div>
        ) : (
          <div
            key={index}
            className={cx("flex gap-3 px-4 py-1 text-ui", row.k !== "same" && "bg-secondary")}
          >
            <span className="w-3 shrink-0 text-tertiary">{mark.get(row.k) ?? ""}</span>
            <span className="whitespace-pre-wrap">
              {row.parts.map(([kind, text], k) =>
                kind === "same" ? (
                  <span key={k}>{text}</span>
                ) : kind === "del" ? (
                  <del key={k} className="rounded-sm bg-error-primary text-error-primary">
                    {text}
                  </del>
                ) : (
                  <ins
                    key={k}
                    className="rounded-sm bg-success-primary text-success-primary no-underline"
                  >
                    {text}
                  </ins>
                ),
              )}
              {row.parts.length === 0 && " "}
            </span>
          </div>
        ),
      )}
    </div>
  );
}
