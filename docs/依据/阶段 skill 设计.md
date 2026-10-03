# 阶段 skill 设计

> 这份文件只在维护 skill 时读，运行时不读。它记着 skill 每条做法的出处。skill 里的做法已改成新体系，这里的表述按写作时的旧体系，对照时以 `skill/` 下的正文和参考文件为准。

这份文件给"产品循环"的五个阶段各找了 3 到 7 个公开来源，另加一节给检查的交互一致性和构思的设计规范。每个来源写清楚出处、方法本身、以及它在这个阶段里被用到哪一步。链接在 2026 年 9 月实际打开核对过，核不到的地方标了"未核实"。引用一律短句加链接，不转述成结论。每个阶段末尾的"拿了什么、没拿什么、为什么"是和 SKILL.md 对齐过的：和用户已定规矩冲突的做法一律进"没拿"。

---

## 构思

这个阶段要开几轮会，写满主线的十样：一句话新闻稿、给谁用、要完成的任务、场景清单、不做什么和胃口、交付线、四个风险、常见问题与待定、事前验尸、设计规范（设计规范的来源在最后一节"交互一致性与设计规范"）。

### 一、马蒂·卡根《INSPIRED》与"四大风险"

**来源**：Marty Cagan，《INSPIRED: How to Create Tech Products Customers Love》第二版，Wiley，2017 年 12 月（https://www.svpg.com/books/inspired-how-to-create-tech-products-customers-love-2nd-edition/ ）；配套短文《The Four Big Risks》，2017 年 12 月 4 日（https://www.svpg.com/four-big-risks/ ）。

**它的方法是什么**：卡根把一个产品点子拆成四类风险，要求在动手做之前分别回答。1）价值风险，用户会不会用、会不会买。2）可用性风险，用户会不会用得明白。3）可行性风险，工程上能不能做出来。4）商业可行性风险，这个方案和销售、品牌、法务、财务合不合得上。他主张把"发现"和"交付"分成两条并行的活，发现阶段的产出是被验证过的方案，不是排期。

**对这个阶段有什么用**：定位和场景清单写完之后，拿这四条逐个追问，可以把"想做"和"值得做"分开。

### 二、罗布·菲茨帕特里克《The Mom Test》

**来源**：Rob Fitzpatrick，《The Mom Test: How to talk to customers & learn if your business is a good idea when everyone is lying to you》，2013 年（https://www.momtestbook.com/ ）。

**它的方法是什么**：书的前提是当面问"你觉得我这个点子怎么样"，得到的回答没有信息量。替代做法是只问对方的生活，不介绍自己的点子。问已经发生过的具体事，不问将来的意向。追问对方上次遇到这个问题是什么时候、当时怎么处理、为此花过多少钱或多少时间。对方说"我肯定会用"这类话要当成没有信息，只有行为和已经付出的成本才算证据。

**对这个阶段有什么用**：写"给谁用"的时候，把用户的说法换成用户的行为记录，定位才不是自说自话。

**未核实**：官网页面没有逐条列出上述规则，规则表述出自书正文，没有拿到可引用的原文页面。

### 三、亚马逊"逆向工作法"的新闻稿与常见问题

**来源**：Werner Vogels，《Working Backwards》，2006 年 11 月 1 日（https://www.allthingsdistributed.com/2006/11/working_backwards.html ）。

**它的方法是什么**：亚马逊要求在写代码之前，先写好产品发布当天才需要的文档，然后倒着推回实现。顺序是四份东西。1）一份新闻稿，用最简单的话说清楚这个产品做什么、为什么存在、有什么功能和好处。2）一份常见问题文档，回答写新闻稿时冒出来的疑问，并界定产品能力边界。3）一份客户体验定义，界面类产品配示意图，也包含设想中的使用方式和代码片段。4）一份用户手册，分概念、操作、参考三部分，写全用户要知道的事。

**对这个阶段有什么用**：主线的四样对着这四份文档写：定位是新闻稿的第一段，场景清单是客户体验定义，交付线是新闻稿里承诺的那几件事。写不出来就说明产品还没想清楚。

### 四、瑞安·辛格《Shape Up》

**来源**：Ryan Singer，《Shape Up: Stop Running in Circles and Ship Work that Matters》，Basecamp（37signals），2019 年（https://basecamp.com/shapeup ）。

**它的方法是什么**：书里用"胃口"取代工期估算，词表里的定义是"我们愿意在一个项目上花多少时间，而不是一个估算"。定下胃口之后再倒过来裁方案，时间固定，范围可变。画草图用两种低精度方式，一种是接线图，只画地点、可放置的东西、以及它们之间的连接，不画界面。另一种是粗笔草图，用粗记号笔画，粗到画不出细节。周期结束还没做完的项目默认取消而不是延期，这条叫断路器。

**对这个阶段有什么用**：场景清单容易越写越长，"胃口 + 断路器"给了一个明确的收口规则。接线图适合在还没有界面时描述场景步骤。

**未核实**：Basecamp 官网页面上没有标注出版年份，2019 年这个年份来自 37signals 播客和同期书评，不是官网原文。

### 五、克里斯坦森等人《Know Your Customers' "Jobs to Be Done"》

**来源**：Clayton M. Christensen、Taddy Hall、Karen Dillon、David S. Duncan，《Know Your Customers' "Jobs to Be Done"》，《哈佛商业评论》2016 年 9 月号，第 54–62 页（https://hbr.org/2016/09/know-your-customers-jobs-to-be-done ）。

**它的方法是什么**：作者主张不要围着用户画像和数据相关性打转，而是去找用户到底想完成什么任务。买一个产品等于"雇"它来干一件活，干得好就继续雇，干不好就换掉。任务永远不只有功能一面，还有社交和情绪两面。具体做法是找出用户在什么情境下产生这个任务，他现在用什么东西凑合，以及他为了完成任务不得不忍受什么。

**对这个阶段有什么用**：写场景清单时，一行场景应该是一件用户要完成的事，不是一个功能名。

### 六、加里·克莱因的事前验尸

**来源**：Gary Klein，《Performing a Project Premortem》，《哈佛商业评论》2007 年 9 月号（https://hbr.org/2007/09/performing-a-project-premortem ）。

**它的方法是什么**：项目开工前开一次短会。1）主持人宣布：假设项目已经彻底失败了。2）每个人独立写下失败最可能的原因，几分钟内写完。3）轮流念，每人一条，直到念完。4）把原因收进计划，逐条想对策。文中说这样做是"By making it safe for dissenters who are knowledgeable about the undertaking and worried about its weaknesses to speak up, you can improve a project's chances of success."。和事后复盘的区别是它在事前，而且假定失败已经发生，人才敢说真话。

**对这个阶段有什么用**：主线的第九样"事前验尸"就是这个会的书面版：三个最可能的失败原因，各配一句现在就做的对策。

### 拿了什么、没拿什么、为什么

拿了事前验尸作为主线的最后一样，让构思在乐观之外留一段悲观。拿了逆向工作法的四份文档作为主线四样的对照：定位对新闻稿，场景清单对客户体验定义，交付线对新闻稿承诺的事。拿了四大风险作为构思的自检清单，价值和可用性两条在检查阶段还会再用一次。拿了"胃口"作为场景清单的收口规则，避免清单无限长。拿了任务视角作为场景的写法，一条场景写成一件要完成的事。拿了《The Mom Test》的行为优先原则，用来限制"给谁用"里的主观描述，也用来限制构思会上 AI 追问的问法：只问已经发生的事。拿了四份文档里的常见问题作为主线第八样。

没拿《Shape Up》的六周周期、下注会、团队编制这些组织流程，因为产品循环是一个人加一个模型在跑，没有多团队下注的场景。没拿《INSPIRED》里关于产品团队搭建和产品文化的章节，同理。没拿精益创业的最小可行产品与验证性学习循环，因为产品循环面对的是已经写完的软件，不是零起点的创业假设。没拿逆向工作法里的用户手册一项作为强制产出，因为大部分产品循环对象规模太小，写手册的成本高于收益。

只写定位一句话的项目，四大风险里的商业可行性一条基本用不上，可以跳过，不必硬凑。

---

## 使用

这个阶段要像用户一样把每个场景真用一遍，脚本替人用，产出使用记录和一张覆盖表。

### 一、迈克·科恩的测试金字塔

**来源**：Mike Cohn，《The Forgotten Layer of the Test Automation Pyramid》（https://www.mountaingoatsoftware.com/blog/the-forgotten-layer-of-the-test-automation-pyramid ，页面标注最后更新于 2023 年 2 月 7 日）；金字塔最初出自他的《Succeeding with Agile》，2009 年。

**它的方法是什么**：把自动化测试分三层堆成金字塔。1）最底层是单元测试，数量最多，跑得最快，失败时能直接指出出错的代码位置。2）中间层是服务层测试，绕开界面直接测应用的服务，这一层最常被忽略。3）最上层是界面测试，数量要最少，因为它"写起来贵、跑起来贵、还脆"。科恩的两条原则是：不同粒度都要写测试；越往上层，测试数量越少。

**对这个阶段有什么用**：覆盖表里要区分哪些场景只能靠界面跑，哪些可以下沉到接口层跑，避免整套用例都压在界面上。

### 二、肯特·C·多兹的测试奖杯与 Testing Library 原则

**来源**：Kent C. Dodds，《Write tests. Not too many. Mostly integration.》，2019 年 7 月 13 日（https://kentcdodds.com/blog/write-tests ）；Testing Library 指导原则（https://testing-library.com/docs/guiding-principles ）。文中说明这句口号最早来自 Guillermo Rauch。

**它的方法是什么**：多兹主张把重心放在集成层，理由是集成测试在信心和成本之间最划算。"不要太多"指的是覆盖率过了七成左右收益递减，继续堆测试会拖慢重构。他建议少打桩、少替身，让多个模块真的连起来跑。Testing Library 的原则一句话："The more your tests resemble the way your software is used, the more confidence they can give you."（https://testing-library.com/docs/guiding-principles ）具体落到查询方式上，就是按用户看得见的文本、标签、角色去找元素，不按类名和内部结构去找。

**对这个阶段有什么用**：脚本要按用户看到的文字点，不按 DOM 结构点，脚本才不会因为改了一个类名就红。

### 三、《Software Engineering at Google》第十一章

**来源**：Titus Winters、Tom Manshreck、Hyrum Wright 编，《Software Engineering at Google》，O'Reilly，2020 年，第 11 章"Testing Overview"（https://abseil.io/resources/swe-book/html/ch11.html ）。

**它的方法是什么**：谷歌不按"单元、集成、端到端"分类，而是按测试怎么跑来分大小。1）小型测试只在单个进程里跑，不碰文件系统和网络，通常一秒内跑完。2）中型测试在单机上跑，可以起多个线程、起真实的数据库进程、通过本机回环通信。3）大型测试不限制资源，跑在接近生产的真实环境里。书中给出的比例大致是八成小型、一成半中型、半成端到端。这个分类的好处是每类测试的"允许做什么"是明确规定的，不是靠命名习惯。

**对这个阶段有什么用**：覆盖表里每一行标一个尺寸，就知道这条用例慢在哪里、失败了该怀疑谁。

### 四、巴赫兄弟的基于会话的测试管理

**来源**：James Bach、Jonathan Bach，《Session-Based Test Management》，2000 年（https://www.satisfice.com/download/session-based-test-management ）；同期由 Jonathan Bach 发表于 STQE 杂志。

**它的方法是什么**：把探索式测试切成固定时长的会话来管理。1）每个会话先写一份纲领，一句话说明这次要查什么。2）会话不被打断地跑完，通常在一小时上下。3）过程记在一张会话表上，包含纲领、区域、时间分配、发现的问题、以及遇到的障碍。4）会话结束后做一次简短汇报，Jonathan Bach 用五个词组织这次汇报，分别是做过什么、结果如何、遇到什么障碍、接下来怎么办、以及感受如何。管理的对象是活动和时间，不是文档数量。

**对这个阶段有什么用**：人工试用那部分不该漫无目的，按场景拆成有纲领、有时长、有记录的会话，产出就能直接并进使用记录。

### 五、凯姆·卡纳《An Introduction to Scenario Testing》

**来源**：Cem Kaner，《An Introduction to Scenario Testing》，2003 年，原载 STQE 杂志（https://kaner.com/pdfs/ScenarioIntroVer4.pdf ）；2013 年 4 月佛罗里达理工学院更新版（https://bbst.courses/wp-content/uploads/2023/05/Kaner_ScenarioIntroVer5.pdf ）。

**它的方法是什么**：卡纳给出场景测试的五个特征，原文写作"a story that is (b) motivating, (c) credible, (d) complex, and (e) easy to evaluate"。1）它是一个关于产品怎么被使用的故事，包含当事人的动机。2）它有说服力，意思是有话语权的人看到失败会要求修。3）它可信，这件事在现实中真的可能发生。4）它复杂，牵涉多个功能、复杂的数据或复杂的环境。5）它的结果容易判定，因为越复杂的测试越容易让人把错误结果当成正常。他还说明场景测试的用途之一是把缺陷报告变得有说服力，另一个用途是暴露"功能都对但收益没达成"的问题。

**对这个阶段有什么用**：场景清单里每一条都应该同时满足这五点，否则跑出来的结果没人认。第五条直接对应产品循环里"每步写清该看到什么"。

### 拿了什么、没拿什么、为什么

拿了尺寸分类作为覆盖表的一列，端到端和集成两档对应谷歌的大型和中型。拿了"越往上越少"这条，决定哪些场景配界面脚本、哪些只配接口脚本。拿了 Testing Library 的按用户可见文本选元素的原则，作为脚本写法的硬规定。拿了会话式管理的纲领和记录格式，作为人工试用那一段的记录结构。拿了卡纳的五个特征作为场景是否合格的判据，尤其是"结果容易判定"这条。

没拿单元测试层，这个阶段不写单元测试，因为目标是验证产品可用而不是验证函数正确。没拿覆盖率指标，因为这里的覆盖对象是场景清单而不是代码行。没拿灰盒和压力测试类的技术手段，超出产品循环范围。没拿谷歌关于不稳定测试的整套治理机制，只在脚本反复重跑时参考它的判断原则，相关材料在《Flaky Tests at Google and How We Mitigate Them》，John Micco，2016 年 5 月 27 日（https://testing.googleblog.com/2016/05/flaky-tests-at-google-and-how-we.html ）。没拿"吃自家狗粮"作为独立依据，因为它是一个习惯说法，找不到可以引用的原始出处。

---

## 检查

这个阶段要以严苛产品经理和客户验收的眼光逐屏找问题，三个根问题是必要性、认知一致性、交互一致性。

### 一、尼尔森十条可用性启发式与启发式评估法

**来源**：Jakob Nielsen，《10 Usability Heuristics for User Interface Design》，1994 年 4 月 24 日首发，2024 年 1 月 30 日更新（https://www.nngroup.com/articles/ten-usability-heuristics/ ）；配套方法文章《How to Conduct a Heuristic Evaluation》（https://www.nngroup.com/articles/how-to-conduct-a-heuristic-evaluation/ ）。

**它的方法是什么**：十条分别是系统状态可见、系统与真实世界匹配、用户可控可撤销、一致性与标准、防错、识别优于回忆、灵活高效、简洁的视觉设计、帮助用户识别和恢复错误、帮助与文档。评估的做法有固定步骤。1）先圈定范围，范围越窄评得越细。2）三到五个评估者各自独立评，不要一起评。3）每人限时一到两小时。4）结果记在同一份表格里，逐条对着十条写出违反的具体位置和修改建议。5）最后一起过一遍，讨论重设计方案。

**对这个阶段有什么用**："认知一致性"可以直接展开成这十条里的状态可见、防错、错误恢复、识别优于回忆去逐屏对照。

### 二、认知走查法

**来源**：Cathleen Wharton、John Rieman、Clayton Lewis、Peter Polson，《The cognitive walkthrough method: a practitioner's guide》，收于《Usability Inspection Methods》，Wiley，1994 年，第 105–140 页（https://dl.acm.org/doi/10.5555/189200.189214 ）。

**它的方法是什么**：先定一个任务和一串正确操作步骤，然后在每一步上问同一组问题。1）用户会不会想去做这一步想做的事。2）用户能不能看见执行这一步的控件。3）用户能不能把这个控件和自己想做的事对上。4）执行之后，用户能不能看出事情在朝完成推进，原文中这一条的表述是"If the correct action is performed, will the user see that progress is being made toward the solution of the task?"。这个方法专门评"第一次用的人学不学得会"，最早用于自助机、取款机这类无人指导的设备。

**对这个阶段有什么用**：这套四问就是"认知一致性"的逐步展开：用户以为的和实际发生的对不对得上，适合按屏按步走一遍而不是整体印象打分。

**未核实**：只核到了第四问的英文原文，前三问按通行表述写出，没有拿到可引用的原文页面。

### 三、唐·诺曼《设计心理学》修订版

**来源**：Don Norman，《The Design of Everyday Things, Revised and Expanded Edition》，Basic Books，2013 年（https://jnd.org/books/the-design-of-everyday-things-revised-and-expanded-edition/ ）。

**它的方法是什么**：书里给出几个判断界面的基本概念。1）可供性，指这个东西实际上允许什么操作。2）意符，指用户能感知到的提示，告诉他可以做什么，这是 2013 年版新增的概念，用来补 1988 年版对可供性的定义。3）映射，指控件和它产生的效果之间的对应关系。4）反馈，指系统有没有把操作结果告诉用户。5）概念模型，指用户脑子里对系统怎么运作的理解。书里还把人的失误分成两类，一类是想对了做错了，一类是想就想错了。

**对这个阶段有什么用**：找问题时能说清楚一个控件"哪里不对"，是没有意符、映射错了、还是没有反馈，而不是只能说"感觉怪"。

### 四、史蒂夫·克鲁格《Don't Make Me Think》

**来源**：Steve Krug，《Don't Make Me Think, Revisited: A Common Sense Approach to Web (and Mobile) Usability》第三版，New Riders，2014 年，212 页（https://www.sensible.com/dont-make-me-think/ ）。

**它的方法是什么**：核心主张是用户不读页面，只扫页面，看到差不多能用的第一个东西就点。所以设计要让每一屏"不用想"。可操作的做法包括：每个页面上最重要的东西要在视觉上最突出；可点的东西要一眼看出是可点的；去掉一半文字，再去掉剩下的一半；导航要能回答"我在哪、我能去哪"。书里还主张小规模、低成本、频繁做的可用性测试，找几个人来用比争论有效。

**对这个阶段有什么用**："必要性"这个根问题，对应书里删字、删元素这条；逐屏看的时候先看这一屏能不能不用想就用。

### 五、《Refactoring UI》

**来源**：Adam Wathan、Steve Schoger，《Refactoring UI》，自出版，2018 年（https://refactoringui.com/ ）。

**它的方法是什么**：这本书把界面问题拆成可以逐条检查的具体做法。1）层次，用字号、字重、颜色深浅区分主次，不是所有元素都加粗。2）间距，先给足留白，元素之间的间距要能表达从属关系。3）排版，限制字号和字重的种类，行高随字号变化。4）颜色，需要的不是一个颜色，而是每个颜色的一组明度档位。5）深度，用阴影表达高度层级而不是随手加。6）收尾，包括空状态、边框的替代方案、图标不要随意放大。作者把这套叫作用战术做设计，不靠天分。

**对这个阶段有什么用**：视觉类问题可以写成"层次不对""间距没有表达从属"这样能改的描述，而不是"太丑"。

**未核实**：官网页面底部只显示当前年份的版权信息，2018 年这个出版年来自 Open Library 和 Goodreads 的条目，不是作者页面原文。

### 拿了什么、没拿什么、为什么

拿了尼尔森十条作为逐屏检查的对照清单，其中状态可见、防错、错误恢复三条对应"认知一致性"。拿了认知走查的四问作为"认知一致性"的逐步问法，按任务走而不是按页面走。拿了诺曼的意符、映射、反馈三个词作为问题描述的词汇，让每条问题都指向一个具体机制。拿了克鲁格的删减主张作为"必要性"的判据。拿了《Refactoring UI》的六类具体做法，把视觉问题变成可执行的修改项，归在"交互一致性"下。

没拿启发式评估的"三到五个独立评估者"这条人数要求，因为产品循环里只有一个评估者，替代做法是分多轮、每轮只盯一类问题。没拿可用性测试的招募和主持流程，那属于有真实用户参与的场景，循环里没有真实用户。没拿托格纳齐尼的交互设计首要原则，它和尼尔森十条重叠度高，两套一起用会产生重复条目，原文在 https://asktog.com/atc/principles-of-interaction-design/ ，2014 年 3 月 5 日修订版。没拿尼尔森的严重度分级（0 到 4），用户定过报告里不出现分数和等级；排序规则只有一条：在场景清单靠前的先。

---

## 落地

这个阶段按用户勾选的项去改，改完再用一遍，用改前改后的截图作证据。

### 一、大野耐一的五问法

**来源**：Taiichi Ohno 提出，Lean Enterprise Institute《Clarifying the '5 Whys' Problem-Solving Method》，2018 年 7 月 19 日（https://www.lean.org/the-lean-post/articles/five-whys-animation/ ）。

**它的方法是什么**：做法是站到问题实际发生的地方去看，然后对着现象一层层问为什么，直到问到一个能采取对策的根因为止。文章特别澄清"五"不是硬性次数，有时三次，有时八次，重点是把因果链追到底。它举的例子是机器保险丝烧了，往下追到润滑泵磨损、再到吸油口没有滤网这一层，对策才落在装滤网上。文中警告最常见的失败是只停在第一层原因，贴个创可贴，问题会再犯。

**对这个阶段有什么用**：界面上的一个问题往往是一类问题的表现，追到根因才能一次改掉一类，而不是一屏一屏地补。选项里"为什么这样改"那一句写的就是根因。

### 二、丰田的自働化与安灯

**来源**：丰田汽车官方网站，Toyota Production System（https://global.toyota/en/company/vision-and-philosophy/production-system/index.html ）。

**它的方法是什么**：自働化被丰田解释为"带人性的自动化"，规则是一旦发现异常就立即停下来，不让有缺陷的产品继续往下流。设备自己会停，工人也可以拉绳子让线停下。停下之后，安灯板会亮起来指示异常位置，原文写作"When equipment stops, the andon (problem display board) lights up to notify workers of the abnormality."。停线的目的不是惩罚，而是让问题在发生的那一刻就被看到并处理。

**对这个阶段有什么用**：使用阶段一遇到断点就停下来记录并定位，先修断点再往下走，而不是跑完一整轮再回头翻日志。

### 三、谷歌 SRE 的无责事后复盘

**来源**：John Lunney、Sue Lueder，《Site Reliability Engineering》第 15 章"Postmortem Culture: Learning from Failure"，O'Reilly，2016 年（https://sre.google/sre-book/postmortem-culture/ ）。

**它的方法是什么**：事故之后写一份书面记录，内容固定包含事故经过、影响、采取的缓解动作、根因、以及防止再发生的后续动作。触发写复盘的条件要事先写死，例如用户可见的故障超过阈值、任何数据丢失、需要人工回滚或改流量、监控没报而是靠人发现。写的时候假定每个参与者当时的出发点都是好的，把注意力放在系统的薄弱处而不是追究个人。发布前要有人评审，评审要看数据全不全、影响写得准不准、根因挖得够不够深、后续动作合不合适。

**对这个阶段有什么用**："更改"里每条的"之前哪里不对 → 现在什么样"对应影响和缓解动作，选项里的根因对应根因一栏；改了行为的进决定文件，对应后续动作。

### 四、肯特·贝克的改动顺序

**来源**：Kent Beck，推文，2012 年 9 月 25 日（https://x.com/KentBeck/status/250733358307500032 ）。

**它的方法是什么**：原话是"for each desired change, make the change easy (warning: this may be hard), then make the easy change"。做法分两步且不能合并。1）先重构，把代码调整到让目标改动变得容易，这一步不改变行为。2）再做那个已经变容易的改动。关键约束是两步各自独立提交，不要在一个改动里既重构又改行为。

**对这个阶段有什么用**：一个问题如果改起来别扭，说明结构没准备好，先整理结构再改，改前改后的对比才只体现一件事。

### 拿了什么、没拿什么、为什么

拿了五问法作为定位环节的固定动作，要求每条落地写出根因而不是只写改了哪一行。拿了停线原则作为使用阶段的纪律，发现断点立刻停下并记录当前屏。拿了复盘记录的固定字段，改前改后截图对应"影响"和"缓解动作"两栏，根因在选项里，后续动作进决定文件。拿了两步走的改动顺序，作为改动提交的拆分规则。

没拿无责文化里关于组织奖惩的部分，因为产品循环里没有多人协作和追责场景。没拿完整的事故分级和值班响应流程，量级不匹配。没拿正式的回归测试套件管理方法，这个阶段的回归靠重跑改到的场景，不另建体系。没拿"先写一个失败的测试再修"这条测试驱动的规则作为硬性要求，因为界面类问题的很多表现无法先写出稳定的失败断言。没拿严重度分级，同检查阶段。

---

## 提升

这个阶段站在整个产品的角度看该留什么、加什么、删什么、重构什么，默认每份报告给一到三条建议。

### 一、狩野模型

**来源**：狩野紀昭、瀬楽信彦、高橋文夫、辻新一，《魅力的品質と当り前品質》（英文题 Attractive Quality and Must-Be Quality），《日本品質管理学会誌》第 14 卷第 2 期，第 147–156 页，1984 年 4 月 15 日（https://www.jstage.jst.go.jp/article/quality/14/2/14_KJ00002952366/_article/-char/en ）。

**它的方法是什么**：论文把"质量好不好"从一维改成二维来看，一个维度是功能做得充不充分，另一个维度是用户满不满意。由此把需求分成几类。1）当然质量，有了没人夸，没有就不能忍。2）一维质量，做得越多越满意。3）魅力质量，没有也不会不满，有了会明显加分。4）无差异、反向等其他类别。判断方法是对每个特性问一正一反两个问题，先问"如果有这个功能你感觉如何"，再问"如果没有你感觉如何"，按两个答案的组合归类。论文用电视机和座钟做了消费者调查来验证。

**对这个阶段有什么用**：提建议时先分清这条属于补当然质量还是加魅力质量，前者是欠债，后者才是加分。

### 二、特蕾莎·托雷斯的机会解决方案树

**来源**：Teresa Torres，《Continuous Discovery Habits》，Product Talk，2021 年（https://www.producttalk.org/continuous-discovery-habits/ ）；方法文章《Opportunity Solution Trees》，2023 年 12 月 6 日更新（https://www.producttalk.org/opportunity-solution-trees/ ）。

**它的方法是什么**：把一棵树画出来，从上到下四层。1）树根是一个期望达成的结果，是一个指标，不是一个功能。2）第二层是机会，也就是用户的需求、痛点和愿望，来自访谈中的真实故事。3）第三层是针对某个机会想出来的解决方案。4）第四层是为了验证方案而要测的假设。作者强调机会和方案要分开，"我没时间做饭"是机会，"叫外卖"只是众多方案之一。她给的步骤是先确认目标用户和价值主张，再定结果，再铺机会，再挑一个机会，再想方案，收敛到三个，然后找出假设并逐个验证。

**对这个阶段有什么用**：一到三条建议应该挂在同一个结果下面，并且写清楚它对应哪个机会，否则就是零散的功能许愿。

### 三、梅丽莎·佩里《Escaping the Build Trap》

**来源**：Melissa Perri，《Escaping the Build Trap: How Effective Product Management Creates Real Value》，O'Reilly，2018 年（https://www.oreilly.com/library/view/escaping-the-build/9781491973783/ ）。

**它的方法是什么**：书里把"用产出数量衡量价值"这种状态称为造物陷阱，表现是用发布了多少功能、发版多频繁来算成绩。解法有几条。1）用结果衡量，不用产出衡量。2）用决策策略代替写死的功能路线图。3）在做之前用一套固定循环验证想法，这个循环是先测当前基线，再定目标结果，再做小规模探索实验，再看差距，然后重复。作者把这个循环叫产品型，来源是丰田的改善型。

**对这个阶段有什么用**：提升建议要写清楚它想改变哪个结果，只写"增加一个功能"的建议应该被打回。

### 四、马斯克的五步流程

**来源**：Trevor Sesnic，《Starbase Tour and Interview with Elon Musk》，Everyday Astronaut，2021 年 8 月 11 日（https://www.everydayastronaut.com/starbase-tour-and-interview-with-elon-musk/ ）。

**它的方法是什么**：五步必须按顺序做。1）"Make the requirements less dumb."，并且要追到是谁提的这个要求，不能归给某个部门。2）"Try very hard to delete the part or process."，删到后面如果一个都没加回来，说明删得还不够狠。3）"Simplify and optimize the design."。4）"Accelerate cycle time"。5）"Automate"。文章强调顺序不能颠倒，理由是聪明的工程师最常犯的错就是去优化一个本来就不该存在的东西。

**对这个阶段有什么用**："删什么"这条要排在"加什么"前面，而且自动化和性能优化要排在最后。

### 五、迪特·拉姆斯的十条好设计原则

**来源**：Dieter Rams，十条好设计原则，1970 年代末提出，Vitsœ 官方页面（https://www.vitsoe.com/us/about/good-design ）。

**它的方法是什么**：十条分别是：好设计是创新的、让产品好用、是美的、让产品易懂、不张扬、诚实、耐久、每个细节都做到位、对环境友好、以及尽可能少设计。第十条下面的原话是"Less, but better – because it concentrates on the essential aspects, and the products are not burdened with non-essentials."。其中"诚实"一条的意思是不夸大产品的能力，"不张扬"的意思是产品要留出空间给用户自己的表达。

**对这个阶段有什么用**：判断"该删什么"的时候，第十条给了一个方向；判断"该留什么"的时候，耐久和细节两条给了标准。

**关于一句常被引用的话**：与"少即是好"经常被放在一起的那句"完美不是无可增加，而是无可删减"，出自 Antoine de Saint-Exupéry 1939 年的《Terre des Hommes》第三章，法文原文是"Il semble que la perfection soit atteinte non quand il n'y a plus rien à ajouter, mais quand il n'y a plus rien à retrancher"（https://en.wikiquote.org/wiki/Antoine_de_Saint_Exup%C3%A9ry ）。它谈的是飞机设计，不是软件，引用时不要写成设计界的通用格言。

### 拿了什么、没拿什么、为什么

拿了狩野模型的分类作为建议的第一层标签，区分补欠债和加亮点。拿了机会解决方案树的四层结构，要求每条建议写明对应的结果和机会。拿了造物陷阱的判据，用结果而不是功能数量来衡量一条建议值不值。拿了五步流程的顺序，把"删"排在"加"前面，把自动化排在最后。拿了拉姆斯第十条作为删减方向，以及耐久和细节两条作为保留标准。

没拿狩野模型的正反两问问卷，因为产品循环里没有足够的用户样本做统计归类，只借用它的分类概念。没拿持续发现所要求的每周访谈节奏，因为产品循环通常没有稳定的用户来源。没拿完整的优先级打分公式，一到三条建议的规模用不上打分排序，而且用户定过不出现分数；RICE 的原始说明在 Intercom 博客（https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/ ），这次没能直接打开该页面核对正文，标为未核实。没拿设计冲刺的五天流程，它需要多人全职参与。没拿《Empowered》《Getting Real》，与已选来源的主张重叠，再加进来只会让建议来源变多而判据不变。

---

## 交互一致性与设计规范

这一批来源服务两处：检查阶段第三个根问题"交互一致性"，和构思阶段要先问出来的设计规范（主线第 10 样）。链接在 2026 年 9 月实际打开核对过，核不到的地方标了"未核实"。

### 一、平台动效规范：Material Design 3 与 Apple HIG

**来源**：Google，《Motion physics system》，Material Design 3，页面标注 2025 年 5 月（https://m3.material.io/styles/motion/overview/how-it-works ）；《Easing and duration: Tokens & specs》（https://m3.material.io/styles/motion/easing-and-duration/tokens-specs ）。Apple，《Motion》，Human Interface Guidelines，更新日志最后一条为 2025 年 9 月 9 日（https://developer.apple.com/design/human-interface-guidelines/motion ）。

**它的方法是什么**：Material 把动效做成两层可枚举的东西。1）方案层只有两种，expressive 会冲过目标值再弹回来，standard 少弹或不弹；页面写"most motion in a product should use the same scheme"，也就是全产品原则上只用一种。2）token 层分两类：spatial 管位置、旋转、尺寸、圆角，effects 管颜色和透明度，各有 fast、default、slow 三档，小控件用 fast，全屏用 slow。3）旧的缓动时长体系仍有完整数值表可查：短 50 到 200 毫秒，中 250 到 400，长 450 到 600，超长 700 到 1000，emphasized 与 standard 两套曲线各给了 cubic-bezier 值；该页已标注这套体系"no longer maintained"，新产品应迁到物理系统。Apple 那页给的是约束不是参数：动效要有目的、不能是传递重要信息的唯一通道、高频交互上不要加自定义动画、动画要能被取消。

**对哪个阶段有什么用**：构思时问"用哪种动效方案、分几档时长"；检查时查全产品是不是只用一套方案和同一组档位，有没有哪一屏自己发明了曲线或时长。

### 二、迪士尼动画十二原则

**来源**：Frank Thomas、Ollie Johnston，《Disney Animation: The Illusion of Life》，Abbeville Press，1981 年（https://en.wikipedia.org/wiki/The_Illusion_of_Life:_Disney_Animation ）；十二条的列表见 https://en.wikipedia.org/wiki/Twelve_basic_principles_of_animation 。

**它的方法是什么**：十二条是挤压与拉伸、预备动作、舞台呈现、连续画法与关键帧画法、跟随与重叠、缓入缓出、弧线、次要动作、节奏、夸张、扎实的素描、吸引力。界面上真正用得上的是其中五条。1）缓入缓出：物体起步和收尾都要有加减速，不能匀速。2）弧线：移动走曲线，只有机械运动才走直线。3）预备动作：大变化前先有一点蓄势，让人知道要发生什么。4）跟随与重叠：同时出场的元素错开一点，不是整块一起跳。5）节奏：帧数决定速度，同一类动作应该是同一个节奏。

**对哪个阶段有什么用**：构思时问"动效要什么手感"（弹还是稳、有没有预备动作）；检查时查同一类动作在不同屏上是不是同一手感，有没有匀速直线的生硬位移。

**未核实**：维基书籍词条只说书里讲了这十二条，没有逐条原文；上面十二条的措辞取自维基的专门词条，不是书正文。

### 三、Brad Frost《Atomic Design》

**来源**：Brad Frost，《Atomic Design》，2016 年（https://atomicdesign.bradfrost.com/ ；五个层级见 https://atomicdesign.bradfrost.com/chapter-2/ ，该页底部版权为 2016 Brad Frost）。

**它的方法是什么**：把界面拆成五层，逐层往上搭。1）原子，不能再拆的元素，按钮、标签、输入框。2）分子，几个原子组成的小部件，比如"标签加输入框加按钮"的搜索表单。3）组织，界面上一整块区域，比如含导航和搜索的页头。4）模板，把组织排进版式，用占位内容看结构而不看内容。5）页面，模板填上真实内容，用真实数据验证系统撑不撑得住。规则是新界面先看现有原子和分子够不够用，不够才新造；模板层只评结构，页面层才评内容。

**对哪个阶段有什么用**：构思时问"这一版新增哪些原子、哪些是复用的"；检查时查同一个功能在不同屏上是不是同一个组件，还是被各自重画了一遍。

### 四、Alla Kholmatova《Design Systems》

**来源**：Alla Kholmatova，《Design Systems: A practical guide to creating design languages for digital products》，Smashing Magazine，2017 年，288 页（https://www.smashingmagazine.com/design-systems-book/ ）。

**它的方法是什么**：书把模式分成两类。功能模式是界面上做事的部件（按钮、表单、卡片），感知模式是让产品看起来像它自己的那些东西（配色、字体、图标风格、形状、留白、动效）。做法有顺序。1）先写设计原则，原则要具体到能排优先级、能判对错，不能是"简洁、好用"这类空话。2）做界面审计，把现有界面里同一类元素全截下来并排看，数出到底有多少种按钮、多少种阴影、多少种间距。3）给每个模式起名，名字要全队通用，命名不统一本身就说明系统没建起来。4）功能模式和感知模式分开系统化，感知模式更容易随品牌变，要单独列参数。

**对哪个阶段有什么用**：构思时问"这产品的感知模式是什么，为什么是这个配色和这套图标"；检查时把同类元素并排截图数种类，种类数超过规范就是不一致。

### 五、NN/g 的格式塔三篇

**来源**：Aurora Harley，Nielsen Norman Group：《Proximity Principle in Visual Design》，2020 年 8 月 2 日（https://www.nngroup.com/articles/gestalt-proximity/ ）；《Similarity Principle in Visual Design》，2020 年 9 月 6 日（https://www.nngroup.com/articles/gestalt-similarity/ ）；《The Principle of Common Region: Containers Create Groupings》，2020 年 7 月 12 日（https://www.nngroup.com/articles/common-region/ ）。

**它的方法是什么**：三条可以直接拿来查布局。1）邻近：靠得近的东西被当成一组，所以相关的要挨着，无关的要用留白隔开，间距按分组关系定而不是按好看定。2）相似：长得像的被当成同类，链接色只给可点的东西用，按钮形状统一，不相关的分类不要用几乎一样的图标；尺寸相同意味着重要性相同。3）共同区域：加了边框或底色的东西被当成一组，这个信号强到能盖过邻近；但边框和色块用多了会变成噪声，还会造出假的停止点让人不再往下滚，所以加容器前先看留白够不够。

**对哪个阶段有什么用**：构思时问"信息怎么分组、用留白还是用容器"；检查时查一屏上的间距和容器是不是在表达真实的分组，有没有相关的离得远、无关的挤在一个框里。

### 六、WCAG 2.2 的对比度最低要求

**来源**：W3C，《Web Content Accessibility Guidelines (WCAG) 2.2》，W3C 建议标准，2024 年 12 月 12 日版（https://www.w3.org/TR/WCAG22/#contrast-minimum ）；配套说明文档《Understanding SC 1.4.3: Contrast (Minimum)》（https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html ）。

**它的方法是什么**：1.4.3 是 AA 级，规则是四条。1）文字和文字图片的对比度至少 4.5:1，原文写作"The visual presentation of text and images of text has a contrast ratio of at least 4.5:1"。2）大号文字至少 3:1。3）大号文字定义为 18pt 或 14pt 加粗（说明文档给的换算约为 24px 和 18.5px），中日韩字体按等效字号算。4）失效控件里的文字、纯装饰、不可见文字、图片里的附带文字，以及 logo 和品牌名，没有对比度要求。做法是取前景色和背景色算比值，不是凭眼睛判断。

**对哪个阶段有什么用**：构思时问"配色里每一档明度要满足哪一级对比度"；检查时对每屏的正文、次要文字、占位符、禁用态逐个算比值，低于 4.5:1 的直接记成问题。

### 七、《命令行界面指南》clig.dev

**来源**：Aanand Prasad、Ben Firshman、Carl Tashian、Eva Parish，《Command Line Interface Guidelines》，2020 年（https://clig.dev/ ；源码在 https://github.com/cli-guidelines/cli-guidelines ）。

**它的方法是什么**：这份指南给没有图形界面的那部分定了可以逐条对的规矩。1）帮助：不带参数、-h、--help 三种都要能出帮助，默认给简短版（一句说明、一两个例子、常用参数），--help 给全量，文档里先给例子。2）输出：正文走 stdout，提示和错误走 stderr；默认给人看的格式，检测到不是 TTY 就换格式；提供 --json 给机器读；状态变了要说一句，并提示下一步该跑什么命令。3）错误：把捕获到的错误改写成人话，说清出了什么事和怎么修，最重要的信息放输出最后，同类错误合并。4）颜色：有意图地用，且在不是 TTY、设了 NO_COLOR、TERM=dumb、或用户传了 --no-color 时自动关掉；非交互环境不要放动画。5）交互：只有 stdin 是 TTY 才提问，提供 --no-input，任何提问都要有对应参数可以绕过，Ctrl-C 随时能退。

**对哪个阶段有什么用**：构思时问"这个产品的命令行和 agent 接口给谁看、用什么语气"；检查时把 CLI 和 agent 面向的输出当成一屏，查帮助、错误话术、颜色和 TTY 判断在全产品是不是一致。

**未核实**：clig.dev 站点本身不标年份，2020 这个年份来自 InfoQ 2020 年 12 月的报道（https://www.infoq.com/news/2020/12/cli-guidelines-qa/ ），不是站点原文。

### 拿了什么、没拿什么、为什么（检查的交互一致性）

拿了 Kholmatova 的界面审计做法当这一问的主方法：同类元素并排截图、数出有几种、超过规范里定的种类数就是问题，这样"不一致"能变成一个数而不是一句感觉。拿了 NN/g 三条格式塔当信息结构的判据，让"乱"可以写成"相关的没挨着"或"无关的被同一个容器框住了"。拿了 WCAG 1.4.3 的 4.5:1 和 3:1 当配色的硬线，这条能算出来，不用争。拿了 Material 的方案层加 token 层结构当动效一致性的查法：查全产品是不是只有一套方案、一组档位。拿了迪士尼十二条里缓入缓出、弧线、跟随与重叠三条当手感的描述词，让动效问题能写成可改的句子。拿了 Atomic Design 的五层当"同一功能是不是同一组件"的问法。拿了 clig.dev 的五组规则，把 CLI 和 agent 接口纳入这一问，而不是只查有像素的屏。

没拿 Material 那张数值表和 cubic-bezier 系数当本产品的标准，那是 Google 自己产品的口径；这里只借"档位必须可枚举"这个结构，具体值以本产品的设计规范为准。没拿 Apple HIG 里 visionOS 和游戏帧率那几节。没拿迪士尼的挤压拉伸、夸张、扎实的素描、吸引力四条，它们是角色动画的要求，套到界面上只会鼓励多余动画。没拿 Atomic Design 的命名体系当代码目录要求，只借层级概念做提问。没拿 WCAG 其他条款进这一问（焦点可见、目标尺寸等），它们属于认知一致性那一问，放这里会和尼尔森清单重复。没给问题分等级，用户定过报告里不出现分数和等级。

### 拿了什么、没拿什么、为什么（构思的设计规范）

拿了 Kholmatova 的顺序当设计规范提问的骨架：先写能判对错的设计原则，再把模式分成功能和感知两类，配色、字体、图标风格、动效手感都属于感知模式，要在动手前一次问清楚并写下理由。拿了 WCAG 1.4.3 当配色提问的硬约束。拿了 Material 的两种方案当动效手感提问的选项（弹还是稳），以及"档位要可枚举"这个要求，让答案落成几个 token 而不是一句形容。拿了 Atomic Design 的原子和分子层当"这一版新增什么、复用什么"的问法。拿了 clig.dev 当提醒：构思阶段就要定下 CLI 和 agent 接口的输出对象与语气，包括要用哪些 skill 和工具。

没拿 Kholmatova 书里关于团队规模和系统成熟度的分类，本 skill 面向单人加 agent 的场景。没拿 Material 的主题与动态取色，那是 Android 平台能力。没拿"先建组件库再做产品"这条常见做法，构思阶段的产出是设计规范里的几条决定和理由，不是一套组件代码。没拿任何来源里的具体数值当默认值，构思阶段要问出的是理由和取舍，数值由用户定。

---

## 怎么用这份文件

1. SKILL.md 每个阶段有一行"依据"，指向本文对应的小节，不在 SKILL.md 里重复抄写方法内容。
2. "依据"行只写指向哪几条，例如检查阶段写"见检查的第一条和第二条"，不写整段论述。
3. 本文里每条来源都给了可以打开的链接，写报告时如果要引用某个判据，直接引链接，不要凭印象转述。
4. 标了"未核实"的地方不能当作依据使用，只能作为待查线索，核实之后再把标记去掉。
5. 想新增来源时，先按同样的三段写法补齐出处、方法、用处，出处必须包含作者、年份和能打开的链接。
6. 各阶段末尾的"没拿什么"同样是依据的一部分，它解释了产品循环为什么不做某些事，遇到"为什么不加上这一步"的质疑时先看那一段。和用户已定规矩冲突的做法（分数、等级、统计数字）一律在"没拿"里。
