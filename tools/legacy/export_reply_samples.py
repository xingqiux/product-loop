#!/usr/bin/env python3
"""用旧模板的 compose() 生成回复文字的样本，连同页面数据和用户的点选导出成一份 JSON，给新的解析做对照。

用法：python3 tools/legacy/export_reply_samples.py [--skill 旧 skill 的目录] [--tag v1-final] [--out 输出文件]

旧代码从 git 标签里取出，放进临时目录再跑。旧 skill 的目录只读，不写。
compose() 是报告网页里拼出复制文字的函数。它读网页上的几样元素：每张卡选了什么、备注、
场景和规范的三个按钮、先对齐、队列里取消的事、想法框、存下的图。
脚本在 Node 里按模板画出来的样子摆出这几样元素，原样运行 compose()，取出复制框里的文字。
写文件之前核对：compose() 只找到一处，两次运行的结果逐字相同，每一种行至少出现在一份样本里。
"""
import argparse
import copy
import hashlib
import json
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # 引用同目录的 export_samples.py，不在仓库里留下 __pycache__
from export_samples import ExportError, extract  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_SKILL = Path("~/.agents/skills/product-loop").expanduser()
DEFAULT_TAG = "v1-final"
DEFAULT_OUT = HERE / "out" / "reply-cases.json"
APP = "templates/report/10-app.js"
SAMPLE = "templates/report/sample.json"

# compose() 在 10-app.js 里的写法：以这一行开头，到缩进相同的「};」为止
COMPOSE_START = "  const compose = () => {"
COMPOSE_END = "  };"

# ---------- 页面数据 ----------
# sample 就是模板自带的样例数据 sample.json，阶段是改名以前的「修复」。
# 它没有场景清单、设计规范、先对齐和只有一个方向的卡。看板也不在页面数据里，第十三版起由构建校验摆进来。
# think 在它的基础上把阶段改成构思，照模板 README 的字段补上这几样。场景清单和设计规范只在构思阶段画出来。
# 看板上每件事的文字前面写 Q 编号，照第一期约定第 9 条，后端给旧模板的数据就是这样写的。

ONLY_CARD = {
    "title": "每一页交出去之前，先自己挑一遍刺",
    "why": "页面交出去以后才发现的问题，要多走一轮。",
    "sources": [{"name": "上一轮的回复", "saw": "第 3 张卡的截图是旧的。", "quote": True}],
    "only": True,
    "rows": ["什么时候挑"],
    "options": [{"key": "a", "title": "交出去之前挑一遍", "diffs": ["生成网页以后、发出去之前"],
                 "why": "用户看到的是挑过的一版。", "cost": "每一页多花几分钟。", "when": "每一页都这样做。"}],
    "dropped": [{"name": "交出去以后再挑", "because": "用户已经看过了，改了还要再看一遍。"}],
}
THINK_EXTRA = {
    "scenes": [
        {"name": "S1 看所有项目停在哪", "who": "用户，早上打开电脑时",
         "steps": [{"do": "打开项目页", "see": "每个项目一行，写着停在哪一轮"}]},
        {"name": "等待和出错（断网）", "steps": [{"do": "断网以后刷新", "see": "页面写明没有连上，点过的还在"}]},
        {"name": "回头改一笔、撤一批", "steps": [{"do": "在列表里点一笔", "see": "能改金额和备注"}]},
    ],
    "spec": [
        {"name": "配色", "kind": "colors", "for": "整个页面",
         "values": [{"name": "底", "hex": "#ffffff"}, {"name": "强调", "hex": "#2f6fed"}]},
        {"name": "字号", "kind": "type", "for": "正文和标题",
         "values": [{"name": "正文", "size": 14}, {"name": "标题", "size": 18, "weight": 600}]},
        {"name": "动效", "kind": "motion", "for": "换一屏",
         "values": [{"name": "换一屏", "ms": 200, "easing": "ease-out", "effect": "fade"}]},
    ],
    "align": [
        {"name": "交付线", "usedIn": [ONLY_CARD["title"]], "meaning": "这一版做到哪里算交付。",
         "example": "个人网站的第一版只做首页和项目页。"},
        {"name": "胃口", "usedIn": [ONLY_CARD["title"]], "meaning": "这一版愿意花多少时间。",
         "example": "第一版只花三个晚上。"},
    ],
}
QUEUE = [
    {"stage": "构思", "text": "Q3 队列看板的等待列", "from": "用户", "state": "待办", "note": "",
     "since": "2026-09-20", "dep": "", "accept": "", "proof": "", "items": [], "origin": ""},
    {"stage": "落地", "text": "Q5 把「修复」改名成「落地」", "from": "AI", "state": "进行中", "note": "",
     "since": "2026-09-21", "dep": "", "accept": "", "proof": "", "items": [], "origin": ""},
    {"stage": "提升", "text": "Q8 窄屏上的回复框", "from": "用户", "state": "等待", "note": "",
     "since": "2026-09-22", "dep": "用户", "accept": "", "proof": "", "items": [], "origin": ""},
]


def pages_from(sample: dict) -> dict:
    base = copy.deepcopy(sample)
    base["queue"] = copy.deepcopy(QUEUE)
    think = copy.deepcopy(base)
    think["stage"] = "构思"
    think["round"] = 3
    think["asks"].append(copy.deepcopy(ONLY_CARD))
    think.update(copy.deepcopy(THINK_EXTRA))
    return {"sample": base, "think": think}


# ---------- 用户的点选 ----------
# 每份样本是一页上的一组点选。cards 按卡的 data-key 写，例如 q1、f1；pick 是选项的 key 或「否决」。
# scenes、spec、align 按页面上的序号写 n；queue 按点「取消这一项」的先后写看板上的文字。
# images 写存下的图的序号，标识由脚本按序号算出。图的标记要自己写进备注或想法里，和用户粘贴时一样。

def image_id(n: int) -> str:
    """图的标识。后端存图用 SHA-256，这里用「图 n」的哈希，重跑结果不变"""
    return hashlib.sha256(f"图 {n}".encode()).hexdigest()


EVERYTHING = {
    "scenes": [{"n": 1, "pick": "保留"}, {"n": 2, "pick": "修改", "edit": "第 2 步改成先断网再刷新"},
               {"n": 3, "pick": "删除"}],
    "spec": [{"n": 1, "pick": "修改", "edit": "强调色换成绿色〔图 1〕"}, {"n": 2, "pick": "保留"},
             {"n": 3, "pick": "保留"}],
    "align": [{"n": 1, "pick": "明白"}, {"n": 2, "pick": "不明白", "say": "是说花多少时间吗"}],
    "queue": ["Q8 窄屏上的回复框"],
    "cards": [{"key": "q1", "pick": "b", "note": "两套都留着"}, {"key": "q2", "note": "上周，用的是 Keynote"},
              {"key": "q3", "pick": "a"}, {"key": "f1", "pick": "c"}, {"key": "r1", "pick": "b"},
              {"key": "p1", "pick": "a", "note": "先做一个最小的\n下一轮再加筛选"}],
    "ideas": "看板上等待的事可以单独放一列\n〔图 2〕是现在的样子",
    "images": [1, 2],
}

CASES = (
    ("什么都没点", "sample", {}),
    ("疑问点了选项", "sample", {"cards": [{"key": "q1", "pick": "a"}]}),
    ("选了选项，又写了备注", "sample", {"cards": [{"key": "q1", "pick": "b", "note": "两套各有用处，先都留着"}]}),
    ("只有备注框的卡写了备注", "sample", {"cards": [{"key": "q2", "note": "上周五，用的是 Keynote"}]}),
    ("有选项的卡没点选项，只写了备注", "sample", {"cards": [{"key": "q1", "note": "两个都不对，下一轮再谈"}]}),
    ("四块各点一张", "sample", {"cards": [{"key": "q1", "pick": "a"}, {"key": "f1", "pick": "c"},
                                    {"key": "p1", "pick": "b", "note": "先不加"}, {"key": "r1", "pick": "a"}]}),
    ("备注写了几行，有括号，也有空两格", "sample", {"cards": [
        {"key": "q2", "note": "第一行写的是去年（大概十月）\n第二行接着说  还有 2b 那件事\n3. 最后一行"},
        {"key": "f1", "pick": "a", "note": "按（附录）里的做"},
        {"key": "p1", "pick": "b"}]}),
    ("只有一个方向的卡点了那个方向", "think", {"cards": [{"key": "q3", "pick": "a"}]}),
    ("只有一个方向的卡点了否决，写了原因", "think", {"cards": [{"key": "q1", "pick": "b"},
                                                    {"key": "q3", "pick": "否决", "note": "挑刺交给评审去做"}]}),
    ("场景点了保留、修改和删除", "think", {"scenes": [{"n": 1, "pick": "保留"},
                                                {"n": 2, "pick": "修改", "edit": "第 2 步改成先断网再刷新"},
                                                {"n": 3, "pick": "删除"}]}),
    ("场景点了修改，没写怎么改", "think", {"scenes": [{"n": 1, "pick": "修改"}, {"n": 3, "pick": "修改", "edit": "  "}]}),
    ("设计规范点了保留、修改和删除，修改写了两行", "think", {"spec": [
        {"n": 1, "pick": "保留"}, {"n": 2, "pick": "修改", "edit": "正文改成 15px\n标题改成 20px"},
        {"n": 3, "pick": "删除"}]}),
    ("设计规范点了修改，没写怎么改", "think", {"spec": [{"n": 3, "pick": "修改"}]}),
    ("先对齐点了明白和不明白", "think", {"align": [{"n": 1, "pick": "明白", "say": "交付线就是这一版做到哪里"},
                                           {"n": 2, "pick": "不明白"}]}),
    ("队列里取消了两件", "think", {"queue": ["Q5 把「修复」改名成「落地」", "Q3 队列看板的等待列"]}),
    ("想法写了几行", "sample", {"ideas": "列表视图可以按日期分组\n\n另外，窄屏上回复框太小"}),
    ("备注和想法里贴了图，有一张的标记又删掉了", "sample", {
        "cards": [{"key": "q1", "pick": "a", "note": "像这样〔图 1〕"}],
        "ideas": "这里也不对〔图 2〕〔图 3〕", "images": [1, 2, 3, 4]}),
    ("场景的修改里贴了图", "think", {"scenes": [{"n": 2, "pick": "修改", "edit": "改成这样〔图 1〕"}], "images": [1]}),
    ("所有的行都有", "think", EVERYTHING),
)

# compose() 能产生的每一种行，按整份文字匹配。每一种至少要出现在一份样本里，否则不写文件
CARD = r"(?:疑问|发现|提升|回到构思)"
SHAPES = (
    ("empty", "什么都没点时的占位文字", r"\A还没有要复制的内容\Z"),
    ("header", "第一行：阶段和第几轮", r"\A(?:构思|使用|检查|落地|提升)第 \d+ 轮$"),
    ("header.renamed", "第一行的阶段是改名以前的「修复」", r"\A修复第 \d+ 轮$"),
    ("scenes.keep", "场景 保留", r"^场景 保留：「"),
    ("scenes.modify", "场景 修改，写了怎么改", r"^场景 修改：.*」（(?!没写怎么改）)"),
    ("scenes.modifyBlank", "场景 修改，没写怎么改", r"^场景 修改：.*（没写怎么改）"),
    ("scenes.remove", "场景 删除", r"^场景 删除：「"),
    ("spec.keep", "规范 保留", r"^规范 保留：「"),
    ("spec.modify", "规范 修改，写了怎么改", r"^规范 修改：.*」（(?!没写怎么改）)"),
    ("spec.modifyBlank", "规范 修改，没写怎么改", r"^规范 修改：.*（没写怎么改）"),
    ("spec.remove", "规范 删除", r"^规范 删除：「"),
    ("align.understood", "对齐 明白", r"^对齐 明白：「"),
    ("align.notUnderstood", "对齐 不明白", r"^对齐 不明白：「"),
    ("align.say", "对齐带着用户自己的话", r"^对齐 (?:明白|不明白)：「[^」]*」（"),
    ("queue.drop", "队列 不做了", r"^队列 不做了：「"),
    ("card.option", "卡片选了选项", rf"^{CARD} (?:[^\n]*  )?\d+[a-z](?:  |$)"),
    ("card.optionNote", "选了选项，写了备注", rf"^{CARD} (?:[^\n]*  )?\d+[a-z]（"),
    ("card.noteOnly", "只写了备注", rf"^{CARD} (?:[^\n]*  )?\d+（"),
    ("card.veto", "只有一个方向的卡点了否决", rf"^{CARD} (?:[^\n]*  )?\d+否决"),
    ("card.noteLines", "备注写了几行", rf"^{CARD} [^\n]*（[^）\n]*\n"),
    ("block.asks", "疑问", r"^疑问 \d"),
    ("block.findings", "发现", r"^发现 \d"),
    ("block.improvements", "提升", r"^提升 \d"),
    ("block.rethink", "回到构思", r"^回到构思 \d"),
    ("idea", "想法", r"^想法："),
    ("idea.lines", "想法写了几行", r"^想法：[^\n]*\n(?!图：)"),
    ("image.mark", "备注和想法里的图的标记", r"〔图 \d+〕"),
    ("images", "最后一行：图的序号和标识的前六位", r"^图：图 \d+=[0-9a-f]{6}(?:  图 \d+=[0-9a-f]{6})*\Z"),
)

# ---------- 在 Node 里运行 compose() ----------
# compose() 用到的外面的名字只有下面七个。缺了哪个，运行时会报错，不会悄悄算错。
HARNESS = r"""
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8"));
const make = new Function("document", "saved", "qDropped", "data", "storeKey", "localStorage", "remaining",
  `${input.compose}\nreturn compose;`);
const classList = () => ({ toggle() {} });
const checked = (value) => (value ? { value } : null);

// 按 10-app.js 画出来的样子摆出 compose() 会读的元素。只摆它读的那几样，顺序和网页上的相同
function page(data, actions) {
  const cards = [];
  const warns = [];
  const blocks = [["q", data.asks], ["f", data.findings], ["p", data.improvements], ["r", data.rethink]];
  const known = new Set();
  for (const [prefix, list] of blocks) {
    (list || []).forEach((f, i) => {
      const key = `${prefix}${i + 1}`;
      known.add(key);
      const act = (actions.cards || []).find((a) => a.key === key) || {};
      const opts = f.options || [];
      // 选项画成单选框，值是 key。只有一个方向的卡另有一个「否决」
      const values = [...opts.map((o) => String(o.key)), ...(opts.length && f.only ? ["否决"] : [])];
      if (act.pick && !values.includes(act.pick)) throw new Error(`${key} 没有「${act.pick}」`);
      const note = { value: act.note || "" };
      cards.push({
        dataset: { key, n: String(i + 1) },
        querySelector: (sel) => (sel === "input:checked" ? checked(act.pick) : sel === "textarea" ? note : null),
      });
      if (prefix === "q") warns.push({ dataset: { title: f.title }, hidden: true, textContent: "" });
    });
  }
  for (const a of actions.cards || []) if (!known.has(a.key)) throw new Error(`没有 ${a.key} 这张卡`);
  // 场景清单和设计规范只在构思阶段画出来
  const think = data.stage === "构思";
  const verdicts = (list, prefix, editClass, acts, name) => {
    for (const a of acts || []) if (!list[a.n - 1]) throw new Error(`${name}没有第 ${a.n} 项`);
    return list.map((x, i) => {
      const act = (acts || []).find((a) => a.n === i + 1) || {};
      if (act.pick && !["保留", "修改", "删除"].includes(act.pick)) throw new Error(`${name}没有「${act.pick}」`);
      const edit = { value: act.edit || "", hidden: true };
      return {
        id: `${prefix}${i + 1}`,
        dataset: { name: x.name },
        classList: classList(),
        querySelector: (sel) => (sel === "input:checked" ? checked(act.pick) : sel === editClass ? edit : null),
      };
    });
  };
  const scn = verdicts(think ? data.scenes || [] : [], "s", ".scn-edit", actions.scenes, "场景清单");
  const spi = verdicts(think ? data.spec || [] : [], "g", ".spi-edit", actions.spec, "设计规范");
  const alignList = data.align || [];
  for (const a of actions.align || []) if (!alignList[a.n - 1]) throw new Error(`先对齐没有第 ${a.n} 项`);
  const al = alignList.map((x, i) => {
    const act = (actions.align || []).find((a) => a.n === i + 1) || {};
    if (act.pick && !["明白", "不明白"].includes(act.pick)) throw new Error(`先对齐没有「${act.pick}」`);
    const say = { value: act.say || "" };
    return {
      id: `a${i + 1}`,
      dataset: { name: x.name, used: JSON.stringify(x.usedIn || []) },
      querySelector: (sel) => (sel === "input:checked" ? checked(act.pick) : sel === ".al-say" ? say : null),
    };
  });
  const board = (data.queue || []).map((x) => x.text);
  for (const t of actions.queue || []) if (!board.includes(t)) throw new Error(`看板上没有「${t}」`);
  const all = { ".card": cards, ".scn": scn, ".spi": spi, ".al": al, ".al-warn": warns };
  const out = { textContent: "", classList: classList() };
  const byId = { "ideas-bar": { value: actions.ideas || "" }, "reply-text": out };
  const document = {
    querySelectorAll: (sel) => {
      if (!(sel in all)) throw new Error(`compose() 读了没有摆出来的元素：${sel}`);
      return all[sel];
    },
    getElementById: (id) => {
      if (!(id in byId)) throw new Error(`compose() 读了没有摆出来的元素：#${id}`);
      return byId[id];
    },
  };
  return { document, out };
}

const texts = input.runs.map(({ data, actions }) => {
  const { document, out } = page(data, actions);
  const saved = { imgs: (actions.images || []).map((x) => ({ ...x })) };
  const qDropped = new Set(actions.queue || []);
  const storage = { getItem: () => null, setItem() {} };
  make(document, saved, qDropped, data, "walk-reply:样本", storage, () => null)();
  return out.textContent;
});
process.stdout.write(JSON.stringify(texts));
"""


def compose_source(app: str) -> tuple:
    """取出 compose() 的原文，返回原文和它在 10-app.js 里的起止行号"""
    lines = app.split("\n")
    starts = [i for i, line in enumerate(lines) if line == COMPOSE_START]
    if len(starts) != 1:
        raise ExportError(f"{APP} 里以「{COMPOSE_START.strip()}」开头的行有 {len(starts)} 处，应当正好一处")
    start = starts[0]
    end = next((i for i in range(start + 1, len(lines)) if lines[i] == COMPOSE_END), None)
    if end is None:
        raise ExportError(f"{APP} 里 compose() 没有收尾的「{COMPOSE_END.strip()}」")
    src = "\n".join(lines[start:end + 1])
    if src.count("{") != src.count("}"):
        raise ExportError("取出的 compose() 花括号不配对，取的范围不对")
    return src, start + 1, end + 1


def run_compose(node: str, harness: Path, src: str, runs: list) -> list:
    p = subprocess.run([node, str(harness)], input=json.dumps({"compose": src, "runs": runs}, ensure_ascii=False),
                       capture_output=True, text=True, encoding="utf-8")
    if p.returncode:
        raise ExportError(f"在 Node 里运行 compose() 失败：\n{p.stderr.strip()}")
    return json.loads(p.stdout)


def expand(actions: dict) -> dict:
    """点选里的图只写了序号，补上标识"""
    out = copy.deepcopy(actions)
    if "images" in out:
        out["images"] = [{"n": n, "id": image_id(n)} for n in out["images"]]
    return out


def export(skill: Path, tag: str, out: Path) -> None:
    node = shutil.which("node")
    if node is None:
        raise ExportError("找不到 node。这个脚本要用 Node 运行旧模板的 JavaScript")
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        old = Path(tmp) / "old"
        commit = extract(skill, tag, old)
        src, first, last = compose_source((old / APP).read_text(encoding="utf-8"))
        pages = pages_from(json.loads((old / SAMPLE).read_text(encoding="utf-8")))
        harness = Path(tmp) / "harness.mjs"
        harness.write_text(HARNESS, encoding="utf-8")
        cases = [{"id": f"reply-{n:03d}", "name": name, "page": page, "actions": expand(actions)}
                 for n, (name, page, actions) in enumerate(CASES, 1)]
        runs = [{"data": pages[c["page"]], "actions": c["actions"]} for c in cases]
        texts = run_compose(node, harness, src, runs)
        if run_compose(node, harness, src, runs) != texts:
            problems.append("两次运行 compose() 的结果不一样")
    for c, text in zip(cases, texts):
        c["text"] = text

    shapes = []
    for sid, name, pattern in SHAPES:
        hits = [c["id"] for c in cases if re.search(pattern, c["text"], re.M)]
        if not hits:
            problems.append(f"没有一份样本有「{name}」这种行（{sid}）")
        shapes.append({"id": sid, "name": name, "cases": hits})

    doc = {
        "exported_from": tag,
        "commit": commit,
        "function": f"{APP}:{first}-{last} compose",
        "sample": SAMPLE,
        "count": len(cases),
        "shapes": shapes,
        "pages": pages,
        "cases": cases,
    }
    text = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    if json.loads(text) != doc:
        problems.append("写出的 JSON 读回来和原来的不一样")
    if problems:
        raise ExportError("核对没有通过，没有写文件：\n" + "\n".join(problems))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    report(doc, out)


def report(doc: dict, out: Path) -> None:
    print(f"用 {doc['exported_from']}（{doc['commit'][:7]}）的 {doc['function']} 生成了 {doc['count']} 份回复文字。")
    print(f"{len(doc['shapes'])} 种行，每种至少出现在一份样本里。")
    print(f"写到 {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description="用旧模板的 compose() 生成回复文字的样本，导出成 JSON")
    ap.add_argument("--skill", type=Path, default=DEFAULT_SKILL, help=f"旧 skill 的 git 仓库，默认 {DEFAULT_SKILL}")
    ap.add_argument("--tag", default=DEFAULT_TAG, help=f"取哪个标签的代码，默认 {DEFAULT_TAG}")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"输出文件，默认 {DEFAULT_OUT}")
    a = ap.parse_args()
    try:
        export(a.skill.expanduser(), a.tag, a.out)
    except ExportError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
