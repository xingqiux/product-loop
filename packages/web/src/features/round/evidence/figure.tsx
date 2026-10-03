// 截图和放大看图。放大的一层开着时，Esc 只关这一层，左右键不换屏（按键的第二条规定）。
import { useState } from "react";
import { Dialog, Modal, ModalOverlay } from "@/components/ui/application/modals/modal";
import { cx } from "@/lib/cx";
import { useImageUrl } from "../context";

export function Figure({
  img,
  caption,
  label,
  className,
}: {
  img: string | undefined;
  caption?: string | undefined;
  label?: string;
  className?: string;
}) {
  const url = useImageUrl()(img);
  // 标签由界面加，图注文字自己以「改前：」开头时去掉，免得写两遍。
  const text =
    caption !== undefined &&
    label !== undefined &&
    (caption.startsWith(`${label}：`) || caption.startsWith(`${label}:`))
      ? caption.slice(label.length + 1).trimStart()
      : caption;
  if (url === undefined) {
    return img === undefined ? null : (
      <p className="text-meta text-tertiary">截图 {img} 没有找到。</p>
    );
  }
  return (
    <figure className={cx("flex flex-col gap-1.5", className)}>
      <ZoomImage src={url} alt={text ?? label ?? img ?? ""} />
      {(label !== undefined || text !== undefined) && (
        <figcaption className="text-meta text-tertiary">
          {label !== undefined && <b className="mr-2 font-medium text-secondary">{label}</b>}
          {text}
        </figcaption>
      )}
    </figure>
  );
}

export function ZoomImage({
  src,
  alt,
  className,
  cover = false,
}: {
  src: string;
  alt: string;
  className?: string;
  /** 缩略图：铺满按钮，多出来的裁掉。 */
  cover?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cx(
          "block cursor-zoom-in overflow-hidden rounded-lg ring-1 ring-secondary outline-focus-ring focus-visible:outline-2",
          className,
        )}
      >
        {/* 一个阶段里能有上百张图，懒加载加异步解码，别让离屏的图占主线程，见第二期计划第 23 步。 */}
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          className={cx("block w-full", cover && "h-full object-cover")}
        />
      </button>
      <ModalOverlay isOpen={open} onOpenChange={setOpen} isDismissable>
        <Modal className="max-w-[min(1200px,95vw)] bg-transparent shadow-none">
          <Dialog aria-label={alt} className="flex flex-col items-center gap-2">
            <button type="button" className="cursor-zoom-out" onClick={() => setOpen(false)}>
              <img src={src} alt={alt} className="max-h-[85vh] rounded-lg" />
            </button>
            <p className="text-meta text-white">{alt}</p>
          </Dialog>
        </Modal>
      </ModalOverlay>
    </>
  );
}
