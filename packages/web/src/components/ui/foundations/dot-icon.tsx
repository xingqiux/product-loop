// 来自 Untitled UI React（MIT），由 untitledui 0.1.68 的命令行复制：components/foundations/dot-icon.tsx。
// 复制以后按本项目的规定改过：引用路径。
import type { HTMLAttributes } from "react";

const sizes = {
  sm: {
    wh: 8,
    c: 4,
    r: 2.5,
  },
  md: {
    wh: 10,
    c: 5,
    r: 4,
  },
};

export const Dot = ({
  size = "md",
  ...props
}: HTMLAttributes<HTMLOrSVGElement> & { size?: "sm" | "md" }) => {
  return (
    <svg
      width={sizes[size].wh}
      height={sizes[size].wh}
      viewBox={`0 0 ${sizes[size].wh} ${sizes[size].wh}`}
      fill="none"
      {...props}
    >
      <circle
        cx={sizes[size].c}
        cy={sizes[size].c}
        r={sizes[size].r}
        fill="currentColor"
        stroke="currentColor"
      />
    </svg>
  );
};
