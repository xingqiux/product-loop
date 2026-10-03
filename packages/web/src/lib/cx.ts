// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：utils/cx.ts。
// 复制以后按本项目的规定改过：引用路径；登记本项目的字号。
import { extendTailwindMerge } from "tailwind-merge";

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      // 后六个是本项目的字号，见 styles/theme.css。
      text: [
        "display-xs",
        "display-sm",
        "display-md",
        "display-lg",
        "display-xl",
        "display-2xl",
        "title",
        "heading",
        "body",
        "ui",
        "meta",
        "label",
      ],
    },
  },
});

/**
 * This function is a wrapper around the twMerge function.
 * It is used to merge the classes inside style objects.
 */
export const cx = twMerge;

/**
 * This function does nothing besides helping us to be able to
 * sort the classes inside style objects which is not supported
 * by the Tailwind IntelliSense by default.
 */
export function sortCx<
  T extends Record<
    string,
    string | number | Record<string, string | number | Record<string, string | number>>
  >,
>(classes: T): T {
  return classes;
}
