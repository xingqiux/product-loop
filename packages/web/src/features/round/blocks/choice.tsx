// 保留、修改、删除和明白、不明白这类表态，一排小按钮。点了记进草稿。
import { Radio, RadioGroup } from "react-aria-components";
import { cx } from "@/lib/cx";
import { useDraft } from "../draft-store";

/** 选中时用红色的表态：删除。别的选中都是蓝色，删除要一眼分得开（决定 191）。文字仍然写着，颜色不单独表示意思。 */
const danger = new Set(["删除"]);

export function Choice({
  field,
  choices,
  label,
  readOnly,
}: {
  field: string;
  choices: readonly string[];
  label: string;
  readOnly: boolean;
}) {
  const pick = useDraft((state) => state.entries[field]?.pick);
  const update = useDraft((state) => state.update);
  return (
    <RadioGroup
      aria-label={label}
      orientation="horizontal"
      value={pick ?? null}
      onChange={(value) => update(field, { pick: value })}
      isReadOnly={readOnly}
      className="flex shrink-0 gap-1 rounded-lg bg-secondary p-1"
    >
      {choices.map((choice) => (
        <Radio
          key={choice}
          value={choice}
          className={({ isSelected, isFocusVisible }) =>
            cx(
              "rounded-md px-2.5 py-1 text-meta transition-colors",
              isSelected
                ? danger.has(choice)
                  ? "bg-primary text-error-primary shadow-xs ring-1 ring-fg-error-primary"
                  : "bg-primary text-brand-secondary shadow-xs ring-1 ring-fg-brand-primary"
                : readOnly
                  ? "text-quaternary"
                  : "text-tertiary hover:text-secondary",
              isFocusVisible && "outline-2 outline-focus-ring",
              // 只读时点不动：选中的照旧，没选的变淡，指针也说不能点，不让人以为是坏了。
              readOnly ? (isSelected ? "cursor-default" : "cursor-not-allowed") : "cursor-pointer",
            )
          }
        >
          {choice}
        </Radio>
      ))}
    </RadioGroup>
  );
}
