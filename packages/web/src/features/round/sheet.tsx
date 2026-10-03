// 展示卡片：概览只给简略，点开是居中的卡片，属性表在上、正文在下，卡片里能换条。
// 卡片开着时，左右键只换卡片，不换屏；Esc 只关卡片（按键的第二条规定）。
import { ChevronLeft, ChevronRight, XClose } from "@untitledui/icons";
import { type ReactNode, useEffect, useRef } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/ui/application/modals/modal";
import { Paragraphs } from "./evidence/text";

export type SheetItem = {
  readonly title: string;
  readonly attrs: readonly (readonly [string, string])[];
  readonly body?: string | undefined;
  readonly list?: readonly string[] | undefined;
  readonly listLabel?: string;
  readonly foot?: ReactNode;
};

export function Sheet({
  items,
  at,
  onAt,
}: {
  items: readonly SheetItem[];
  at: number | undefined;
  onAt: (at: number | undefined) => void;
}) {
  const item = at === undefined ? undefined : items[at];
  const step = (d: number) => {
    if (at !== undefined) onAt((at + d + items.length) % items.length);
  };
  const stepRef = useRef(step);
  stepRef.current = step;
  const open = item !== undefined;
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      // 光标在输入框里时，左右键归输入框。
      if (event.target instanceof Element && event.target.closest("input, textarea")) return;
      if (event.key === "ArrowLeft") stepRef.current(-1);
      if (event.key === "ArrowRight") stepRef.current(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <ModalOverlay
      isOpen={item !== undefined}
      onOpenChange={(open) => !open && onAt(undefined)}
      isDismissable
    >
      <Modal className="max-w-2xl">
        <Dialog aria-label={item?.title ?? "展示卡片"}>
          {item !== undefined && (
            <div className="flex flex-col gap-5 p-6">
              <header className="flex items-start gap-3">
                <h3 className="flex-1 text-heading">{item.title}</h3>
                <span className="text-meta text-tertiary tabular-nums">
                  {(at ?? 0) + 1} / {items.length}
                </span>
                <button
                  type="button"
                  aria-label="上一张"
                  onClick={() => step(-1)}
                  className="flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
                >
                  <ChevronLeft className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="下一张"
                  onClick={() => step(1)}
                  className="flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
                >
                  <ChevronRight className="size-5" />
                </button>
                <button
                  type="button"
                  aria-label="关掉"
                  onClick={() => onAt(undefined)}
                  className="flex size-6 items-center justify-center text-fg-quaternary hover:text-fg-secondary"
                >
                  <XClose className="size-5" />
                </button>
              </header>
              <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-ui">
                {item.attrs.map(([name, value]) => (
                  <div key={name} className="contents">
                    <dt className="text-tertiary">{name}</dt>
                    <dd>
                      <Paragraphs text={value} />
                    </dd>
                  </div>
                ))}
              </dl>
              {item.body !== undefined && <Paragraphs text={item.body} className="text-body" />}
              {(item.list ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <p className="text-meta text-tertiary">{item.listLabel ?? "子项"}</p>
                  <ul className="list-disc pl-5 text-ui">
                    {(item.list ?? []).map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>
              )}
              {item.foot}
            </div>
          )}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
