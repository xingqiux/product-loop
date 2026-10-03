// 草稿里一项的输入框：备注、想法、不认可的原因。每改一下交给草稿，见 draft-store.ts。
// 贴截图：先传到附件库，文字里在光标处留下「〔图 n〕」，下面出缩略图。
// 存不上时下面写原因，文字里不留记号，图还在手上，点「重试」再存一次（主线 S30 第 4 步）。
// 一下删掉很多字时后端存下删之前的文字，输入框下面出「找回刚删掉的文字」，见「06 工作台」第九节。

import { XClose } from "@untitledui/icons";
import { type ClipboardEvent, useRef, useState } from "react";
import { TextArea } from "@/components/ui/base/textarea/textarea";
import { load } from "@/lib/api";
import { usePage } from "./context";
import { useDraft } from "./draft-store";
import { ZoomImage } from "./evidence/figure";

const noImages: readonly string[] = [];

/** 附件库的哈希：文件字节的 SHA-256，六十四位小写十六进制。 */
async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function upload(file: File): Promise<string> {
  const bytes = await file.arrayBuffer();
  const hash = await sha256(bytes);
  await load((api) =>
    api.api.v1.blobs[":hash"].$put(
      { param: { hash } },
      { init: { body: bytes, headers: { "Content-Type": file.type } } },
    ),
  );
  return hash;
}

export function NoteField({
  field,
  placeholder,
  label,
  readOnly,
  rows = 2,
}: {
  field: string;
  placeholder: string;
  label?: string;
  readOnly: boolean;
  rows?: number;
}) {
  const { pid, page } = usePage();
  const note = useDraft((state) => state.entries[field]?.note ?? "");
  const images = useDraft((state) => state.entries[field]?.images ?? noImages);
  const canRecover = useDraft((state) => state.deleted.includes(field));
  const update = useDraft((state) => state.update);
  const restored = useDraft((state) => state.restored);
  const box = useRef<HTMLTextAreaElement>(null);
  const [problem, setProblem] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  // 存不上的那几张图和要放的位置，点「重试」时再存一次。
  const [failed, setFailed] = useState<{ files: File[]; at: number } | undefined>();
  if (readOnly && note === "" && images.length === 0) return null;

  const attach = (files: File[], at: number) => {
    setBusy(true);
    setProblem(undefined);
    setFailed(undefined);
    Promise.all(files.map(upload))
      .then((hashes) => {
        const { entries } = useDraft.getState();
        const before = entries[field]?.images ?? [];
        const text = entries[field]?.note ?? "";
        const fresh = hashes.filter((hash) => !before.includes(hash));
        const all = [...before, ...fresh];
        const marks = hashes.map((hash) => `〔图 ${all.indexOf(hash) + 1}〕`).join("");
        update(field, { note: text.slice(0, at) + marks + text.slice(at), images: all });
      })
      .catch((error: unknown) => {
        setProblem(`截图存不上：${error instanceof Error ? error.message : String(error)}`);
        setFailed({ files, at });
      })
      .finally(() => setBusy(false));
  };

  const onPaste = (event: ClipboardEvent) => {
    if (readOnly) return;
    const files = Array.from(event.clipboardData.files).filter((file) =>
      file.type.startsWith("image/"),
    );
    if (files.length === 0) return;
    event.preventDefault();
    attach(files, box.current?.selectionStart ?? note.length);
  };

  const remove = (index: number) => {
    const next = images.filter((_, i) => i !== index);
    // 去掉这张图的记号，后面的图号往前挪一位。
    const text = note
      .replaceAll(`〔图 ${index + 1}〕`, "")
      .replace(/〔图 (\d+)〕/gu, (mark, n: string) =>
        Number(n) > index + 1 ? `〔图 ${Number(n) - 1}〕` : mark,
      );
    update(field, { note: text, images: next });
  };

  const recover = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const params = { param: { pid, id: String(page.id) } };
      const list = await load((api) =>
        api.api.v1.projects[":pid"].pages[":id"].draft.revisions.$get({
          ...params,
          query: { field },
        }),
      );
      const last = list.data.find((revision) => revision.reason === "删之前");
      if (last === undefined) throw new Error("没有删之前的旧版本。");
      const view = await load((api) =>
        api.api.v1.projects[":pid"].pages[":id"].draft.revisions[":rev"].restore.$post({
          param: { ...params.param, rev: String(last.id) },
        }),
      );
      restored(field, view.data.entries[field]);
    } catch (error) {
      setProblem(`没有找回来：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2" onPaste={onPaste}>
      <TextArea
        aria-label={label ?? placeholder}
        label={label}
        placeholder={placeholder}
        rows={rows}
        value={note}
        isReadOnly={readOnly}
        textAreaRef={box}
        onChange={(value) => update(field, { note: value })}
        textAreaClassName="text-ui"
      />
      {images.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {images.map((hash, index) => (
            <li key={hash} className="relative">
              <ZoomImage
                src={`/api/v1/blobs/${hash}`}
                alt={`图 ${index + 1}`}
                cover
                className="h-16 w-24 rounded-md"
              />
              <span className="pointer-events-none absolute bottom-1 left-1 rounded-sm bg-primary/90 px-1 text-label">
                图 {index + 1}
              </span>
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`去掉图 ${index + 1}`}
                  onClick={() => remove(index)}
                  className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-primary text-fg-quaternary ring-1 ring-secondary hover:text-fg-secondary"
                >
                  <XClose className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {busy && <p className="text-meta text-tertiary">正在处理</p>}
      {problem !== undefined && <p className="text-meta text-error-primary">{problem}</p>}
      {failed !== undefined && !readOnly && !busy && (
        <button
          type="button"
          onClick={() => attach(failed.files, failed.at)}
          className="inline-flex min-h-6 items-center self-start text-meta text-brand-secondary hover:underline"
        >
          重试
        </button>
      )}
      {canRecover && !readOnly && !busy && (
        <button
          type="button"
          onClick={() => void recover()}
          className="inline-flex min-h-6 items-center self-start text-meta text-brand-secondary hover:underline"
        >
          找回刚删掉的文字
        </button>
      )}
    </div>
  );
}
