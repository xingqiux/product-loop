# 旧 skill 的反例样本转换以后

由 convert-samples.test.ts 生成。
「旧判定」是旧构建校验的判定，「转换以后」是转换以后还要改的地方。

114 份样本都能转换，其中 75 份转换以后没有要改的地方。

| 编号 | 说明 | 旧判定 | 阶段 | 备注 | 转换以后 |
| --- | --- | --- | --- | --- | --- |
| legacy-001 | 疑问的选项缺代价 | 拦截 | check | header×3 emptyValues×8 whereScene whereText×2 | 通过 |
| legacy-002 | 发现的选项缺代价 | 拦截 | check | header×3 emptyValues×8 whereScene whereText×2 | 通过 |
| legacy-003 | 疑问没写来源 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.missing asks[0].sources |
| legacy-004 | 来源只写了一段话，没有一条一条地写（检查第 1 轮真实发生的） | 拦截 | check | header×3 emptyValues×7 sawSource whereScene whereText×2 | 通过 |
| legacy-005 | 来源有一条没有配图 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-006 | 来源是原话，却没有写出原话 | 拦截 | check | header×3 emptyValues×8 whereScene whereText×2 | page.source.quoteWithoutSaw asks[0].sources[1].saw |
| legacy-007 | 发现没写问题出现的位置 | 拦截 | check | header×3 emptyValues×7 | page.field.missing findings[0].where |
| legacy-008 | 问题出现的位置只写编号没写名字 | 拦截 | check | header×3 emptyValues×7 whereScene | legacyPage.where.sceneNumber findings[0].where.scene |
| legacy-009 | 右边放了文字摘录 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 excerptEvidence | 通过 |
| legacy-010 | 证据的种类写错 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.value findings[0].evidence[0].type |
| legacy-011 | 文字的更改只给了改前，没给改后 | 拦截 | check | header×3 emptyValues×6 whereScene whereText×2 | page.stage.changes changes |
| legacy-012 | 更改既没有截图也没有原文 | 拦截 | check | header×3 emptyValues×6 whereScene whereText×2 | page.stage.changes changes |
| legacy-013 | 页面数据里手抄了队列（决定 130：改由构建校验从队列数据直接摆出来） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 queueBoard | 通过 |
| legacy-014 | 队列数据里一件事的阶段不是五个之一 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-015 | 队列数据里一件事的状态不在定好的取值里 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-016 | 队列数据里一件事缺验收标准这一格 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-017 | 队列数据不是一份完整的数据 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-018 | 项目里只有旧格式的队列文件 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-019 | 这一页写的 queueRow 同时对上两件（评审指出的：规则会被绕过） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 queueRow | legacyPage.queueRow.ambiguous findings[0].queue |
| legacy-020 | 这一页写的 queueRow 不到六个字，谁也没提醒 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 queueRow | legacyPage.queueRow.unknown findings[0].queue |
| legacy-021 | 队列数据里一件事的内容用了停用的说法（评审指出的：不该因此整页生成不出来） | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-022 | 阶段还写成旧的叫法「修复」（决定 116：数据里改成落地，不留对照） | 拦截 | land | header×3 emptyValues×7 sectionAsk whereScene whereText×2 | page.stage.screens screens |
| legacy-023 | 队列数据里几件并列的事用分号挤进内容（修复第 10 轮真实留下的） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-024 | 合格的数据，队列数据里并列的几件写成了子项 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-025 | 我的看法写成一句话（个人网站那一轮真实留下的） | 拦截 | check | header×3 emptyValues×7 stanceText whereScene whereText×2 | 通过 |
| legacy-026 | 检查阶段没有元素清单 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-027 | 元素清单有一行没写它替用户回答什么 | 拦截 | check | header×3 emptyValues×8 whereScene whereText×2 | page.field.missing screens[0].elements[1].answers |
| legacy-028 | 选项标题写了「红方」（个人网站那一轮真实留下的） | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-029 | 用了间隔号 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-030 | 用了口头说法 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-031 | 拿编号指代东西 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-032 | 写了统计数字 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-033 | 队列数据里批准了还没做的事属于当前阶段，页面里没有拿出来（atlas design 真实发生的） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-034 | 队列数据里那一件只把状态改成了进行中，页面里没有拿 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-035 | 项目里没有队列数据 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-036 | 页面写的是从队列哪一行拿的，队列数据里对不上 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 queueRow | legacyPage.queueRow.unknown findings[0].queue |
| legacy-037 | 合格的数据，队列数据里那一件拿进了一条发现 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 queueRow | 通过 |
| legacy-038 | 合格的数据，队列数据里属于当前阶段的事在等别的事 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-039 | 合格的数据，队列数据里等着的事属于别的阶段 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-040 | 合格的数据，队列数据里那一件已经不做了 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-041 | 场景清单出现在构思以外的阶段 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.scenes scenes |
| legacy-042 | 场景有一步没写该看到什么 | 拦截 | think | header×3 emptyValues×9 sectionAsk whereScene whereText×2 | page.field.missing scenes[0].steps[0].expect |
| legacy-043 | 场景清单的草稿整段写进了疑问卡（真实项目里发生的） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-044 | 合格的数据，构思阶段带场景清单 | 通过 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-045 | 设计规范的样张墙出现在构思以外的阶段 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.spec spec |
| legacy-046 | 样张墙有一格颜色只写了名字没有色值 | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | page.field.missing spec[0].values[0].hex |
| legacy-047 | 样张墙有一格是空的，没有东西给人看 | 拦截 | think | header×3 emptyValues×8 sectionAsk whereScene whereText×2 queueBoard | page.field.missing spec[0].values |
| legacy-048 | 合格的数据，构思阶段带样张墙 | 通过 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-049 | 规范的一格是一个标题加一段超过三行的字（构思第 19 轮真实留下的） | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-050 | 规范的表有一行的格数和列对不上 | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | page.spec.rowCells spec[0].rows[0] |
| legacy-051 | 合格的数据，规范的一格是一张表 | 通过 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-052 | 构思阶段有设计类的卡，同一页没有带上用到的规范（构思第 20 轮用户选的） | 拦截 | think | header×3 sectionAsk whereScene whereText×2 emptyValues×5 queueBoard | 通过 |
| legacy-053 | 合格的数据，构思阶段设计类的卡和用到的规范在同一页 | 通过 | think | header×3 sectionAsk whereScene whereText×2 emptyValues×5 queueBoard | 通过 |
| legacy-054 | 设计类的卡，来源里没有外面的东西（用户指出的：候选都是 AI 脑子里来的） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-055 | 设计类的卡，有一个选项没有草稿 | 拦截 | check | header×3 emptyValues×6 whereScene whereText×2 | 通过 |
| legacy-056 | 合格的数据，设计类的卡先看再画 | 通过 | check | header×3 whereScene whereText×2 emptyValues×5 | 通过 |
| legacy-057 | 落地的页没有带我自己挑的刺（用户指出的：所有东西都是我反馈出来的） | 警告 | land | header×3 emptyValues×4 land queueBoard | page.field.missing changes[0].problem<br>page.field.missing changes[0].fix |
| legacy-058 | 合格的数据，落地的页写明了看过确实没有 | 通过 | land | header×3 emptyValues×4 land queueBoard noLift | page.field.missing changes[0].problem<br>page.field.missing changes[0].fix |
| legacy-059 | 落地的页有更改，没有写落地的记录在哪里（决定 105：代码里面也要有人看） | 拦截 | land | header×3 emptyValues×4 queueBoard noLift | page.field.missing changes[0].problem<br>page.field.missing changes[0].fix |
| legacy-060 | 落地的页有更改，落地的记录那个文件夹不存在 | 拦截 | land | header×3 emptyValues×4 land queueBoard noLift | page.field.missing changes[0].problem<br>page.field.missing changes[0].fix |
| legacy-061 | 检查阶段，主线的设计规范缺了两样（决定 112：十二样齐不齐由脚本查） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-062 | 检查以外的阶段，主线的设计规范缺了两样 | 警告 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-063 | 合格的数据，检查阶段，主线的设计规范十二样都有 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-064 | 卡上有外面看来的参考，没写调研是哪一档（决定 92） | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-065 | 调研写了深查，没写计划是哪一轮批的 | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-066 | 调研写了不查，没写理由 | 拦截 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-067 | 合格的数据，调研写了快查 | 通过 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-068 | 合格的数据，调研写了深查和批计划的那一轮 | 通过 | think | header×3 emptyValues×7 sectionAsk whereScene whereText×2 queueBoard | 通过 |
| legacy-069 | 正文里出现术语表停用的说法（决定 121） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-070 | 一句话超过六十字 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-071 | 一句话在四十到六十字之间 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-072 | 一句话里有两个以上的分号 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-073 | 清单嵌在句子的括号里 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-074 | 指示词太密 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-075 | 合格的数据，停用的说法只出现在引用的原话里 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-076 | 合格的数据，中文不长的句子里夹着英文和路径（评审实测会误拦） | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-077 | 括号里的短括注有三项并列，只警告 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-078 | 合格的数据，「暴露出来」不是停用的「露出来」 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-079 | 合格的数据，代码里的半角分号不算清单 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-080 | 图表的种类不在「内容配什么形式」那张表里（决定 113） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.value asks[0].diagrams[0].kind |
| legacy-081 | 图表没有标题 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.missing asks[0].diagrams[0].title |
| legacy-082 | 架构图有一条线没有写明关系 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-083 | 合格的数据，带一张流程图和一棵目录树 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-084 | 合格的数据，架构图的每条线都写明了关系 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-085 | 先对齐的小卡缺「例子」（决定 114） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-086 | 先对齐的小卡写的「用在」对不上本页任何一张疑问卡 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-087 | 先对齐的小卡名称重复 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-088 | 合格的数据，带一张先对齐的小卡 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-089 | 选项还在用旧的「结果」字段 see（决定 109，用户选了只保留新格式） | 拦截 | check | header×3 emptyValues×7 optionSee whereScene whereText×2 | 通过 |
| legacy-090 | 带选项的卡没有写行名 rows | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.card.rowsMissing asks[0].rows |
| legacy-091 | 选项的差别 diffs 和行名的数量不一致 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.card.diffsCount asks[0].options[1].diffs |
| legacy-092 | 两个以上选项的卡没有写共同的部分 shared | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-093 | 差别的一格写得太长，超过两行 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-094 | 合格的数据，两行差别 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-095 | 行名 rows 写成了对象，不是文字 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.type asks[0].rows[0] |
| legacy-096 | 差别 diffs 写成了一段文字，长度恰好和行数相等 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.field.type asks[0].options[0].diffs |
| legacy-097 | 架构图同一行有两条线，第二条没有写明关系 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-098 | 先对齐小卡的「意思」一句超过六十个字，和卡片正文执行同一套写作规范 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-099 | 先对齐 align 写成了对象，不是列表 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.align align |
| legacy-100 | 行名九个字，刚过上限（决定 125） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-101 | 行名夹着英文，显示起来一样宽 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-102 | 合格的数据，行名恰好八个字 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-103 | 参考缺「建议」这一格（构思第 21 轮定的取值） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.refs refs |
| legacy-104 | 参考的「类型」不在定好的取值里 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.refs refs |
| legacy-105 | 参考没写正文 | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.refs refs |
| legacy-106 | 合格的数据，带一条参考 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | page.stage.refs refs |
| legacy-107 | 选项没写什么情况下该选它（用户指出的：b、c 为了写而写） | 拦截 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-108 | 只有一个选项，没有写明只有这一个方向 | 拦截 | check | header×3 emptyValues×6 whereScene whereText×2 | 通过 |
| legacy-109 | 写了只有这一个方向，却没有列出排除掉的方向 | 拦截 | check | header×3 emptyValues×6 whereScene whereText×2 | 通过 |
| legacy-110 | 选项长短差得太多 | 警告 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-111 | 合格的数据，只有一个方向并列出了排除掉的 | 通过 | check | header×3 emptyValues×6 whereScene whereText×2 | 通过 |
| legacy-112 | 合格的数据 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
| legacy-113 | 合格的数据，带一处文字的更改 | 通过 | check | header×3 emptyValues×6 whereScene whereText×2 | page.stage.changes changes |
| legacy-114 | 合格的数据，队列数据是空的 | 通过 | check | header×3 emptyValues×7 whereScene whereText×2 | 通过 |
