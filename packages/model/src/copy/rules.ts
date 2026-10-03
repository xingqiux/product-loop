import type { RuleContextName, RuleSubject } from "../rules/rule.ts";
import { type CopyEntry, copy } from "./define.ts";

// 规则框架的文案，见「07 校验」第三节和第八节。每条规则的报错放在各自领域的文案里，这里放三样：
// - about：每条规则查什么、依据是什么。键和规则的编号相同，维护说明的规则表由它生成。
//   依据写这条规则来自哪一条决定、哪一次事故，或者设计文档的哪一节。
// - 规则查的数据、要的上下文的中文名。
// - 起始日期写 0.0.1 时的说法。

/** 一条规则查什么、依据是什么。 */
type About = { readonly summary: CopyEntry; readonly basis: CopyEntry };

const writingBasis = copy("决定 119 到 122 的写作规范，照旧 writing.py");
const wordingBasis = copy("旧 build-report.py 的措辞提醒，「07 校验」第四节");
const replyBasis = copy("旧 check-reply.py 的回复自查");
const onlyBasis = copy("决定 70，照旧 build-report.py");
const optionBasis = copy("决定 11，照旧 build-report.py");
const planBasis = copy("照旧 land.py 的 check_plan");
const reviewBasis = copy("照旧 land.py 的 check_review");

export const rulesCopy = {
  about: {
    writing: {
      term: {
        banned: {
          summary: copy("引号外面不写术语表停用的说法"),
          basis: copy("决定 121，照旧 writing.py 的停用说法"),
        },
        quoted: {
          summary: copy("停用的说法只出现在引号里时只警告，可能是照录的原话"),
          basis: copy("「07 校验」第五节的有意改动 1"),
        },
        soft: {
          summary: copy("语境相关的旧说法，指术语表里的意思时改用统一的术语"),
          basis: copy("照旧 writing.py。「露出来」按「07 校验」第五节第 3 条改成警告"),
        },
      },
      sentence: {
        tooLong: { summary: copy("一句不超过六十字"), basis: writingBasis },
        long: { summary: copy("一句超过四十字时考虑拆开"), basis: writingBasis },
        semicolons: { summary: copy("一句里不用两个以上的分号"), basis: writingBasis },
      },
      paren: {
        list: { summary: copy("括号里不嵌超过三十字的清单"), basis: writingBasis },
        items: {
          summary: copy("括号里有三项以上的短并列时考虑改成列表"),
          basis: copy("落地阶段第 14 次的评审意见，短的并列改成只警告"),
        },
      },
      demonstrative: {
        dense: { summary: copy("指示词不能太密，写出事物的名称"), basis: writingBasis },
      },
      wording: {
        redBlue: { summary: copy("不写红方、蓝方，候选就叫候选"), basis: wordingBasis },
        interpunct: { summary: copy("不用间隔号"), basis: wordingBasis },
        spoken: { summary: copy("用书面语，不用口头说法"), basis: wordingBasis },
        numberRef: { summary: copy("不拿编号指代东西"), basis: wordingBasis },
        statistics: { summary: copy("不对用户报统计数字"), basis: wordingBasis },
      },
      reply: {
        firstLine: { summary: copy("会话回复的首行写当前阶段和一句原因"), basis: replyBasis },
        fileName: { summary: copy("会话回复里不写文件名"), basis: replyBasis },
        interpunct: { summary: copy("会话回复里不用间隔号"), basis: replyBasis },
        linkLast: { summary: copy("会话回复里的链接放在最后"), basis: replyBasis },
        round: {
          summary: copy("会话回复的首行以项目当前的阶段开头"),
          basis: copy("「04 命令行」第九节 check-reply.py 一行：首行要以当前的阶段开头"),
        },
      },
    },
    decision: {
      fields: {
        summary: copy("新增和修改决定时，决定、原因、案例三项都要写"),
        basis: copy("「07 校验」第四节，「04 命令行」第十节的决定一行四格"),
      },
      decision: {
        tooLong: {
          summary: copy("「决定」一项不超过 40 个字，细节写进原因"),
          basis: copy("决定 224 和决定 226：决定整句显示，写成名字，细节移进原因"),
        },
      },
    },
    diagram: {
      edge: {
        relation: {
          summary: copy("架构图的每条线写明是什么关系"),
          basis: copy("决定 113 的「内容配什么形式」，照旧 build-report.py 的 check_diagrams"),
        },
      },
    },
    align: {
      usedIn: {
        matched: {
          summary: copy("先对齐每一项的 usedIn 写本页疑问卡的标题"),
          basis: copy("决定 114 的对齐小卡，照旧 build-report.py 的 check_align"),
        },
      },
      name: {
        unique: {
          summary: copy("先对齐里一个术语只写一项"),
          basis: copy("决定 114，名称全篇只用一个叫法。照旧 build-report.py 的 check_align"),
        },
      },
      unclear: {
        reworded: {
          summary: copy("上一份回复点了不明白的术语，这一页的先对齐里意思和例子都没变时警告"),
          basis: copy("「07 校验」第四节的 check_align，「04 命令行」第十节的下一个阶段换讲法"),
        },
      },
    },
    card: {
      source: {
        visual: {
          summary: copy("卡片的每条来源写成截图、文字或用户的原话"),
          basis: copy("决定 59 的来源要有图，按「07 校验」第二节改成三种写法"),
        },
      },
      only: {
        one: { summary: copy("写了 only 的卡只放一个选项"), basis: onlyBasis },
        dropped: { summary: copy("写了 only 的卡要列出排除掉的方向"), basis: onlyBasis },
        needed: { summary: copy("只有一个选项的卡要写 only，不凑第二个选项"), basis: onlyBasis },
      },
      shared: {
        required: {
          summary: copy("两个以上选项的卡要写 shared，共同的部分只写一遍"),
          basis: copy("选项卡的新版式，照旧 build-report.py"),
        },
      },
      row: {
        width: {
          summary: copy("对照表的行名不超过八个字，按显示宽度算"),
          basis: copy("决定 125，照旧 build-report.py"),
        },
      },
      title: {
        name: {
          summary: copy("卡片、选项、更改和图表的标题写成名字：不超过 16 个字，不带「，。；：」"),
          basis: copy("决定 212，界面不解释自己：标题是名字，解释放进正文"),
        },
      },
      cell: {
        length: {
          summary: copy("选项的差别一格不超过六十字"),
          basis: copy("决定 109 的一格最多两行，照旧 build-report.py"),
        },
      },
      option: {
        why: {
          summary: copy("选项要写理由，发现和提升的最后一个「不改」除外"),
          basis: optionBasis,
        },
        cost: {
          summary: copy("选项要写代价，发现和提升的最后一个「不改」除外"),
          basis: optionBasis,
        },
        when: {
          summary: copy("选项要写适用场景，only 的卡和发现、提升的最后一个「不改」除外"),
          basis: copy("决定 71，照旧 build-report.py"),
        },
      },
      options: {
        balance: {
          summary: copy("几个选项长短相差太多时提醒，最长的超过最短的 2.2 倍"),
          basis: copy("决定 71，照旧 build-report.py 的提醒"),
        },
      },
      stance: {
        pick: {
          summary: copy("看法选的是卡上有的选项"),
          basis: copy("决定 109，看法标在所选选项的列头上"),
        },
      },
    },
    scenes: {
      name: {
        number: {
          summary: copy("场景清单的名字里不写编号，编号写进 scene"),
          basis: copy("「07 校验」第四节的场景要带编号，标题的写法见「09 skill 与软件」第三节"),
        },
      },
      pasted: {
        summary: copy("卡片的文字里不整段写场景清单"),
        basis: copy("决定 69，照旧 build-report.py 的 check_scene_text"),
      },
    },
    spec: {
      for: {
        summary: copy("设计规范的每一格写 for，写明用在哪个组件上"),
        basis: copy("决定 96，「07 校验」第四节改为必填"),
      },
      text: {
        lines: {
          summary: copy("设计规范里文字的一格不超过三行"),
          basis: copy("决定 96，照旧 build-report.py 的 check_spec"),
        },
      },
      pasted: {
        summary: copy("卡片的文字里不整段写设计规范"),
        basis: copy("「07 校验」第四节新增，和 scenes.pasted 同类"),
      },
    },
    design: {
      outside: {
        summary: copy("构思里设计类的卡，来源里至少有一张外面的截图"),
        basis: copy(
          "决定 77 的先看再画，照旧 build-report.py 的 check_design，「07 校验」第四节改为只在构思查",
        ),
      },
      sketch: {
        summary: copy("构思里设计类的卡，每个选项都画出草稿"),
        basis: copy(
          "决定 77 的先看再画，照旧 build-report.py 的 check_design，「07 校验」第四节改为只在构思查",
        ),
      },
      spec: {
        summary: copy("构思里有设计类的卡时，同一页要有设计规范"),
        basis: copy("决定 98，照旧 build-report.py 的 check_spec"),
      },
    },
    research: {
      tier: {
        summary: copy("构思里带着外面来源的疑问卡，要写调研是哪一档"),
        basis: copy("决定 92 的调研分三档，照旧 build-report.py 的 check_research"),
      },
      reason: {
        summary: copy("调研写了不查时，要写不查的理由"),
        basis: copy("决定 92 的不查要写明理由，照旧 build-report.py 的 check_research"),
      },
      approved: {
        summary: copy("调研写了深查时，要写计划是哪个阶段批的"),
        basis: copy("决定 92 的深查先给用户批计划，照旧 build-report.py 的 check_research"),
      },
    },
    screens: {
      present: {
        summary: copy("检查阶段的页面要有元素清单"),
        basis: copy("决定 44，照旧 build-report.py 的 check_screens"),
      },
      where: {
        summary: copy("元素清单的每一屏写 where，指到场景编号和步号"),
        basis: copy("约定 0001 第 8 条，「07 校验」第四节的元素清单要盖住变过的屏"),
      },
      coverChanged: {
        summary: copy("检查阶段的元素清单盖住这一版新出现和变过的每一屏"),
        basis: copy("「07 校验」第四节的 screens.cover-changed，改自 check_screens"),
      },
    },
    round: {
      batch: {
        covered: {
          summary: copy("这个阶段拿出来、还在进行中的事，每一件都出现在某张卡上"),
          basis: copy("「07 校验」第四节，照旧 build-report.py 的 check_queue_file"),
        },
      },
      take: {
        stage: {
          summary: copy("落地阶段这一批只拿落地的事"),
          basis: copy("「08 版本与迁移」第二节的落地阶段是一批"),
        },
      },
      close: {
        result: {
          summary: copy("收尾时，拿出的每件事都有结果，而且只有一个结果"),
          basis: copy("「00 总览」第一节的收尾，「03 数据模型」第二节的拿出的事"),
        },
      },
    },
    page: {
      oneWaiting: {
        summary: copy("同一项目同一时间只有一页在等用户点，只看的页不算"),
        basis: copy("「07 校验」第四节的 page.one-waiting，「04 命令行」第十节的一次只跑一个阶段"),
      },
      cards: {
        none: {
          summary: copy("要用户点的页至少有一张卡，只看的页可以没有"),
          basis: copy("第二次检查的决定 225：空页让 AI 白等回复"),
        },
      },
    },
    blob: {
      present: {
        summary: copy("页面引用的每张截图都已上传到附件库"),
        basis: copy("「07 校验」第四节的新规则，「05 接口」第七节的先上传后引用"),
      },
    },
    queue: {
      status: {
        graph: {
          summary: copy("队列事项的状态只能按状态图变化"),
          basis: copy("「03 数据模型」第二节的状态图，照旧 queue.py"),
        },
      },
      drop: {
        reason: {
          summary: copy("取消队列事项要写原因"),
          basis: copy("「07 校验」第四节，照旧 queue.py 的不做了"),
        },
      },
      content: {
        semicolons: {
          summary: copy("并列的几件事写进子项，不用分号挤进内容"),
          basis: copy("照旧 queue.py 的查法"),
        },
        duplicate: {
          summary: copy("还没做完的事里不放内容相同的第二件"),
          basis: copy("照旧 queue.py 的查法，做完或取消的事可以重新放进一件"),
        },
        tooLong: {
          summary: copy("内容不超过 40 个字，细节写进备注"),
          basis: copy("决定 224 和决定 226：内容整句显示，写成名字，细节移进备注"),
        },
      },
    },
    reply: {
      line: {
        handled: {
          summary: copy("给出信息和开始阶段以前，每一行回复都有了去处"),
          basis: copy("「07 校验」第四节，「03 数据模型」第二节的去处"),
        },
      },
      images: {
        read: {
          summary: copy("处理带图的行时，要确认已经读过这一行的图"),
          basis: copy("「07 校验」第四节，「04 命令行」第十节的带图的回复先读图"),
        },
      },
      mainline: {
        newer: {
          summary: copy("去处是主线时，主线要有给出那一页以后交的新修订"),
          basis: copy("「04 命令行」第十节的用户改主意就改主线"),
        },
      },
    },
    land: {
      plan: {
        sections: {
          summary: copy("计划的七节都在，每节有正文；小改动可以只写三节，改动超过评审界线时要补全"),
          basis: planBasis,
        },
        tidy: { summary: copy("「要不要先重构」写要或不要，写不要时带理由"), basis: planBasis },
      },
      order: {
        summary: copy("落地的几步按顺序记，上一步没有记录时拦截"),
        basis: copy("照旧 land.py 的五步顺序"),
      },
      tidy: {
        skip: {
          summary: copy("计划写了要重构时，不能跳过重构"),
          basis: copy("照旧 land.py 的 tidy --skip"),
        },
        passed: {
          summary: copy("重构以后检查命令要通过"),
          basis: copy("照旧 land.py，重构不该改变任何行为"),
        },
        committed: {
          summary: copy("重构单独提交，检查时的提交不是这个阶段开始时的提交"),
          basis: copy("照旧 land.py 的重构要单独提交"),
        },
      },
      change: {
        planned: {
          summary: copy("检查命令原样写在计划里，改动对应的队列事项在这一批里"),
          basis: copy("决定 118，「07 校验」第四节"),
        },
        rejected: {
          summary: copy("用户对某条更改点了不认可，对应的事不能记成做完"),
          basis: copy("落地的收尾一节，决定 136"),
        },
      },
      red: {
        failed: {
          summary: copy("改之前的检查要失败，命令要真的跑起来"),
          basis: copy("照旧 land.py 的先失败"),
        },
      },
      green: {
        sameCommand: {
          summary: copy("通过时用的是失败时的那条命令"),
          basis: copy("照旧 land.py，「07 校验」第六节"),
        },
        passed: { summary: copy("改之后的检查要通过"), basis: copy("照旧 land.py 的后通过") },
        later: {
          summary: copy("通过时的提交在失败时的提交之后"),
          basis: copy("「07 校验」第六节加的一条"),
        },
      },
      commit: {
        recorded: {
          summary: copy("重构、失败和通过的运行都记下当时的提交"),
          basis: copy("「04 命令行」第十一节，检查命令的提交由命令行交来"),
        },
        clean: {
          summary: copy("收尾落地阶段时工作区没有未提交的改动，退回的事写明退回哪个阶段"),
          basis: copy("「07 校验」第四节，「04 命令行」第三节的落地阶段收尾"),
        },
      },
      page: {
        shown: {
          summary: copy("收尾落地阶段以前，这个阶段至少给用户看过一页带更改的页"),
          basis: copy("决定 206，空页不算"),
        },
      },
      steps: {
        summary: copy("给出验收页和收尾落地阶段时，计划、重构、先失败后通过和评审都有记录"),
        basis: copy("照旧 build-report.py 的 check_land，「07 校验」第四节"),
      },
      oneCommit: {
        summary: copy("失败和通过之间多于一个提交时警告"),
        basis: copy("「07 校验」第四节的 land.one-commit，「04 命令行」第十节的一次提交一件"),
      },
      review: {
        located: { summary: copy("评审的每条意见指到文件和行"), basis: reviewBasis },
        disposed: { summary: copy("阻塞的意见写了处置"), basis: reviewBasis },
        required: {
          summary: copy("改动超过评审界线时，不能跳过评审"),
          basis: copy("决定 173，「07 校验」第六节"),
        },
      },
    },
    use: {
      shots: {
        present: {
          summary: copy("使用记录引用的截图都已上传到附件库"),
          basis: copy("「05 接口」第七节的先上传后引用，和 blob.present 同理"),
        },
      },
      scene: {
        known: {
          summary: copy("使用记录的场景编号和步号在最新的主线里"),
          basis: copy("「03 数据模型」第二节，一屏以场景和步号确定"),
        },
      },
      leave: {
        summary: copy("收尾使用阶段时，最近一次运行没有断点，主线的每一步都走到，覆盖表没有缺口"),
        basis: copy("「07 校验」第四节，「04 命令行」第十节的使用离开条件"),
      },
    },
    think: {
      leave: {
        summary: copy("收尾构思阶段时，主线十个部分至少写好一半，缺得太多不能收尾"),
        basis: copy("「构思的做法」第四节的离开条件第一条，命令只查这一条里能数出来的部分"),
      },
    },
    mainline: {
      spec: {
        twelve: {
          summary: copy("进入检查时，主线的设计规范十二个部分都要有"),
          basis: copy(
            "照旧 build-report.py 的 check_mainline，「07 校验」第四节改为只在进入检查时查",
          ),
        },
      },
      ten: {
        summary: copy("开始阶段时，主线的十个部分有缺的就警告"),
        basis: copy("「07 校验」第四节，「04 命令行」第十节的构思的离开条件"),
      },
    },
  } satisfies Record<string, Record<string, Record<string, About> | About>>,
  /** 规则查的数据。 */
  subject: {
    text: copy("文字"),
    reply: copy("会话回复"),
    decision: copy("新增和修改的决定"),
    page: copy("页面数据"),
    queue: copy("队列事项"),
    round: copy("阶段"),
    mainline: copy("主线"),
    replyLine: copy("回复的各行"),
    land: copy("落地记录"),
    use: copy("使用记录"),
  } satisfies Record<RuleSubject, CopyEntry>,
  /** 规则要的上下文。 */
  context: {
    writingSpec: copy("主线的写作规范"),
    batch: copy("这个阶段拿出来的事"),
    waitingPages: copy("在等用户点的页"),
    images: copy("截图的哈希和附件库"),
    unhandledReplies: copy("还有行没处理的回复"),
    unclearTerms: copy("上一份回复点了不明白的术语"),
    changedScreens: copy("这一版新出现和变过的屏"),
  } satisfies Record<RuleContextName, CopyEntry>,
  /** 起始日期写 0.0.1 的规则，起始这样写。 */
  sinceRelease: copy("0.0.1 发布那天"),
};
