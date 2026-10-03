// 主题的三条规定：色值只写在 theme.css 开头的十个颜色里；组件里不写色值；动效的取值两边一致。
// 见决定 191 和 193、「02 技术选型」第十一节。
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";

const src = fileURLToPath(new URL("..", import.meta.url));
const theme = readFileSync(join(src, "styles", "theme.css"), "utf8");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

// 十六进制色值、rgb()、hsl()、oklch()、color-mix()，以及 Tailwind 的任意色值写法 bg-[#...]。
const colorLiteral = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/giu;

describe("组件里不写色值", () => {
  const files = sourceFiles(src).filter((path) => !path.endsWith("routeTree.gen.ts"));

  it("找得到要查的文件", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  it.each(files.map((path) => [relative(src, path), path]))("%s", (_name, path) => {
    const lines = readFileSync(path, "utf8").split("\n");
    const found = lines.flatMap((line, index) =>
      [...line.matchAll(colorLiteral)].map((match) => `第 ${index + 1} 行：${match[0]}`),
    );
    expect(found).toEqual([]);
  });
});

describe("色值只写在主题开头的十个颜色里", () => {
  const palette = {
    white: "#ffffff",
    wash: "#fafafa",
    line: "#ebebeb",
    icon: "#8d8d8d",
    sub: "#5c5c5c",
    ink: "#171717",
    accent: "#0066db",
    done: "#15803d",
    wait: "#cb4600",
    del: "#c62828",
  };

  it("十个颜色是配色 a 的取值", () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(theme).toContain(`--color-${name}: ${hex};`);
    }
  });

  it("除了这十行和拉伸角的图标，主题里没有别的色值", () => {
    const rest = theme
      .split("\n")
      .filter((line) => !/^\s*--color-[a-z]+: #[0-9a-f]{6};$/u.test(line))
      .filter((line) => !line.includes("--resize-handle-bg"))
      .join("\n");
    expect(rest.match(/#[0-9a-f]{3,8}\b/giu) ?? []).toEqual([]);
  });

  it("主按钮用墨，焦点用蓝", () => {
    expect(theme).toContain("--color-bg-brand-solid: var(--color-ink);");
    expect(theme).toContain("--color-focus-ring: var(--color-accent);");
  });
});

describe("动效的取值两边一致", () => {
  it.each(Object.entries(motionTokens))("%s", (name, token) => {
    expect(theme).toContain(`--duration-${name}: ${Math.round(token.duration * 1000)}ms;`);
    if (Array.isArray(token.ease)) {
      const curve = `cubic-bezier(${token.ease.join(", ")})`;
      const declared = [...theme.matchAll(/--ease-[a-z]+: (cubic-bezier\([^)]*\));/gu)].map(
        (match) => match[1],
      );
      expect(declared).toContain(curve);
    }
  });
});

describe("新加的字号登记进了类名合并", () => {
  it.each(["title", "heading", "body", "ui", "meta", "label"])(
    "text-%s 和文字颜色不互相覆盖",
    (size) => {
      expect(cx(`text-${size}`, "text-primary")).toBe(`text-${size} text-primary`);
      expect(cx("text-sm", `text-${size}`)).toBe(`text-${size}`);
    },
  );
});
