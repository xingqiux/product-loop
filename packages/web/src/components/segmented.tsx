// 一排互斥的按钮：主线页换看法、决定页切换有效的和全部。
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { cx } from "@/lib/cx";

export function Segmented<K extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: K;
  options: readonly (readonly [K, string])[];
  onChange: (value: K) => void;
}) {
  return (
    <ToggleButtonGroup
      aria-label={label}
      selectionMode="single"
      disallowEmptySelection
      selectedKeys={[value]}
      onSelectionChange={(keys) => {
        const picked = options.find(([key]) => keys.has(key));
        if (picked !== undefined) onChange(picked[0]);
      }}
      className="inline-flex rounded-lg bg-secondary p-0.5"
    >
      {options.map(([key, text]) => (
        <ToggleButton
          key={key}
          id={key}
          className={({ isSelected, isFocusVisible }) =>
            cx(
              "rounded-md px-3 py-1 text-ui transition-colors duration-(--duration-hover) outline-none",
              isSelected
                ? "bg-primary font-medium text-primary shadow-xs"
                : "text-tertiary hover:text-secondary",
              isFocusVisible && "ring-2 ring-brand",
            )
          }
        >
          {text}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
