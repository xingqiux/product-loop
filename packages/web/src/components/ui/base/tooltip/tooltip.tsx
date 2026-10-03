// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：components/base/tooltip/tooltip.tsx。
// 复制以后按本项目的规定改过：引用路径；进出场改用 Motion（决定 192）。
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useContext } from "react";
import type {
  ButtonProps as AriaButtonProps,
  TooltipProps as AriaTooltipProps,
  TooltipTriggerComponentProps as AriaTooltipTriggerComponentProps,
} from "react-aria-components";
import {
  Button as AriaButton,
  OverlayArrow as AriaOverlayArrow,
  Tooltip as AriaTooltip,
  TooltipTrigger as AriaTooltipTrigger,
  TooltipTriggerStateContext,
} from "react-aria-components";
import { cx } from "@/lib/cx";
import { motionTokens, type WithoutDomAnimation } from "@/lib/motion";

const MotionTooltip = motion.create(AriaTooltip);

// 进出场交给 Motion：TooltipTrigger 的开关状态决定挂不挂上，AnimatePresence 等退场动画播完再卸下。
// 挂上的那一份一直是打开的，React Aria 不再自己判断退场。
const AnimatedTooltip = (props: WithoutDomAnimation<AriaTooltipProps>) => {
  const state = useContext(TooltipTriggerStateContext);
  return (
    <AnimatePresence>
      {state?.isOpen && (
        <MotionTooltip
          {...props}
          isOpen
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          transition={motionTokens.select}
        />
      )}
    </AnimatePresence>
  );
};

export interface TooltipProps
  extends AriaTooltipTriggerComponentProps,
    Omit<WithoutDomAnimation<AriaTooltipProps>, "children"> {
  /**
   * The title of the tooltip.
   */
  title: ReactNode;
  /**
   * The description of the tooltip.
   */
  description?: ReactNode;
  /**
   * Whether to show the arrow on the tooltip.
   *
   * @default false
   */
  arrow?: boolean;
  /**
   * Delay in milliseconds before the tooltip is shown.
   *
   * @default 300
   */
  delay?: number;
}

export const Tooltip = ({
  title,
  description,
  children,
  arrow = false,
  delay = 300,
  closeDelay = 0,
  trigger,
  isDisabled,
  isOpen,
  defaultOpen,
  offset = 6,
  crossOffset,
  placement = "top",
  onOpenChange,
  ...tooltipProps
}: TooltipProps) => {
  const isTopOrBottomLeft = ["top left", "top end", "bottom left", "bottom end"].includes(
    placement,
  );
  const isTopOrBottomRight = ["top right", "top start", "bottom right", "bottom start"].includes(
    placement,
  );
  // Set negative cross offset for left and right placement to visually balance the tooltip.
  const calculatedCrossOffset = isTopOrBottomLeft ? -12 : isTopOrBottomRight ? 12 : 0;

  return (
    <AriaTooltipTrigger
      {...{ trigger, delay, closeDelay, isDisabled, isOpen, defaultOpen, onOpenChange }}
    >
      {children}

      <AnimatedTooltip
        {...tooltipProps}
        offset={offset}
        placement={placement}
        crossOffset={crossOffset ?? calculatedCrossOffset}
        className="origin-(--trigger-anchor-point)"
      >
        <div
          className={cx(
            "z-50 flex max-w-xs flex-col items-start gap-1 rounded-lg bg-primary-solid px-3 shadow-lg",
            description ? "py-3" : "py-2",
          )}
        >
          <span className="text-xs font-semibold text-white">{title}</span>

          {description && (
            <span className="text-xs font-medium text-tooltip-supporting-text">{description}</span>
          )}

          {arrow && (
            <AriaOverlayArrow>
              <svg
                viewBox="0 0 100 100"
                className="size-2.5 fill-bg-primary-solid in-placement-left:-rotate-90 in-placement-right:rotate-90 in-placement-top:rotate-0 in-placement-bottom:rotate-180"
              >
                <path d="M0,0 L35.858,35.858 Q50,50 64.142,35.858 L100,0 Z" />
              </svg>
            </AriaOverlayArrow>
          )}
        </div>
      </AnimatedTooltip>
    </AriaTooltipTrigger>
  );
};

type TooltipTriggerProps = AriaButtonProps;

export const TooltipTrigger = ({ children, className, ...buttonProps }: TooltipTriggerProps) => {
  return (
    <AriaButton
      {...buttonProps}
      className={(values) =>
        cx(
          "h-max w-max outline-hidden",
          typeof className === "function" ? className(values) : className,
        )
      }
    >
      {children}
    </AriaButton>
  );
};
