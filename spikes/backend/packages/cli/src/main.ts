// 入口：node src/main.ts <命令> …
// 验证用的两个开关：PLOOP_HELP=stock|width|full 选帮助的格式（默认 full），PLOOP_HELP_WIDTH 指定帮助的宽度。
import { buildProgram, type HelpStyle } from './program.ts';

const help = (process.env.PLOOP_HELP ?? 'full') as HelpStyle;
const width = process.env.PLOOP_HELP_WIDTH ? Number(process.env.PLOOP_HELP_WIDTH) : undefined;

await buildProgram({ help, width }).parseAsync();
