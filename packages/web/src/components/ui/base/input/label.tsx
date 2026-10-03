// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：components/base/input/label.tsx。
// 复制以后按本项目的规定改过：引用路径。

import { HelpCircle } from "@untitledui/icons";
import type { ReactNode, Ref } from "react";
import type { LabelProps as AriaLabelProps } from "react-aria-components";
import { Label as AriaLabel } from "react-aria-components";
import { Tooltip, TooltipTrigger } from "@/components/ui/base/tooltip/tooltip";
import { cx } from "@/lib/cx";

interface LabelProps extends AriaLabelProps {
  children: ReactNode;
  isInvalid?: boolean;
  isRequired?: boolean;
  tooltip?: string;
  tooltipDescription?: string;
  ref?: Ref<HTMLLabelElement>;
}

export const Label = ({
  isInvalid,
  isRequired,
  tooltip,
  tooltipDescription,
  className,
  ...props
}: LabelProps) => {
  return (
    <AriaLabel
      // Used for conditionally hiding/showing the label element via CSS:
      // <Input label="Visible only on mobile" className="lg:**:data-label:hidden" />
      // or
      // <Input label="Visible only on mobile" className="lg:label:hidden" />
      data-label="true"
      {...props}
      className={cx(
        "flex cursor-default items-center gap-0.5 text-sm font-medium text-secondary",
        className,
      )}
    >
      {props.children}

      <span
        className={cx(
          "hidden text-brand-tertiary",
          isRequired && "block",
          typeof isRequired === "undefined" && "group-required:block",

          isInvalid && "text-error-primary",
          typeof isInvalid === "undefined" && "group-invalid:text-error-primary",
        )}
      >
        *
      </span>

      {tooltip && (
        <Tooltip title={tooltip} description={tooltipDescription} placement="top">
          <TooltipTrigger
            // `TooltipTrigger` inherits the disabled state from the parent form field
            // but we don't that. We want the tooltip be enabled even if the parent
            // field is disabled.
            isDisabled={false}
            className="cursor-pointer text-fg-quaternary transition duration-200 hover:text-fg-quaternary_hover focus:text-fg-quaternary_hover"
          >
            <HelpCircle className="size-4" />
          </TooltipTrigger>
        </Tooltip>
      )}
    </AriaLabel>
  );
};

Label.displayName = "Label";
