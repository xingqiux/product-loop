// 一个换行符是一段，同一段里的句子接着排，和旧模板相同。
import { cx } from "@/lib/cx";

export function Paragraphs({ text, className }: { text: string | undefined; className?: string }) {
  if (text === undefined) return null;
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  return (
    <div className={cx("flex flex-col gap-2", className)}>
      {lines.map((line, index) => (
        // 段落不会重排，用下标当键。
        <p key={index}>{line}</p>
      ))}
    </div>
  );
}

/** 区块里的小标题：待决定、来源、证据、选项。 */
export function Label({ children }: { children: React.ReactNode }) {
  return <p className="text-meta font-medium text-tertiary">{children}</p>;
}
