import { defineConfig } from "drizzle-kit";

// drizzle-kit 按表的定义生成迁移文件，只用 generate，不用 push，见「03 数据模型」第八节。
// 表的定义里不写列名，由属性名转成蛇形写法。运行时的 drizzle() 用同一种转换，见 src/store/db.ts。
export default defineConfig({
  dialect: "sqlite",
  casing: "snake_case",
  schema: "./src/store/schema/index.ts",
  out: "./drizzle",
});
