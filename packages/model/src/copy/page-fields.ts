import { copy } from "./define.ts";

// 页面数据每个字段的说明，写进 JSON Schema 的 description，ploop page schema 把它们原样打印给 AI 看。
// 说明只有这一个来源，skill 的正文和参考文件不再另写字段的含义。写法和 use.ts 里使用代码的输出格式相同。
// 说明也是文案，跑写作校验：句子短，一句一件事，括号里不放清单。文字里不写花括号。

/** 线稿积木的类名清单，一块一行。ploop page schema --blocks 打印它，页面里只有这些类名有样式。 */
const sketchBlocks = {
  top: copy("mk-top：顶栏，里面横排。"),
  tab: copy("mk-tab：一个标签页，加 on 表示当前。"),
  btn: copy("mk-btn：按钮，加 primary 是主按钮，加 on 是选中。"),
  select: copy("mk-select：下拉，文字里自己写 ▾。"),
  input: copy("mk-input：输入框。"),
  row: copy("mk-row：列表的一行，加 on 是选中行。里面放 mk-thumb、文字和靠右的 mk-meta。"),
  cards: copy("mk-cards：三列卡片网格。里面放 mk-card，卡里是 mk-img、mk-title 和 mk-sub。"),
  side: copy("mk-side：左窄右宽两栏。"),
  badge: copy("mk-badge：圆角小标签。"),
  canvas: copy("mk-canvas：虚线框的预览区。"),
  note: copy("mk-note：一句红色小字，指出改的地方。"),
};

/** 线稿字段说明结尾的一句，指到积木清单。 */
const sketchPointer = copy("可用的积木见 ploop page schema --blocks。");

/** 区块的说明，接在区块名后面。 */
const section = {
  align: copy("先对齐：这一页的选项要用到的新词。每个词写意思和例子，用户点明白或不明白。"),
  scenes: copy("场景清单：要用户删改的场景草稿。每个场景点保留、修改或删除。"),
  spec: copy("设计规范：要用户删改的规范草稿，画成样张。每一格点保留、修改或删除。"),
  asks: copy("疑问：要用户定的事，或者要追问的事。每张卡一件事。"),
  findings: copy("发现问题：检查阶段找出的问题。每张卡写哪里不对，并给选项。"),
  improvements: copy("提升：从整个产品看，还能留、加、删、重构或理清的地方。每张卡给选项。"),
  changes: copy("更改：落地阶段改完的事，给用户验收。每条写之前哪里不对、现在什么样，配改前改后。"),
  refs: copy("参考：构思调研时看过的外部资料。只给人看，不用点。"),
  screens: copy("元素清单：检查阶段逐屏列出屏上的每样东西。页面上不显示。"),
};

/** 疑问、发现问题、提升三种卡共有的字段，和它们各自多出的字段。 */
const card = {
  id: copy("卡片编号，小写英文加短横。不写时由命令按标题生成。"),
  queue: copy(
    '这张卡处理的队列事项，编号的数组，例如 ["Q12"]。拿出来又成立的事，每件都要写进某张卡。',
  ),
  title: copy("一个名字，不超过 16 个字，不写成句子。说这张卡是哪件事，解释写进 why。"),
  tag: copy("一个短语，说这条属于哪一类，显示在标题旁边。例如检查的三个根问题之一。"),
  why: copy("含义随卡的种类变。疑问写待决定的事，发现问题写哪里不对，提升写替用户解决什么。"),
  sources: copy("这张卡的依据，至少一条。每条只写一样东西。没看过的不写。"),
  design: copy("设计类的卡写 true，指长什么样、怎么摆的问题。只有构思阶段会查来源和草稿。"),
  options: copy(
    "选项，两到三个。每个选项按 rows 逐行写差别。不写选项时，这张卡只有备注框，用来追问已经发生的事。",
  ),
  rows: copy(
    "选项之间有差别的地方，每处一个名称，不超过八个字。选项的 diffs 按这个顺序一行对一行。",
  ),
  shared: copy("几个选项共同的部分，只写一遍。有两个以上选项时必填。"),
  only: copy("只有一个方向站得住时写 true。options 只放这一个，dropped 列出排除的方向。"),
  dropped: copy("想过又排除的方向，每个写名称和一句原因。用户可以在备注里点名捞回来。"),
  stance: copy("我的看法：选哪个、因为什么。先写完所有选项，最后才写看法。"),
  evidence: copy("证据，画在卡片右边。只放能看的东西，不放说明文字。一项也写成数组。"),
  image: copy("一张图，直接显示在右边。"),
  mock: copy("中保真线稿，画改完的样子，用真文字，HTML 片段。"),
  mockCaption: copy("线稿下面的一句说明，只能和 mock 一起写。"),
  flow: copy("操作流程，每步一句，画成一串带箭头的步骤。"),
  diagrams: copy("图表。种类要和内容对得上，例如流程配流程图。"),
  where: copy("这件事出现在主线的哪个场景的第几步。发现问题和提升必填，疑问可以不写。"),
  research: copy("调研分档。来源里有外面的东西的疑问卡必填。先定下查多深，再去查。"),
};

const research = {
  tier: copy("不查、快查、深查三选一。不查要写 reason，深查要写 approved。"),
  reason: copy("不查时写理由，说明这一条为什么不用查。"),
  approved: copy("深查时写问句和检索计划是哪个阶段给用户批的，例如第 2 版的构思阶段。"),
};

const option = {
  key: copy("选项的字母，依次写 a、b、c。用户的回复用它指出选了哪个选项。"),
  title: copy("一个名字，不超过 16 个字，不写成句子。写这个选项叫什么，不用颜色或阵营称呼选项。"),
  diffs: copy("这个选项在每一行上的做法，和卡上的 rows 一一对应。每格最多两行。"),
  why: copy("理由：它去掉的是哪个根因，指到数据或代码里的事实。最后一个选项叫「不改」时可以不写。"),
  cost: copy("代价：选它要放弃什么。不写它为什么不如别的选项。最后一个选项叫「不改」时可以不写。"),
  when: copy("适用场景：什么情况下该选它。说不出来的选项是陪衬，删掉。叫「不改」的可以不写。"),
  sketch: copy("低保真线稿，HTML 片段，也可以放一张草稿图的 img 标签。设计类的卡每个选项都要有。"),
};

const stance = {
  pick: copy("看法选的是哪个选项，写它的字母。"),
  because: copy("因为什么，一句话。页面显示成我的看法是 a，因为……"),
};

const source = {
  name: copy("这样东西叫什么。"),
  saw: copy("在它上面看到了什么。用户的原话来源，在这里照原样写出原话。"),
  img: copy("界面来源的截图，写相对工作区的路径，例如 img/before.png。"),
  outside: copy("截图来自已有的产品或网上的设计时写 true。设计类的卡至少要有一条。"),
  file: copy("文字来源的文件，写相对项目根目录的路径。原文由命令摘录。"),
  lines: copy("摘哪几行，写成 12-20。只摘一行写 12。"),
  mark: copy("要标出的行号，都在 lines 的范围里。"),
  quote: copy("用户说过的原话写 true，原话写在 saw 里，不配图。"),
};

const where = {
  scene: copy("场景编号，例如 S3。"),
  step: copy("步号，从 1 数，和主线里这个场景的步骤编号相同。"),
};

const figure = {
  img: copy("图的路径，相对页面数据所在的工作区，例如 img/before.png。"),
  caption: copy("图下面的一行说明。"),
};

const shared = {
  text: copy("共同部分的文字。"),
  diagrams: copy("共同部分的图表。"),
};

const dropped = {
  name: copy("排除的方向叫什么。"),
  because: copy("为什么排除，一句话。"),
};

const diagram = {
  kind: copy("图表的种类，从取值里选，按内容配。"),
  title: copy("一个名字，不超过 16 个字，不写成句子。写这张图叫什么。"),
  code: copy("图表库的文字定义。目录树直接写文字。"),
};

const evidence = {
  type: copy("证据的种类。"),
  caption: copy("图下面的一行说明。"),
  unit: copy("数值的单位，例如 px。"),
  values: copy("要画的取值。尺寸和间距写数字，色块写名称和色值，字号写字号、字重和样张。"),
  keep: copy("留下的取值，会上色。其余的画成灰色。"),
  img: copy("截图的路径，相对工作区。"),
  from: copy("真组件从哪一屏、哪个组件取来。"),
  html: copy("从真实界面取来的 HTML。"),
  css: copy("这个组件生效的样式。"),
  toggles: copy("真组件下面的按钮，用来切类名或改属性。悬停和聚焦不用写。"),
  height: copy("框的高度，默认 160。"),
  bg: copy("框的底色，默认白色。深色主题的组件要写。"),
  toggleLabel: copy("按钮上的字。"),
  toggleSelector: copy("按下按钮时，改哪个元素，写 CSS 选择器。"),
  toggleClass: copy("按下按钮时，给这个元素加或去掉的类名。"),
  toggleAttr: copy("按下按钮时，改这个元素的哪个属性。"),
  toggleOn: copy("属性打开时的值。"),
  toggleOff: copy("属性关闭时的值。"),
};

const scene = {
  scene: copy("场景编号，例如 S3。新场景不写，收进主线时由命令补上。"),
  name: copy("场景的名字。"),
  who: copy("谁在什么时候用。"),
  mark: copy("名字旁边的小标记，例如新、改过。"),
  steps: copy("场景的每一步，按顺序写。"),
  do: copy("这一步做什么。"),
  expect: copy("这一步该看到什么。"),
  img: copy("这一步的截图，相对工作区。"),
};

const spec = {
  kind: copy(
    "这一格的种类。颜色、字号、圆角、间距、动效画成样张，表格一行一条规范，说不成样张的写文字。",
  ),
  name: copy("这一格规范的名字。"),
  for: copy("用在哪个组件上。新写的页面必填。"),
  note: copy("一句补充，显示在名字旁边。"),
  values: copy("这一格的取值，每个取值一项。"),
  text: copy("说不成样张的，写一条规则或一个例子，不超过三行。"),
  columns: copy("表格的列。as 决定这一列的格子怎么画。"),
  rows: copy("表格的行，一行一条规范。每行的格数和列数一样多。"),
  hex: copy("色值，写成 # 加十六进制数。"),
  size: copy("字号，单位是像素。"),
  weight: copy("字重，例如 400、600。"),
  sample: copy("样张上的字，用项目里的真文字。"),
  ms: copy("时长，单位是毫秒。"),
  easing: copy("缓动曲线的名字。"),
  effect: copy("点一下样张时小方块怎么动：移动、淡入或放大。"),
  as: copy("这一列的格子怎么画：加粗、色块、正例、反例或旧叫法。"),
  tone: copy("状态标签的色调，取队列的五种状态之一。"),
  cellText: copy("状态标签上的字。"),
};

const align = {
  name: copy("术语的名称，全篇只用这一个。"),
  usedIn: copy("用到它的疑问卡的标题，要和本页的标题对得上。"),
  meaning: copy("意思，一句话，用大白话。"),
  example: copy("例子，这个项目里的一件真事。"),
  diagram: copy("一张图，文字讲不清时用。"),
};

const change = {
  title: copy("一个名字，不超过 16 个字，不写成句子。写这件改动叫什么，做了什么写进 fix。"),
  problem: copy("之前哪里不对。"),
  fix: copy("现在什么样。"),
  before: copy("改前的图。界面的更改用它，之前没有图时不写。"),
  after: copy("改后的图。界面的更改必填。"),
  more: copy("补充的改后图。"),
  textName: copy("文字的更改里，这一段叫什么。"),
  textBefore: copy("文字的改前原文。文字的更改必填，逐行对比由后端算。"),
  textAfter: copy("文字的改后原文。文字的更改必填。"),
};

const ref = {
  name: copy("这份资料叫什么。"),
  kind: copy("资料的种类。"),
  depth: copy("读到了哪一步：已读原文，或者仅摘要。"),
  relevance: copy("和这个项目的相关度。"),
  strength: copy("证据的强度。"),
  advice: copy("建议：采用、试用、观察或不用。"),
  body: copy("它说了什么，以及这个项目用到了哪一条。"),
  where: copy("用在这个项目的哪里。"),
};

const screen = {
  name: copy("这一屏的名字。"),
  where: copy("这一屏是哪个场景的第几步。新写的页面必填。"),
  elements: copy("屏上的每样东西，一样一行，模板写死的字和每一块的名字也要列。"),
  what: copy("这样东西是什么。"),
  answers: copy("它替用户回答什么问题，或让用户做什么。答不出来就写「答不出」。"),
};

export const pageFieldCopy = {
  sketchBlocks,
  sketchPointer,
  section,
  card,
  research,
  option,
  stance,
  source,
  where,
  figure,
  shared,
  dropped,
  diagram,
  evidence,
  scene,
  spec,
  align,
  change,
  ref,
  screen,
};
