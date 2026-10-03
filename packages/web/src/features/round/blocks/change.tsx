// 更改：之前哪里不对、现在什么样，改前改后的图或文字的逐行对比。
// 用户点「认可」或「不认可」，点了记进草稿，不点不写。不认可要写一句为什么。见「06 工作台」第四节。
import { TextDiff } from "@/components/text-diff";
import { cx } from "@/lib/cx";
import { usePage, useQueueContents } from "../context";
import { useDraft } from "../draft-store";
import { Figure } from "../evidence/figure";
import { Label, Paragraphs } from "../evidence/text";
import { fieldOf, queueTitles } from "../model";
import { NoteField } from "../note-field";
import { Choice } from "./choice";

const choices = ["认可", "不认可"] as const;

export function ChangeBlock({ index }: { index: number }) {
  const { page, readOnly } = usePage();
  const contents = useQueueContents();
  const change = page.sections.changes?.[index];
  const field = fieldOf("changes", change?.id ?? "");
  const entry = useDraft((state) => state.entries[field]);
  if (change === undefined) return null;
  const diff = page.fill.textDiffs.find((item) => item.card === change.id);
  const rejected = entry?.pick === "不认可";
  const queued = queueTitles(change.queue ?? [], contents);
  return (
    <article className="flex flex-col gap-6">
      {/* 认可和不认可放在标题这一行，一进这一屏就在窗口里，不用滚到图和对比的下面去找。 */}
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <p className="text-meta text-tertiary">
            <span className="rounded-md px-1.5 py-0.5 text-label text-secondary ring-1 ring-secondary">
              更改
            </span>
            {queued !== "" && <span className="ml-2">队列：{queued}</span>}
          </p>
          <h2 className="text-title">{change.title}</h2>
        </div>
        <Choice field={field} choices={choices} label={change.title} readOnly={readOnly} />
      </header>
      {rejected && <NoteField field={field} readOnly={readOnly} placeholder="不认可的原因" />}
      <div className="grid gap-4 md:grid-cols-2">
        <section className="flex flex-col gap-1.5 rounded-xl bg-secondary p-4">
          <Label>之前</Label>
          <Paragraphs text={change.problem} className="text-ui" />
        </section>
        <section className="flex flex-col gap-1.5 rounded-xl p-4 ring-1 ring-secondary">
          <Label>现在</Label>
          <Paragraphs text={change.fix} className="text-ui" />
        </section>
      </div>
      {diff !== undefined ? (
        <NamedDiff name={change.textName} rows={diff.rows} />
      ) : (
        <div className={cx("grid gap-4", change.before !== undefined && "md:grid-cols-2")}>
          {change.before !== undefined && (
            <Figure img={change.before.img} caption={change.before.caption} label="改前" />
          )}
          {change.after !== undefined && (
            <Figure img={change.after.img} caption={change.after.caption} label="改后" />
          )}
        </div>
      )}
      {(change.more ?? []).length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {(change.more ?? []).map((figure) => (
            <Figure key={figure.img} img={figure.img} caption={figure.caption} label="改后" />
          ))}
        </div>
      )}
    </article>
  );
}

type DiffRow = Parameters<typeof TextDiff>[0]["rows"][number];

function NamedDiff({ name, rows }: { name: string | undefined; rows: readonly DiffRow[] }) {
  return (
    <section className="flex flex-col gap-2">
      {name !== undefined && <Label>{name}</Label>}
      <TextDiff rows={rows} />
    </section>
  );
}
