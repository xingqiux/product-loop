// ploop 的一小部分命令树，文字取自「04 命令行」。子命令英文，说明、参数名、选项和帮助中文。
// help 取三种：stock 是 commander 原样（只把文字写成中文）；width 只把 displayWidth 换成 string-width；
// full 是 chineseHelp 的全部（显示宽度、汉字断行、「04 命令行」第四节的结构）。
import { Command } from '@commander-js/extra-typings';
import stringWidth from 'string-width';
import { chineseHelp, withSections } from './help.ts';

export type HelpStyle = 'stock' | 'width' | 'full';

export const STAGES = ['构思', '使用', '检查', '落地', '提升'] as const;

const collect = (value: string, previous: string[] | undefined) => [...(previous ?? []), value];

export function buildProgram(opts: { help?: HelpStyle; width?: number } = {}) {
  const program = new Command('ploop');

  // 这几项设置要在 .command() 之前做：子命令创建时才从父命令复制，之后再改不会传下去
  const width = opts.width;
  if (width !== undefined) program.configureOutput({ getOutHelpWidth: () => width, getErrHelpWidth: () => width });
  if (opts.help === 'width') program.configureHelp({ displayWidth: (s: string) => stringWidth(s) });
  if ((opts.help ?? 'full') === 'full') program.configureHelp(chineseHelp);
  program
    .description('产品循环的命令行。命令名是英文，参数的取值和全部输出是中文。')
    .helpOption('-h, --help', '显示帮助')
    .helpCommand('help [命令]', '显示某条命令的帮助')
    .version('2.0.0-spike', '-V, --version', '显示版本')
    .option('--project <路径或编号>', '指定项目；不写就从当前目录往上找 project.json');

  withSections(program, [
    {
      title: '一轮怎么走',
      items: [
        ['开始', 'ploop round start <阶段>'],
        ['给出信息', 'ploop page present'],
        ['回复', 'ploop reply wait'],
        ['处理', 'ploop reply handle'],
      ],
    },
  ]);

  // 这两条的说明是纯中文的长句，中间没有空格：commander 只在空白处断行，折不了
  program.command('init').description('在当前项目开工：建项目缓存，登记项目，问一次仓库是自己的还是共用的，写忽略规则');
  program.command('status').description('当前项目在第几版、哪个阶段、第几轮，哪一页在等，队列剩什么，下一步做什么');

  // ---- round ----
  const round = program.command('round').description('一轮：开始、查看、收尾');

  const start = round
    .command('start')
    .description('开始一轮：从队列拿出这个阶段的事，编好版本和轮次，报出主线缺哪几样。')
    .argument('<阶段>', '构思、使用、检查、落地、提升之一')
    .option('--take <编号,…>', '落地轮用来定这一批，例如 --take Q12,Q15；不写就拿出这个阶段全部待办的事')
    .option('--defer <编号>=<依赖>', '这件事要等别的事，改成等待并写明依赖；可以写多次', collect)
    .option('--json', '输出机读的结果')
    .action((stage, options, cmd) => {
      if (!(STAGES as readonly string[]).includes(stage)) {
        cmd.error(`用法错误：阶段只能是${STAGES.join('、')}之一，收到的是「${stage}」。`, { exitCode: 2 });
      }
      const take = options.take?.split(',') ?? [];
      const defer = options.defer ?? [];
      console.log(JSON.stringify({ command: 'round start', stage, take, defer, json: options.json ?? false }));
    });
  withSections(start, [
    {
      title: '会拦截的情况',
      items: [
        ['上一轮的回复还有行没有处理', '先运行 ploop reply show，再用 ploop reply handle 处理'],
        ['另一轮还开着且不能自动收尾', '先运行 ploop round close'],
        ['项目停在旧版本的 skill', '先运行 ploop doctor'],
        ['进入检查时主线的设计规范缺项', '按输出补主线，再开始'],
      ],
    },
    {
      title: '读和写',
      items: [
        ['读', '项目缓存的 project.json、主线.md'],
        ['写', '集中存储的轮次、队列；项目缓存的 rounds/<轮次>/'],
      ],
    },
    {
      title: '例子',
      items: ['ploop round start 检查', 'ploop round start 落地 --take Q12,Q15 --defer Q9="等构思定下场景 S4"'],
    },
    {
      title: '做完以后',
      items: [
        '逐件判断拿出来的事，不成立的运行 ploop queue drop <编号> --reason <原因>',
        '做这个阶段的活，把页面数据写进 rounds/<轮次>/page.json，再运行 ploop page present',
      ],
    },
  ]);

  round
    .command('show')
    .description('看一轮的状态、拿出来的事、页面和回复')
    .argument('[轮次]', '例如 v2-检查-1；不写就看当前这一轮')
    .option('--json', '输出机读的结果');
  round.command('close').description('收尾：检查这一轮拿出来的事都有结果，落地轮另查代码全部提交');

  // ---- page / reply / queue ----
  const page = program.command('page').description('页面：校验和给出信息');
  page.command('check').description('只校验页面数据，不给出').argument('[路径]', '页面数据的文件');
  page
    .command('present')
    .description('给出信息：校验、上传截图、存成一页，打印工作台里的地址')
    .argument('[路径]', '页面数据的文件；不写就用这一轮工作区里的 page.json');

  const reply = program.command('reply').description('回复：等待、查看、处理');
  reply
    .command('wait')
    .description('等用户在工作台提交，提交了就退出并打印回复')
    .option('--timeout <秒>', '最多等多久，到时限退出码为 0 并打印「还在等」', (v) => Number(v), 600);
  reply
    .command('handle')
    .description('处理回复：给每一行定去处，可以一次处理多行')
    .option('--file <路径>', '去处的文件，例如 rounds/v2-检查-1/destinations.json');

  const queue = program.command('queue').description('队列的查看和维护');
  queue
    .command('add')
    .description('放进一件事')
    .argument('<标题>', '一句话写清是什么事')
    .option('--stage <阶段>', '归到哪个阶段', '检查');
  queue
    .command('drop')
    .description('取消一件事，原因必填')
    .argument('<编号>', '例如 Q15')
    .requiredOption('--reason <原因>', '为什么不成立，会列在页面的「这一轮开始时取消的事」里');

  return program;
}

/** 按路径找子命令，例如 ['round', 'start']。 */
export function findCommand(program: ReturnType<typeof buildProgram>, path: string[]) {
  let cmd = program as unknown as { commands: readonly unknown[]; name(): string };
  for (const name of path) {
    const next = cmd.commands.find((c) => (c as { name(): string }).name() === name);
    if (!next) throw new Error(`没有这条命令：${path.join(' ')}`);
    cmd = next as typeof cmd;
  }
  return cmd as unknown as { helpInformation(): string };
}
