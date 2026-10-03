// 第二项：commander 的中文帮助对齐。
// 子命令英文，说明、参数名、选项、帮助中文。按显示宽度（汉字算 2 列）检查每一节的说明是否从同一列开始。
// 三种帮助：stock 是 commander 原样；width 只把 displayWidth 换成 string-width；full 是 packages/cli/src/help.ts 的全部。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import stringWidth from 'string-width';
import { bin, ROOT, Report, run } from './lib/util.ts';

const r = new Report('二、commander 的中文帮助对齐');

const cli = (args: string[], env: Record<string, string> = {}) =>
  run(process.execPath, ['packages/cli/src/main.ts', ...args], { env });
const help = (style: 'stock' | 'width' | 'full', args: string[], width?: number) =>
  cli([...args, '--help'], { PLOOP_HELP: style, ...(width ? { PLOOP_HELP_WIDTH: String(width) } : {}) }).stdout;

type Section = { title: string; columns: number[]; lines: string[] };

/** 找出每一节里「项 + 两个以上空格 + 说明」的行和它们的续行，按显示宽度算说明从第几列开始。 */
function inspect(text: string): Section[] {
  const blocks: { title: string; lines: string[] }[] = [{ title: '', lines: [] }];
  for (const line of text.split('\n')) {
    if (line !== '' && !line.startsWith(' ')) blocks.push({ title: line, lines: [] });
    else blocks.at(-1)?.lines.push(line);
  }
  const sections: Section[] = [];
  for (const block of blocks) {
    const columns = new Set<number>();
    const lines: string[] = [];
    for (const line of block.lines) {
      const item = /^( {2}\S(?:.*?\S)?)( {2,})\S/.exec(line);
      const continuation = /^( {3,})\S/.exec(line);
      if (item) columns.add(stringWidth((item[1] ?? '') + (item[2] ?? '')));
      else if (continuation && lines.length > 0) columns.add(continuation[1]?.length ?? 0);
      else continue;
      lines.push(line);
    }
    if (lines.length > 0) sections.push({ title: block.title, columns: [...columns].sort((a, b) => a - b), lines });
  }
  return sections;
}
const aligned = (s: Section[]) => s.every((x) => x.columns.length === 1);
const overflow = (s: Section[], width: number) => s.flatMap((x) => x.lines).filter((l) => stringWidth(l) > width);
const wrapped = (s: Section[]) => s.some((x) => x.lines.some((l) => /^ {3,}\S/.test(l)));
const columnsText = (s: Section[]) =>
  s.map((x) => `${x.title}：说明从第 ${x.columns.join('、')} 列开始${x.columns.length > 1 ? '（错开）' : ''}`).join('；');

const COMMANDS = [['round', 'start'], ['round'], []] as const;
const name = (path: readonly string[]) => ['ploop', ...path, '--help'].join(' ');

r.section('版本');
const version = (pkg: string) =>
  (JSON.parse(readFileSync(join(ROOT, 'packages/cli/node_modules', pkg, 'package.json'), 'utf8')) as { version: string }).version;
r.evidence(`commander ${version('commander')}，@commander-js/extra-typings ${version('@commander-js/extra-typings')}，string-width ${version('string-width')}`);

r.section('类型检查');
const t = run(bin('tsc'), ['--noEmit', '-p', 'packages/cli']);
r.check('packages/cli 通过 tsc --noEmit（extra-typings 推出选项和参数的类型）', t.code === 0, t.output);

r.section('改前：commander 原样（只把文字写成中文），宽度 80');
const stockStart = help('stock', ['round', 'start'], 80);
r.evidence(stockStart);
const stock = COMMANDS.map((p) => ({ path: p, sections: inspect(help('stock', [...p], 80)) }));
for (const s of stock) r.evidence(`${name(s.path)}：${columnsText(s.sections)}`);
r.check(
  '复现问题：原样的 commander 按字符串长度补空格，含中文的项让说明错开（round start 和 ploop 两处都错开）',
  !aligned(stock[0]?.sections ?? []) && !aligned(stock[2]?.sections ?? []),
);

r.section('最小的改法：configureHelp({ displayWidth: stringWidth })，宽度 80');
const width = COMMANDS.map((p) => ({ path: p, sections: inspect(help('width', [...p], 80)) }));
for (const s of width) r.evidence(`${name(s.path)}：${columnsText(s.sections)}`);
r.check('只换 displayWidth，三条命令的帮助每一节都对齐', width.every((s) => aligned(s.sections)));
const widthOverflow = width.flatMap((s) => overflow(s.sections, 80));
r.evidence(
  `但纯中文的长说明折不了行（commander 只在空白处断行），${widthOverflow.length} 行超过 80 列，在 80 列的终端里会被硬折到第 1 列：\n` +
    widthOverflow.map((l) => `${l}   ← ${stringWidth(l)} 列`).join('\n'),
);

r.section('改后：packages/cli/src/help.ts（显示宽度 + 汉字断行 + 「04 命令行」的结构），终端宽度 80');
const full80 = COMMANDS.map((p) => ({ path: p, text: help('full', [...p], 80) }));
r.evidence(full80[2]?.text ?? '');
const full80Sections = full80.map((s) => ({ path: s.path, sections: inspect(s.text) }));
for (const s of full80Sections) r.evidence(`${name(s.path)}：${columnsText(s.sections)}`);
r.check('三条命令的帮助每一节都对齐（含续行）', full80Sections.every((s) => aligned(s.sections)));
r.check(
  '对齐的各节没有一行超过 80 列（纯中文的长说明在汉字之间折行）',
  full80Sections.every((s) => overflow(s.sections, 80).length === 0) && full80Sections.some((s) => wrapped(s.sections)),
);

r.section('改后：不是终端时（AI 在 Bash 工具里读）不折行，这是 node packages/cli/src/main.ts round start --help 的原样输出');
const plainStart = cli(['round', 'start', '--help']).stdout;
r.evidence(plainStart);
const plain = COMMANDS.map((p) => ({ path: p, sections: inspect(cli([...p, '--help']).stdout) }));
for (const s of plain) r.evidence(`${name(s.path)}：${columnsText(s.sections)}`);
r.check('不是终端时三条命令的帮助每一节都对齐，且没有折行', plain.every((s) => aligned(s.sections) && !wrapped(s.sections)));

r.section('解析中文的取值');
const parsed = cli(['round', 'start', '落地', '--take', 'Q12,Q15', '--defer', 'Q9=等构思定下场景S4', '--defer', 'Q10=等Q9', '--json']);
r.evidence(`$ ploop round start 落地 --take Q12,Q15 --defer Q9=等构思定下场景S4 --defer Q10=等Q9 --json\n${parsed.output}`);
let value: { stage?: string; take?: string[]; defer?: string[]; json?: boolean } = {};
try {
  value = JSON.parse(parsed.stdout);
} catch {
  // 下面的检查会失败
}
r.check(
  '中文的参数和选项取值原样解析，可以重复的选项收成数组',
  parsed.code === 0 &&
    value.stage === '落地' &&
    value.take?.join() === 'Q12,Q15' &&
    value.defer?.join('|') === 'Q9=等构思定下场景S4|Q10=等Q9' &&
    value.json === true,
);
const bad = cli(['round', 'start', '评审']);
r.evidence(`$ ploop round start 评审\n${bad.output.trimEnd()}\n（退出码 ${bad.code}）`);
r.check('命令自己报的用法错误是中文，退出码 2（「04 命令行」第七节）', bad.code === 2 && bad.stderr.includes('用法错误'));

r.section('另外看到的（不算检查项）');
const missing = cli(['round', 'start']);
r.evidence(`$ ploop round start\n${missing.output.trimEnd()}\n（退出码 ${missing.code}：commander 自带的报错是英文，退出码 1，要另用 exitOverride 换成中文和退出码 2）`);

r.finish();
