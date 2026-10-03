// 使用代码的记录器：把每一步的结果写成 ploop use run 收的 use-run.json。格式的定义用 ploop use schema 查看。
// 输出目录取环境变量 PLOOP_USE_OUT，ploop use run 运行使用代码时会设好。没有这个变量时写进一个临时目录。
// 用法：
//   const run = openRun();
//   const scene = run.scene("S1");                       // 场景编号写主线里的，例如 S1，不写场景的名字
//   await scene.step({ step: 1, do: "点「我的设计」", expect: "看到设计卡片", width: 1400 }, async (ctx) => {
//     await ctx.screenshot("1400-我的设计", pngBytes);   // 截图写进输出目录，记成相对路径
//     ctx.facts({ cards: 12 });                          // 量到的事实，只给 AI 看
//   });
//   process.exit(run.finish());                          // 写 use-run.json；有一步没通过就返回 1
// 同一步要在几个宽度下各看一次时，step 相同、width 不同，各记一项。
// 一步抛出错误就记成「断了」，错误信息写进 error；同一场景后面的步记成「没走」。
// 分不清是产品坏了还是环境坏了时，在这一步里抛出 new EnvError("原因")，结果记成「环境」，不算产品的断点。
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export class EnvError extends Error {}

export function openRun() {
  const out = process.env.PLOOP_USE_OUT ?? fs.mkdtempSync(path.join(os.tmpdir(), "ploop-use-out-"));
  fs.mkdirSync(out, { recursive: true });
  const startedAt = new Date().toISOString();
  const scenes = [];

  function scene(id) {
    const entry = { scene: id, steps: [] };
    scenes.push(entry);
    let broken;
    return {
      /** 记一步。info 写 step（主线里的步号）、do 和 expect，要看排版的步骤再写 width；action 里做这一步要做的事。 */
      async step(info, action) {
        const record = { step: info.step, do: info.do, expect: info.expect };
        if (info.width !== undefined) record.width = info.width;
        if (broken !== undefined) {
          entry.steps.push({ ...record, result: "没走", error: broken });
          return;
        }
        const ctx = {
          async screenshot(name, bytes) {
            const rel = `screens/${name}.png`;
            fs.mkdirSync(path.join(out, "screens"), { recursive: true });
            fs.writeFileSync(path.join(out, rel), bytes);
            record.screenshot = rel;
          },
          facts(values) {
            record.facts = { ...record.facts, ...values };
          },
        };
        try {
          await action(ctx);
          entry.steps.push({ ...record, result: "通过" });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          if (error instanceof EnvError) {
            entry.steps.push({ ...record, result: "环境", error: reason });
          } else {
            entry.steps.push({ ...record, result: "断了", error: reason });
          }
          broken = `第 ${record.step} 步没有通过`;
        }
      },
    };
  }

  function finish() {
    const run = {
      schemaVersion: 1,
      startedAt,
      finishedAt: new Date().toISOString(),
      environment: `node ${process.version}，${process.platform}`,
      scenes: scenes.filter((s) => s.steps.length > 0),
    };
    fs.writeFileSync(path.join(out, "use-run.json"), `${JSON.stringify(run, null, 2)}\n`);
    console.log(`结果：${path.join(out, "use-run.json")}`);
    return scenes.every((s) => s.steps.every((step) => step.result === "通过")) ? 0 : 1;
  }

  return { out, scene, finish };
}
