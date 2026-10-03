// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：components/application/slideout-menus/slideout-menu.tsx。
// 复制以后按本项目的规定改过：引用路径；进出场改用 Motion（决定 192）。
import { AnimatePresence, motion } from "motion/react";
import { type ComponentPropsWithRef, type ReactNode, type RefAttributes, useContext } from "react";
import type {
  DialogProps as AriaDialogProps,
  ModalOverlayProps as AriaModalOverlayProps,
  ModalRenderProps as AriaModalRenderProps,
} from "react-aria-components";
import {
  Dialog as AriaDialog,
  DialogTrigger as AriaDialogTrigger,
  Modal as AriaModal,
  ModalOverlay as AriaModalOverlay,
  OverlayTriggerStateContext,
} from "react-aria-components";
import { CloseButton } from "@/components/ui/base/buttons/close-button";
import { cx } from "@/lib/cx";
import { motionTokens, type WithoutDomAnimation } from "@/lib/motion";

const MotionModalOverlay = motion.create(AriaModalOverlay);
const MotionModal = motion.create(AriaModal);

interface ModalOverlayProps
  extends WithoutDomAnimation<AriaModalOverlayProps>,
    RefAttributes<HTMLDivElement> {}

// 进出场交给 Motion，做法和 modals/modal.tsx 相同。
export const ModalOverlay = ({ isOpen, onOpenChange, ...props }: ModalOverlayProps) => {
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
              "fixed inset-0 flex min-h-dvh w-full items-center justify-end bg-overlay/70 pl-6 outline-hidden md:pl-10",
              typeof props.className === "function" ? props.className(state) : props.className,
            )
          }
        />
      )}
    </AnimatePresence>
  );
};
ModalOverlay.displayName = "ModalOverlay";

interface ModalProps
  extends WithoutDomAnimation<AriaModalOverlayProps>,
    RefAttributes<HTMLDivElement> {}

export const Modal = (props: ModalProps) => (
  <MotionModal
    {...props}
    initial={{ x: "100%" }}
    animate={{ x: 0 }}
    exit={{ x: "100%" }}
    transition={motionTokens.screen}
    className={(state) =>
      cx(
        "inset-y-0 right-0 h-full w-full max-w-100 shadow-xl",
        typeof props.className === "function" ? props.className(state) : props.className,
      )
    }
  />
);
Modal.displayName = "Modal";

interface DialogProps extends AriaDialogProps, RefAttributes<HTMLElement> {}

export const Dialog = (props: DialogProps) => (
  <AriaDialog
    role="dialog"
    aria-label="Slideout menu"
    {...props}
    className={cx(
      "relative flex size-full flex-col items-start gap-6 overflow-y-auto bg-primary ring-1 ring-secondary_alt outline-hidden",
      props.className,
    )}
  />
);
Dialog.displayName = "Dialog";

interface SlideoutMenuProps
  extends Omit<AriaModalOverlayProps, "children">,
    RefAttributes<HTMLDivElement> {
  children: ReactNode | ((children: AriaModalRenderProps & { close: () => void }) => ReactNode);
  dialogClassName?: string;
}

const Menu = ({ children, dialogClassName, ...props }: SlideoutMenuProps) => {
  return (
    <ModalOverlay {...props}>
      <Modal
        className={(state) =>
          cx(typeof props.className === "function" ? props.className(state) : props.className)
        }
      >
        {(state) => (
          <Dialog className={dialogClassName}>
            {({ close }) => {
              return typeof children === "function" ? children({ ...state, close }) : children;
            }}
          </Dialog>
        )}
      </Modal>
    </ModalOverlay>
  );
};
Menu.displayName = "SlideoutMenu";

const Content = ({ role = "main", ...props }: ComponentPropsWithRef<"div">) => {
  return (
    <div
      role={role}
      {...props}
      className={cx(
        "flex size-full flex-col gap-6 overflow-y-auto overscroll-auto px-4 md:px-6",
        props.className,
      )}
    />
  );
};
Content.displayName = "SlideoutContent";

interface SlideoutHeaderProps extends ComponentPropsWithRef<"header"> {
  onClose?: () => void;
}

const Header = ({ className, children, onClose, ...props }: SlideoutHeaderProps) => {
  return (
    <header {...props} className={cx("relative z-1 w-full px-4 pt-6 md:px-6", className)}>
      {children}
      <CloseButton size="sm" className="absolute top-3 right-3 shrink-0" onClick={onClose} />
    </header>
  );
};
Header.displayName = "SlideoutHeader";

const Footer = (props: ComponentPropsWithRef<"footer">) => {
  return (
    <footer
      {...props}
      className={cx(
        "w-full p-4 shadow-[inset_0px_1px_0px_0px] shadow-border-secondary md:px-6",
        props.className,
      )}
    />
  );
};
Footer.displayName = "SlideoutFooter";

const SlideoutMenu = Menu as typeof Menu & {
  Trigger: typeof AriaDialogTrigger;
  Content: typeof Content;
  Header: typeof Header;
  Footer: typeof Footer;
};
SlideoutMenu.displayName = "SlideoutMenu";

SlideoutMenu.Trigger = AriaDialogTrigger;
SlideoutMenu.Content = Content;
SlideoutMenu.Header = Header;
SlideoutMenu.Footer = Footer;

export { SlideoutMenu };
