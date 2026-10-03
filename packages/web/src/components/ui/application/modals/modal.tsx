// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：components/application/modals/modal.tsx。
// 复制以后按本项目的规定改过：引用路径；进出场改用 Motion（决定 192）。
import { AnimatePresence, motion } from "motion/react";
import { useContext } from "react";
import type {
  DialogProps as AriaDialogProps,
  ModalOverlayProps as AriaModalOverlayProps,
} from "react-aria-components";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Modal as AriaModal,
  ModalOverlay as AriaModalOverlay,
  OverlayTriggerStateContext,
} from "react-aria-components";
import { cx } from "@/lib/cx";
import { motionTokens, type WithoutDomAnimation } from "@/lib/motion";

export const DialogTrigger = AriaDialogTrigger;

const MotionModalOverlay = motion.create(AriaModalOverlay);
const MotionModal = motion.create(AriaModal);

// 进出场交给 Motion：开关状态来自 isOpen 或外层的 DialogTrigger，AnimatePresence 等退场动画播完再卸下。
// 挂上的那一份一直是打开的，关的时候经 onOpenChange 回到外层的状态。
export const ModalOverlay = ({
  isOpen,
  onOpenChange,
  ...props
}: WithoutDomAnimation<AriaModalOverlayProps>) => {
  const trigger = useContext(OverlayTriggerStateContext);
  const open = isOpen ?? trigger?.isOpen ?? false;
  return (
    <AnimatePresence>
      {open && (
        <MotionModalOverlay
          {...props}
          isOpen
          onOpenChange={onOpenChange ?? trigger?.setOpen}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.fade}
          className={(state) =>
            cx(
              "fixed inset-0 z-50 flex min-h-dvh w-full items-end justify-center bg-overlay/70 px-4 outline-hidden backdrop-blur-[6px] sm:items-center sm:justify-center sm:px-8",
              // Vertical padding
              "pt-(--modal-pt) pb-(--modal-pb) [--modal-pb:clamp(16px,8vh,64px)] [--modal-pt:16px] sm:[--modal-pb:32px] sm:[--modal-pt:32px]",
              typeof props.className === "function" ? props.className(state) : props.className,
            )
          }
        />
      )}
    </AnimatePresence>
  );
};

export const Modal = (props: WithoutDomAnimation<AriaModalOverlayProps>) => (
  <MotionModal
    {...props}
    initial={{ opacity: 0, scale: 0.95 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.95 }}
    transition={motionTokens.screen}
    className={(state) =>
      cx(
        "w-full rounded-xl bg-primary align-middle shadow-xl outline-hidden max-sm:overflow-y-auto sm:rounded-2xl",
        // Max height based on parent's vertical padding
        "max-h-[calc(var(--visual-viewport-height)-var(--modal-pt)-var(--modal-pb))]",
        typeof props.className === "function" ? props.className(state) : props.className,
      )
    }
  />
);

export const Dialog = (props: AriaDialogProps) => (
  <AriaDialog
    {...props}
    className={cx(
      "relative max-h-[inherit] w-full overflow-y-auto outline-hidden",
      props.className,
    )}
  />
);
