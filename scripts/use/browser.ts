import { type Browser, chromium, type Locator, type Page } from "playwright-core";
import type { Frame, World } from "./lib.ts";

// 工作台一侧的使用代码用的浏览器：本机的 Chrome，没有就用 Playwright 下载过的 Chromium。
// 所有场景共用一个浏览器，每次打开页面用新的上下文，场景走完关掉上下文。

let shared: Browser | undefined;

async function launch(): Promise<Browser> {
  shared ??= await chromium
    .launch({ channel: "chrome", headless: true })
    .catch(() => chromium.launch({ headless: true }));
  return shared;
}

/** 换宽度以后等版面稳定：两帧之后再等一下，换屏的过渡是 220 毫秒。 */
async function settle(page: Page): Promise<void> {
  await page.evaluate(
    "new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))",
  );
  await page.waitForTimeout(260);
}

/** 一个标签页当作截图的窗口：换宽度、截整个窗口、量有没有横向滚动条。 */
function frameOf(page: Page): Frame {
  const size = () => page.viewportSize() ?? { width: 1440, height: 1000 };
  return {
    width: () => size().width,
    isOpen: () => !page.isClosed(),
    shoot: async (width) => {
      const before = size();
      const moved = before.width !== width;
      if (moved) await page.setViewportSize({ width, height: before.height });
      // 不换宽度也要等：这一步刚点的东西，换屏的过渡是 220 毫秒
      await settle(page);
      try {
        const facts = (await page.evaluate(`({
          url: location.pathname + location.search,
          overflowX: document.documentElement.scrollWidth > innerWidth + 1,
        })`)) as Record<string, unknown>;
        return { png: await page.screenshot(), facts };
      } finally {
        if (moved) {
          await page.setViewportSize(before);
          await settle(page);
        }
      }
    },
  };
}

/** 这一步走完时截哪个窗口：openPage 打开的最后一个，或者步骤里用它指定。 */
export function show(w: World, page: Page): void {
  w.frame.current = frameOf(page);
}

/**
 * 开一个标签页，打开后端上的 path。width 是窗口宽度，窄屏写 700。
 * before 在打开以前做，例如拦下一个接口的响应，改成场景要的样子。
 */
export async function openPage(
  w: World,
  path: string,
  width = 1440,
  before?: (page: Page) => Promise<void>,
): Promise<Page> {
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width, height: 1000 } });
  w.defer(() => context.close());
  const page = await context.newPage();
  await before?.(page);
  await page.goto(w.url(path));
  show(w, page);
  return page;
}

/** 所有场景走完以后关掉浏览器。 */
export async function closeBrowser(): Promise<void> {
  await shared?.close();
  shared = undefined;
}

/** 在一个输入框里贴一张图，像用户按了粘贴。图是一张红色的小图。 */
export async function pasteImage(box: Locator): Promise<void> {
  await box.focus();
  // 浏览器里跑的代码写成字符串，脚本的类型里没有 DOM。
  await box.page().evaluate(`(async () => {
    const area = document.activeElement;
    const canvas = document.createElement("canvas");
    canvas.width = 120;
    canvas.height = 80;
    const g = canvas.getContext("2d");
    g.fillStyle = "#c62828";
    g.fillRect(0, 0, 120, 80);
    const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
    const data = new DataTransfer();
    data.items.add(new File([blob], "shot.png", { type: "image/png" }));
    area.setSelectionRange(area.value.length, area.value.length);
    area.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  })()`);
}

/** 这一屏里每个单选组都点第一个：先对齐点明白，场景和规范点保留。 */
export async function pickFirstEverywhere(page: Page): Promise<void> {
  const groups = page.locator("main [role=radiogroup]");
  for (let i = 0; i < (await groups.count()); i++) {
    await groups.nth(i).locator("label").first().click();
  }
}

/** 点一个选项：点它的整块，和用户一样。 */
export async function pick(page: Page, name: RegExp | string): Promise<void> {
  await page.locator("label", { has: page.getByRole("radio", { name }) }).click();
}

/** 一个元素算出来的样式里的一项，selector 写 CSS 选择器。 */
export async function styleOf(page: Page, selector: string, property: string): Promise<string> {
  return (await page.evaluate(
    `getComputedStyle(document.querySelector(${JSON.stringify(selector)})).getPropertyValue(${JSON.stringify(property)})`,
  )) as string;
}

/**
 * 从 from 起按 Tab，最多按 max 下，直到键盘停在 selector 圈出的元素里面。
 * 停下时返回 true；一直没到就返回 false。用来核对某个东西能不能用键盘 Tab 到。
 */
export async function tabTo(
  page: Page,
  from: Locator,
  selector: string,
  max = 8,
): Promise<boolean> {
  await from.focus();
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const there = await page.evaluate(
      `document.activeElement !== null && document.activeElement.closest(${JSON.stringify(selector)}) !== null`,
    );
    if (there) return true;
  }
  return false;
}
