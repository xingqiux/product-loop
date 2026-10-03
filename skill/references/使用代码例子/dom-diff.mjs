// 用法：node dom-diff.mjs <目录甲> <目录乙>   逐个同名网页渲染后比较 #app 的结构，有一个不同就以失败退出
// 用在重构那一步：改结构、页面不变，改之前和改之后各生成一批网页，比较渲染出来的结构。#app 换成项目的根元素。
// playwright-core 从项目里找：环境变量 PLAYWRIGHT_FROM 指向装了它的 package.json，不写就用当前目录的。
import { createRequire } from "module"; import fs from "fs"; import path from "path";
const require = createRequire(process.env.PLAYWRIGHT_FROM || path.resolve("package.json"));
const { chromium } = require("playwright-core");
const [a, b] = process.argv.slice(2);
const br = await chromium.launch({ channel: "chrome", headless: true });
const p = await br.newPage({ viewport: { width: 1500, height: 900 } });
let bad = 0;
for (const f of fs.readdirSync(a).filter((x) => x.endsWith(".html"))) {
  const dom = [];
  for (const d of [a, b]) { await p.goto("file://" + path.resolve(d, f)); await p.waitForTimeout(300); dom.push(await p.evaluate(() => document.getElementById("app").innerHTML)); }
  const same = dom[0] === dom[1]; if (!same) bad++;
  console.log(same ? "一致" : "不同", f, dom[0].length);
}
await br.close(); process.exit(bad ? 1 : 0);
