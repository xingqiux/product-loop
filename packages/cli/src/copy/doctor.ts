import { copy } from "@product-loop/model";

// 迁移检查报告的文字，见「08 版本与迁移」第四节和「04 命令行」第五节。
// 每一项先写发现了什么，再写 --fix 做什么，最后写要 AI 确认什么，一句一行。
// 暂时放在命令行里，以后并进共用定义的文案表（约定 0002 第 15 条）。

const root = "/Users/me/proj/app";
const oldFolder = "/Users/me/Documents/产品循环/skill自己的产品文档";

export const doctorCopy = {
  /** 第一行：结果。 */
  title: copy("迁移检查完成：{root}", { root }),
  /** 第二行：这次迁移哪一处的旧文件。 */
  source: copy("旧文件的位置：{dir}（{layout}）", { dir: oldFolder, layout: "旧文件夹" }),
  summary: {
    confirm: copy("{confirm} 个检查项要 AI 确认，{fix} 个由 --fix 迁移。", { confirm: 2, fix: 5 }),
    fix: copy("没有要确认的地方，{fix} 个检查项由 --fix 迁移。", { fix: 5 }),
    clean: copy("没有要迁移的地方。"),
    fresh: copy("这里没有产品循环的文件。"),
  },
  /** 每一项的第一行：检查项和结论。 */
  head: copy("{item}：{status}", { item: "队列", status: "要确认" }),
  found: copy("发现：{text}", { text: "没有 project.json。" }),
  fix: copy("--fix：{text}", { text: "在集中存储里登记项目。" }),
  confirm: copy("确认：{text}", { text: "旧表格的每一行写进队列迁移对照，逐行确认。" }),
  /** 列表太长时只写前几项。 */
  more: copy("{items} 等 {count} 个", { items: "Q1、Q2、Q3", count: 23 }),
  next: {
    confirm: copy("逐项核对「确认」开头的行，改好以后重跑 ploop doctor"),
    fix: copy("ploop doctor --fix"),
    clean: copy("ploop status"),
    fresh: copy("在项目根目录运行 ploop init 开工"),
    from: copy("旧文件在项目根以外时，运行 ploop doctor --from <目录>"),
  },
  identity: {
    missing: copy("没有 project.json。"),
    register: copy("在集中存储里登记项目，迁移完成时写 project.json。"),
    valid: copy("project.json 记着项目 {projectId}。", { projectId: "app" }),
    rewrite: copy("按集中存储里的登记重写 project.json。"),
    /** project.json 在，集中存储里没有登记这个目录，例如数据库恢复到了较早的备份。 */
    notRegistered: copy("project.json 记着项目 {projectId}，集中存储里没有登记它。", {
      projectId: "app",
    }),
    notRegisteredWhy: copy("可能恢复过较早的备份。"),
    registerAgain: copy("重新登记这个目录，项目缓存原样保留，主线.md 交成第 1 版。"),
    /** project.json 记着的项目，和集中存储里这个目录登记的项目不同。 */
    registeredToOther: copy("project.json 记着 {projectId}，这个目录登记的是 {other}。", {
      projectId: "app-old",
      other: "app",
    }),
    relink: copy("把 project.json 改成 {other}，项目缓存原样保留。", { other: "app" }),
    fresh: copy("没有 project.json，也没有旧 skill 的文件。"),
  },
  location: {
    inCache: copy("旧文件已经在项目缓存 .product-loop/ 里。"),
    inDocs: copy("产品循环的旧文件在 docs/ 下：{files}。", { files: "主线.md、决定.md、队列.md" }),
    ownDocs: copy("docs/ 里另有项目自己的文档：{files}。它们不动。", {
      files: "architecture.md、cases/",
    }),
    docsFix: copy("新的项目缓存建在 .product-loop/。docs/ 里产品循环的文件在清理时删除。"),
    inFolder: copy("旧文件在项目根以外：{dir}。", { dir: oldFolder }),
    folderFix: copy("新的项目缓存建在项目根的 .product-loop/，旧文件夹在清理时整个删除。"),
    files: copy("归档包要收 {count} 个旧文件。", { count: 412 }),
    tracked: copy("{dir} 里已提交进 git 的旧文件：{files}。", {
      dir: "docs/",
      files: "主线.md、决定.md、队列.md",
    }),
    trackedFix: copy("清理时用 git 删除这几个文件，在那个仓库里单独提交一次。"),
    none: copy("没有找到旧 skill 的文件。"),
    fromEmpty: copy("--from 指的 {dir} 里没有旧 skill 的文件。", { dir: oldFolder }),
    rootIsFolder: copy("项目根本身是旧 skill 的产品文档文件夹。"),
    rootIsFolderHint: copy("到项目的根目录运行 ploop doctor --from {dir}。", { dir: oldFolder }),
    other: copy("另有一处旧文件：{dir}，有 {files}。", {
      dir: `${root}/docs`,
      files: "主线.md、决定.md",
    }),
    otherHint: copy("两处都有旧文件，先确认哪一处属于这个项目。"),
    nested: copy("{dir} 是另一份旧 skill 的产品文档。", { dir: "archive/font-size-axes" }),
    nestedHint: copy(
      "它会随这个项目一起归档，并在清理时删除。要单独迁移它，先在它的项目根运行 ploop doctor --from {dir}。",
      { dir: `${root}/.product-loop/archive/font-size-axes` },
    ),
  },
  ignore: {
    noRepo: copy("项目根不在 git 仓库里，不用写忽略规则。"),
    ignored: copy(".product-loop/ 已被 {source} 里的 {pattern} 忽略。", {
      source: ".gitignore",
      pattern: ".product-loop/",
    }),
    notIgnored: copy(".product-loop/ 没被忽略。"),
    worktree: copy("项目根是仓库的附加工作目录。"),
    mainlineKind: copy("旧主线写着这是{kind}仓库。", { kind: "共用的" }),
    fixOwn: copy("按自己的仓库写进 .gitignore。"),
    fixShared: copy("按共用的仓库写进 .git/info/exclude。"),
    askKind: copy(
      "看不出仓库是自己的还是共用的，要问用户。自己的写 .gitignore，共用的写 .git/info/exclude。",
    ),
  },
  mainline: {
    missing: copy("没有主线.md，迁移以后从构思开始写。"),
    links: copy("开头有 claude.ai 的固定链接，在第 {lines} 行。", { lines: "5" }),
    scenes: copy("场景清单有 {count} 个场景，{assigned} 个没有编号。", { count: 9, assigned: 9 }),
    legacyScenes: copy("其中 {count} 个是旧写法，补编号时改成新的写法。", { count: 9 }),
    parts: copy("主线缺 {count} 个部分，只报告。", { count: 2 }),
    problem: copy("第 {line} 行：{message}", { line: 12, message: "场景「回答疑问」没有步骤。" }),
    moreProblems: copy("解析时另有 {count} 个地方不合新的写法，只报告。", { count: 4 }),
    fixPlain: copy("原文存为主线修订 1，写成项目缓存里的主线.md。"),
    fixClean: copy(
      "原文存为主线修订 1。去掉链接、补上场景编号以后存为修订 2，写成项目缓存里的主线.md。",
    ),
  },
  decisions: {
    missing: copy("没有决定.md。"),
    rows: copy("决定.md 有 {count} 行：{shapes}。", { count: 87, shapes: "五列带编号 86 行" }),
    shape: copy("{shape} {count} 行", { shape: "五列带编号", count: 86 }),
    noRows: copy("决定.md 里没有决定。"),
    attached: copy("{count} 行被空行截断或接在别的表后面，已按列数归到对应的表。", { count: 5 }),
    voided: copy("{count} 行写着已作废，状态记为已作废。", { count: 2 }),
    laterNoCase: copy("{count} 行以后再说没有案例。旧表格本来没有这一列，导入时不补。", {
      count: 4,
    }),
    fix: copy("按列数和表头识别每一行，导入集中存储，重新生成决定.md。"),
    row: copy("第 {line} 行：{text}", { line: 8, text: "没有日期，迁移时缺日期。" }),
    skippedHint: copy("没有读的行不导入，确认它们的去处，例如放进队列。"),
  },
  queue: {
    missing: copy("没有队列.md，也没有队列.json。"),
    table: copy("旧的队列表格有 {count} 件，建议{statuses}。", {
      count: 38,
      statuses: "待办 9 件、等待 6 件、待核对 23 件",
    }),
    json: copy("队列.json 有 {count} 件，建议{statuses}。", {
      count: 84,
      statuses: "已完成 71 件、待办 4 件",
    }),
    /** 一件也没有时不写「建议」，后面没有可写的。 */
    empty: copy("{file}里没有事项。", { file: "队列.json" }),
    status: copy("{status} {count} 件", { status: "待核对", count: 23 }),
    alsoTable: copy("另有旧的队列.md，以队列.json 为准，队列.md 只进归档。"),
    syntax: copy("队列.json 不是合法的 JSON，在第 {line} 行第 {column} 列。", {
      line: 3,
      column: 7,
    }),
    syntaxNoAt: copy("队列.json 不是合法的 JSON。"),
    fixTable: copy("按确认过的队列迁移对照导入，编号从 Q1 到 {last}。", { last: "Q38" }),
    fixJson: copy("十格照收，只补编号，从 Q1 到 {last}。", { last: "Q84" }),
    everyRow: copy("旧表格的每一行写进队列迁移对照，逐行确认。"),
    group: copy("{ids}：{text}", {
      ids: "Q1、Q2",
      text: "写着「已进第几轮」，查提交记录以后定为已完成或待办。",
    }),
  },
  stageName: {
    pages: copy("{count} 页的页面数据写着修复：{ids}。", { count: 2, ids: "fix-1、fix-2" }),
    queue: copy("{count} 件队列事项的阶段名写着修复。", { count: 3 }),
    fix: copy("导入时换成落地，迁移前的文件名原样保留。"),
    none: copy("没有写着修复的地方。"),
  },
  pages: {
    none: copy("没有 walk/。"),
    summary: copy("walk/ 下有 {pages} 页页面数据，归成 {rounds} 个阶段：{stages}。", {
      pages: 57,
      rounds: 56,
      stages: "构思 31 个、落地 20 个",
    }),
    /** 一页也没有：不写「归成几个阶段」，后面没有可列的。 */
    noPages: copy("walk/ 下没有页面数据。"),
    stage: copy("{stage} {count} 个", { stage: "构思", count: 31 }),
    unknownStage: copy("看不出阶段名"),
    converted: copy("转换以后 {clean} 页可以直接导入，{problems} 页还有要改的地方。", {
      clean: 20,
      problems: 37,
    }),
    htmlOnly: copy("{count} 页只有网页：{files}。", {
      count: 1,
      files: "2026-09-19/think-2-v2.html",
    }),
    embeds: copy("其中 {files} 的网页里嵌着页面数据，仍按快照存。", {
      files: "2026-09-19/think-2-v2.html",
    }),
    images: copy("截图 {count} 张，页面引用了 {referenced} 张。", { count: 313, referenced: 286 }),
    facts: copy("事实文件和别的数据 {count} 份，例如 {files}。", {
      count: 9,
      files: "2026-09-20/facts.json",
    }),
    others: copy("另有 {count} 个文件只进归档，例如 {files}。", {
      count: 45,
      files: "probe-zoom.mjs",
    }),
    fix: copy("转成当前格式，导入成第 1 版的阶段和页面。只有网页的存成快照。"),
    fixBlobs: copy("截图和事实文件进附件库，挂在对应的阶段上。"),
    problems: copy("{count} 页转换以后还有要改的地方：{pages}。", {
      count: 2,
      pages: "think-2 要改 3 个地方、report-2 要改 1 个地方",
    }),
    pageProblems: copy("{page} 要改 {count} 个地方", { page: "think-2", count: 3 }),
    failed: copy("{page} 转不了：{message}", {
      page: "2026-09-20/report-3.json",
      message: "旧页面数据没有写 stage，看不出它的阶段名。",
    }),
    syntax: copy("{page} 不是合法的 JSON，在第 {line} 行第 {column} 列。", {
      page: "2026-09-20/report-3.json",
      line: 3,
      column: 7,
    }),
    syntaxNoAt: copy("{page} 不是合法的 JSON。", { page: "2026-09-20/report-3.json" }),
    missingImages: copy("{count} 张引用的截图找不到：{files}。", {
      count: 1,
      files: "2026-09-21/report-img/f1-path.jpg",
    }),
    htmlUnknown: copy("{files} 只有网页，看不出阶段名，确认它们各是哪个阶段名。", {
      files: "2026-09-18/report.html",
    }),
    mixed: copy("{rounds} 里几页的阶段名不一样，确认这个阶段的阶段名。", {
      rounds: "2026-09-20/land-15",
    }),
  },
  landRecords: {
    none: copy("没有 land/。"),
    summary: copy("land/ 下有 {count} 个阶段的记录：{names}。", {
      count: 5,
      names: "13、14、15、16、17",
    }),
    record: copy("land/{name}：{text}", { name: "1", text: "没有评审的记录。" }),
    planMissing: copy("没有计划.md。"),
    tidyMissing: copy("没有重构的记录。"),
    changesMissing: copy("没有功能改动的记录。"),
    redOnly: copy("「{names}」只有失败，没有通过。", { names: "docs-check-size" }),
    greenOnly: copy("「{names}」没有先失败的记录。", { names: "gif-caption" }),
    reviewMissing: copy("没有评审的记录。"),
    badFile: copy("{file} 不是合法的 JSON，或者格式不对。", { file: "评审.json" }),
    extra: copy("land/{name} 另有 {files}，随记录进归档。", {
      name: "1",
      files: "对照.html、对照图/",
    }),
    fix: copy("原样进归档包。第一期不导入成落地记录，第二期再补。"),
    unmatched: copy("land/{name} 没有对应的页面。", { name: "6" }),
  },
  useCode: {
    found: copy("使用代码在 {dir}，有 {count} 个文件。", { dir: "scripts/use/", count: 12 }),
    coverage: copy("覆盖表在 {file}。", { file: "scripts/use/覆盖表.md" }),
    noCoverage: copy("没有找到覆盖表。"),
    none: copy("没有找到使用代码。"),
  },
  skillVersion: {
    legacy: copy("项目停在旧 skill，没有记版本号。"),
    old: copy("project.json 记着 skill {version}，比这一版的 {current} 旧。", {
      version: "1.4.0",
      current: "0.0.1",
    }),
    current: copy("project.json 记着 skill {version}。", { version: "0.0.1" }),
    unreadable: copy("project.json 写坏了，看不出停在哪一版。"),
    fix: copy("迁移完成后写入 {current}。", { current: "0.0.1" }),
  },
  cache: {
    notMigrated: copy("迁移完成以后才查。"),
    migrate: copy("migrate/ 里有上一次迁移检查写的内容。"),
    same: copy("主线.md 和基准版本一致。"),
    changed: copy("主线.md 改过，还没有交给后端。"),
    changedFix: copy("下一条命令开始时，按「03 数据模型」第五节交给后端。"),
    noBase: copy("project.json 没有主线的基准版本，主线还没交过。"),
    missing: copy("项目缓存里没有主线.md。"),
    remote: copy("有主线.远端.md，上次同步的冲突还没合并。合并进主线.md 以后删掉它。"),
    rounds: copy("rounds/ 下有 {count} 个阶段的工作区。", { count: 2 }),
    useRuns: copy("use/ 下有 {count} 份运行的输出。", { count: 3 }),
  },
  help: {
    description: copy("迁移检查（2026-12-31 删除）"),
    details: {
      what: copy("查旧 skill 留下的文件，写迁移对照。"),
      registry: copy("也核对项目缓存和集中存储里的登记。"),
      fix: copy("确认完以后，用 --fix 执行迁移。"),
      done: copy("迁完可以不再使用。"),
    },
    fix: copy("没有要确认的地方时执行迁移：归档、导入、核对、写项目缓存、清理旧文件"),
    from: copy("旧文件在项目根以外时，指明旧文件夹"),
    verbose: copy("没有要迁移的地方时也把每个检查项列出来，默认只写一行"),
    repo: copy("仓库是自己的还是共用的，看不出时要问用户"),
    reads: copy("旧文件、migrate/、迁移状态"),
    writes: copy("迁移检查写 migrate/；--fix 写集中存储、项目缓存、忽略规则，并删旧文件"),
    examples: {
      plain: copy("ploop doctor"),
      from: copy("ploop doctor --from ~/Documents/产品循环/旧文件夹"),
      fix: copy("ploop doctor --fix"),
    },
    after: copy("核对「确认」开头的行，改好 migrate/ 里的文件，重跑 ploop doctor"),
  },
  /** 迁移对照：迁移检查写进 .product-loop/migrate/ 的文件，和按它们列出的要确认的地方。 */
  migrate: {
    written: copy("写好了迁移对照：{files}", { files: "队列迁移对照.md、pages/ 下 57 份" }),
    pagesWritten: copy("pages/ 下 {count} 份", { count: 57 }),
    dir: copy("迁移对照在 {dir}，改好以后重跑 ploop doctor。", {
      dir: ".product-loop/migrate/",
    }),
    queueIntro: copy(
      "每一行是一件旧的队列事项。核对新状态和各格，查过提交记录的在确认一格写「是」。新状态只写待办、等待、已完成、已取消。",
    ),
    decisionsIntro: copy(
      "每一行是一条旧决定。补齐日期和被哪一条推翻，核对完在确认一格写「是」。以后再说的一行不用案例。",
    ),
    skippedHead: copy("没有读的行"),
    skippedIntro: copy(
      "下面几行没有导入。要导入的抄进上面的表，不导入的写明去处。处理完把 [ ] 改成 [x]。",
    ),
    skippedLine: copy("第 {line} 行：{text}", { line: 12, text: "列数和哪张表都对不上。" }),
    acksIntro: copy("迁移检查列出的别的要确认的地方。看过、处理完以后把 [ ] 改成 [x]。"),
    reportHead: copy("{file} 仍被拦截的地方", { file: "2026-09-20_think-27.json" }),
    reportLine: copy("{where}：{message}", {
      where: "sections.asks[0]",
      message: "疑问卡没有写来源。",
    }),
    queue: {
      noTable: copy("{file} 里找不到对照表，表头要和迁移检查写的相同。", {
        file: "队列迁移对照.md",
      }),
      unconfirmed: copy("{ids} 还没确认，核对以后在确认一格写「是」。", { ids: "Q1、Q2" }),
      row: copy("{id}：{text}", { id: "Q3", text: "新状态写的是「做完了」。" }),
      proposerInvalid: copy("提出写的是「{text}」，要写用户、AI、评审或别的项目。", {
        text: "我",
      }),
      missing: copy("对照表里少了 {ids}，旧文件里有。", { ids: "Q7" }),
      extra: copy("对照表里多了 {ids}，旧文件里没有。", { ids: "Q90" }),
      duplicate: copy("{ids} 在对照表里写了几行。", { ids: "Q7" }),
    },
    decisions: {
      noTable: copy("{file} 里找不到对照表，表头要和迁移检查写的相同。", {
        file: "决定迁移对照.md",
      }),
      unconfirmed: copy("第 {ids} 条决定还没确认，核对以后在确认一格写「是」。", {
        ids: "8、9",
      }),
      row: copy("第 {id} 条：{text}", { id: 8, text: "没有日期，迁移时缺日期。" }),
      idInvalid: copy("编号写的是「{text}」，要写数字。", { text: "八" }),
      kindInvalid: copy("种类写的是「{text}」，要写决定或以后再说。", { text: "请求" }),
      statusInvalid: copy("状态写的是「{text}」，要写有效或已作废。", { text: "作废" }),
      voidedByInvalid: copy("被哪一条推翻写的是「{text}」，要写一个编号。", { text: "3、4" }),
      duplicate: copy("第 {ids} 条在对照表里写了几行。", { ids: "8" }),
      skipped: copy("{file} 里还有 {count} 行没有读的旧行没勾上。", {
        file: "决定迁移对照.md",
        count: 2,
      }),
    },
    pages: {
      syntax: copy("{file} 不是合法的 JSON，在第 {line} 行第 {column} 列。", {
        file: "pages/2026-09-20_think-27.json",
        line: 3,
        column: 7,
      }),
      syntaxNoAt: copy("{file} 不是合法的 JSON。", { file: "pages/2026-09-20_think-27.json" }),
      shape: copy("{file} 缺了「{field}」，或者写法不对。", {
        file: "pages/2026-09-20_think-27.json",
        field: "阶段名",
      }),
      noData: copy("{file} 还没有转好的页面数据：{reason}", {
        file: "pages/2026-09-20_report-3.json",
        reason: "旧页面数据没有写 stage。",
      }),
      blocked: copy("{file} 仍被拦截 {count} 处，报错写在 {report}。", {
        file: "pages/2026-09-20_think-27.json",
        count: 2,
        report: "pages/2026-09-20_think-27.报错.md",
      }),
      images: copy("{file} 引用的截图找不到：{images}。", {
        file: "pages/2026-09-21_report-11.json",
        images: "report-img/f1.png",
      }),
      mixed: copy(
        "{round} 这个阶段的几页阶段名不同，改成同一个阶段名，或者改「归到的阶段」分开。",
        {
          round: "2026-09-20/land-15",
        },
      ),
      missing: copy("迁移对照里少了 {files}，旧文件里有。", {
        files: "pages/2026-09-20_think-27.json",
      }),
    },
    acks: copy("{file} 里还有 {count} 处没勾上。", { file: "其他确认.md", count: 2 }),
    noImageRound: copy("walk/ 下有 {count} 张截图，但没有阶段可挂。", { count: 3 }),
  },
  /** ploop doctor --fix 的输出和报错。 */
  run: {
    title: copy("迁移完成：项目 {project}", { project: "app" }),
    archived: copy("归档：{count} 个文件，存成集中存储里的 {file}", {
      count: 312,
      file: "app-20260928T010203Z.tar.gz",
    }),
    imported: copy("导入并核对：{rounds} 个阶段、{pages} 页、{decisions} 条决定", {
      rounds: 56,
      pages: 58,
      decisions: 87,
    }),
    importedMore: copy("还有 {queue} 件队列事项、{images} 张截图", { queue: 84, images: 294 }),
    versions: copy("第 {ended} 版结束，第 {started} 版开始。", { ended: 1, started: 2 }),
    cache: copy("项目缓存：{dir}", { dir: ".product-loop/" }),
    ignore: copy("忽略规则写进了 {file}", { file: ".gitignore" }),
    ignoreKept: copy("忽略规则已经在 {file} 里了", { file: ".gitignore" }),
    cleaned: copy("清理：删了 {count} 个旧文件和 migrate/。", { count: 310 }),
    kept: copy("保留了 {files}，新的项目缓存要用。", { files: "主线.md、决定.md" }),
    gitRemoved: copy("已提交进 git 的 {count} 个旧文件用 git 删了，单独提交了一次。", {
      count: 3,
    }),
    commit: copy(
      "chore: 产品循环的旧文件搬到集中存储\n\n只删 ploop doctor --fix 迁移过的旧文件。\n原样的文件在集中存储的归档包里。",
    ),
    next: copy("ploop status"),
    errors: {
      confirmFirst: {
        message: copy("还有 {count} 个检查项要确认，--fix 没有执行。", { count: 2 }),
        hint: copy("先按「确认」开头的行改好 migrate/ 里的文件，再重跑 ploop doctor。"),
      },
      noSource: {
        message: copy("没有找到要迁移的旧文件。"),
        hint: copy("旧文件在项目根以外时，用 --from 指明旧文件夹。"),
      },
      noMigrate: {
        message: copy("还没有迁移对照，--fix 没有执行。"),
        hint: copy("先运行 ploop doctor，确认完再运行 ploop doctor --fix。"),
      },
      git: {
        message: copy("用 git 删除旧文件没有成功。"),
        hint: copy("迁移已经完成。手动用 git 删掉这几个文件，单独提交一次。"),
      },
      gitUncommitted: {
        message: copy("旧文件已从 git 删除，还没有提交。"),
        hint: copy("迁移已经完成。在那个仓库里单独提交一次。"),
      },
      file: {
        message: copy("读不了旧文件 {file}：{reason}", {
          file: "walk/a.png",
          reason: "没有读它的权限",
        }),
        hint: copy("改好权限以后重跑 ploop doctor --fix。"),
      },
    },
  },
};
