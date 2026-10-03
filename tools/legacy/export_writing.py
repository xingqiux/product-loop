#!/usr/bin/env python3
"""用旧 skill 的写作校验跑一批文字，连同输入导出成一份 JSON，给移植过去的新代码做对照。

用法：python3 tools/legacy/export_writing.py [--skill 旧 skill 的目录] [--tag v1-final] [--out 输出文件] [--root 找历史页面的目录 ...]

旧代码从 git 标签里取出，放进临时目录再跑。旧 skill 的目录和各项目的目录只读，不写。
文字有六类：旧正文、参考文件、历史页面里的文字、手写的边界情况、check-reply.py 自带的样本、手写的回复。
前四类跑 writing.py 的 check 和 build-report.py 的措辞提醒，后两类跑 check-reply.py 的 problems。
另外算一批字符串的长度和宽度，给移植过去的两个度量函数做对照。
写文件之前核对五件事，见 tools/legacy/README.md 第三节。
"""
import argparse
import ast
import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path

sys.dont_write_bytecode = True  # 引用同目录的两个导出脚本，不在仓库里留下 __pycache__
from export_diff import DEFAULT_ROOTS, find_pages, page_data, page_label  # noqa: E402
from export_samples import ExportError, extract, load_module  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_SKILL = Path("~/.agents/skills/product-loop").expanduser()
DEFAULT_TAG = "v1-final"
DEFAULT_OUT = HERE / "out" / "writing-cases.json"

WRITING = "scripts/writing.py"
GATE = "scripts/build-report.py"
REPLY = "scripts/check-reply.py"
SKILL_MD = "SKILL.md"
REFERENCES = "references"

# 旧构建校验取页面文字的两处：check_writing 跑写作校验，wording_notes 跑措辞提醒。区块按 v1-final 的第 100 行和第 61 行
PROSE_BLOCKS = ("align", "changes", "current", "progress", "queue", "screens", "usage", "scenes")
TEXT_BLOCKS = ("changes", "current", "progress", "queue", "screens", "usage", "scenes", "spec")
# 措辞提醒的原文写着页面上的位置。把文字放进 current 区块再跑，位置就是 current，导出时去掉这一段
WORDING_PREFIX = "提醒：current 里"
# 历史页面的编号取文字的哈希，页面增加时已有的编号不变
HASH_LEN = 10
KINDS = ("skill", "reference", "page", "edge", "selftest", "reply")


# ---------- 旧正文和参考文件 ----------

def paragraphs(text: str):
    """按空行切成段，返回段落和它的起始行号"""
    block, start = [], 0
    for n, line in enumerate(text.split("\n"), 1):
        if line.strip():
            if not block:
                start = n
            block.append(line)
        elif block:
            yield start, "\n".join(block)
            block = []
    if block:
        yield start, "\n".join(block)


def doc_cases(old: Path) -> tuple:
    """旧正文 SKILL.md 和 references/ 下的参考文件，每段一份"""
    skill = [{"source": f"{SKILL_MD}:{n}", "text": p} for n, p in paragraphs((old / SKILL_MD).read_text(encoding="utf-8"))]
    refs = []
    for f in sorted((old / REFERENCES).glob("*.md")):
        refs += [{"source": f"{REFERENCES}/{f.name}:{n}", "text": p} for n, p in paragraphs(f.read_text(encoding="utf-8"))]
    return skill, refs


# ---------- 历史页面 ----------

def texts_in(node, path: str, skip_keys: set, skip_quote: bool):
    """和旧的 walk_prose（skip_quote 为真）、walk_text 取同样的字，另外记下每段字在数据里的位置"""
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, list):
        for i, x in enumerate(node):
            yield from texts_in(x, f"{path}[{i}]", skip_keys, skip_quote)
    elif isinstance(node, dict):
        if skip_quote and node.get("quote"):
            return
        for k, v in node.items():
            if k not in skip_keys:
                yield from texts_in(v, f"{path}.{k}", skip_keys, skip_quote)


def cells_in(node):
    """对照表的行名（rows）和选项的每一格（diffs）。旧构建校验对前者量宽度，对后者量长度"""
    if isinstance(node, list):
        for x in node:
            yield from cells_in(x)
    elif isinstance(node, dict):
        for k, v in node.items():
            if k in ("rows", "diffs") and isinstance(v, list):
                yield from (x for x in v if isinstance(x, str))
            else:
                yield from cells_in(v)


def page_cases(gate, roots: list) -> tuple:
    """历史页面里旧构建校验会读的文字。相同的文字只留一份，出处取排在最前的一处。
    出处写成页面在 pages 里的序号加上在数据里的位置，页面的路径只在 pages 里写一次"""
    found, cells, problems = {}, set(), []
    stats = {"files": 0, "places": 0, "projects": set()}
    for path in find_pages(roots):
        data = page_data(path)
        if not (isinstance(data, dict) and "stage" in data):
            continue  # walk 文件夹里还有使用记录、量到的事实这些数据，它们不是页面，旧构建校验不读
        label, places = page_label(path), set()
        for blocks, skip_quote, walk in ((PROSE_BLOCKS, True, gate.walk_prose), (TEXT_BLOCKS, False, gate.walk_text)):
            for blk in gate.CARD_BLOCKS + blocks:
                mine = list(texts_in(data.get(blk), blk, gate.SKIP_KEYS, skip_quote))
                if [t for _, t in mine] != [t for _, t in walk(data.get(blk), blk)]:
                    problems.append(f"{label} 的 {blk} 取出的文字和旧代码的 {walk.__name__} 不同")
                for where, text in mine:
                    found.setdefault(text, set()).add((label, where))
                    places.add(where)
        cells.update(cells_in(data))
        if places:
            stats["files"] += 1
            stats["places"] += len(places)
            stats["projects"].add(label.split("/")[0])  # 出处从项目的文件夹写起，第一段就是项目
    if problems:
        raise ExportError("取页面文字的方法和旧代码对不上：\n" + "\n".join(problems))
    if not found:
        raise ExportError(f"在 {', '.join(map(str, roots))} 下没有找到历史页面，检查 --root")
    firsts = sorted((min(v), k) for k, v in found.items())
    labels = sorted({label for (label, _), _ in firsts})
    index = {label: i for i, label in enumerate(labels)}
    cases = [{"page": index[label], "where": where, "text": text} for (label, where), text in firsts]
    stats["projects"] = sorted(stats["projects"])
    return cases, labels, sorted(cells), stats


# ---------- 手写的边界情况 ----------

HAN = "甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥"


def han(n: int, start: int = 0) -> str:
    """n 个汉字，不含指示词、停用的说法和语境相关的旧说法"""
    return "".join(HAN[(start + i) % len(HAN)] for i in range(n))


def lines(*xs) -> str:
    return "\n".join(xs)


def padded(head: str, size: int) -> str:
    """head 后面补汉字，去掉空白以后正好 size 个字。每行不超过三十个字，不会触发句子的长度"""
    rest, rows = size - len(head), [head]
    while rest > 0:
        rows.append(han(min(rest, 30), len(rows)))
        rest -= 30
    return lines(*rows)


def writing_edges(writing) -> list:
    """每一项：说明、文字。覆盖旧 check 的每一种消息、每一条措辞提醒，以及 Python 和 JS 容易不同的地方"""
    inner30 = han(14) + "、" + han(14) + "、"
    return [
        # 句子的长度
        ("正好四十字的一句，不报", han(40) + "。"),
        ("四十一字的一句，警告", han(41) + "。"),
        ("正好六十字的一句，只警告", han(60) + "。"),
        ("六十一字的一句，拦截", han(61) + "。"),
        ("一串英文、数字和路径算一个字，合计四十字", han(39) + "packages/model/src/writing/check.ts" + "。"),
        ("冒号和短横也在一串里，合计四十一字", han(40) + " v1-final:scripts/writing.py " + "。"),
        ("全角标点、括号和几个半角符号不算字", han(20) + "，、；：（）()-*|#>`" + han(20) + "。"),
        ("半角的逗号、分号、问号、叹号各算一个字", han(37) + ",;?!" + "。"),
        ("表情算一个字，截取开头时不拆开", "👍" * 5 + han(40) + "。"),
        ("全角空格、不换行空格和 0x1f 都算空白", han(20) + "　 \x1f  " + han(21) + "。"),
        ("字节顺序标记不是空白，算一个字", han(40) + "﻿" + "。"),
        ("句首的字节顺序标记不会被去掉", "﻿" + han(40) + "。"),
        ("句首的空白去掉以后再截取", "   　\t" + han(45) + "。"),
        # 断句
        ("句号、问号、叹号各断一句", han(30) + "。" + han(30) + "？" + han(30) + "！"),
        ("半角的问号、叹号和句点不断句", han(15) + "?" + han(15) + "!" + han(15) + "."),
        ("换行断句", han(30) + "\n" + han(30)),
        ("回车换行断句", han(30) + "\r\n" + han(30)),
        ("只有回车也断句", han(30) + "\r" + han(30)),
        ("行分隔符和段分隔符断句", han(30) + " " + han(30) + " " + han(30)),
        ("0x0b、0x0c、0x1c、0x1d、0x1e、0x85 都断句", "".join(han(30) + c for c in "\x0b\x0c\x1c\x1d\x1e\x85") + han(30)),
        ("0x1f 不断句，但算作空白", han(30) + "\x1f" + han(30)),
        ("连续的句号", "。。。" + han(10) + "。。"),
        # 分号
        ("一句里两个全角分号，拦截", han(5) + "；" + han(5) + "；" + han(5) + "。"),
        ("一句里一个全角分号，不拦截", han(5) + "；" + han(5) + "。"),
        ("半角分号不算", han(5) + ";" + han(5) + ";" + han(5) + "。"),
        ("两个分号分在两句里，不拦截", han(5) + "；" + han(5) + "。" + han(5) + "；" + han(5) + "。"),
        # 括号里的并列
        ("括号里三项，没超过三十字，警告", "见（甲、乙、丙）。"),
        ("括号里三项，正好三十字，警告", "见（" + inner30 + "）。"),
        ("括号里三项，三十一字，拦截", "见（" + han(1) + inner30 + "）。"),
        ("半角括号也算", "见(甲、乙、丙)。"),
        ("全角和半角的括号混着配对", "见(甲、乙、丙）和（丁、戊、己)。"),
        ("括号套括号，只看最里层", "见（外、（甲、乙、丙）、外）。"),
        ("一句里两个括号，各报一条", "见（甲、乙、丙）和（丁、戊、己）。"),
        ("括号里两项不报", "见（甲、乙）。"),
        ("括号里截取前十六个字，表情不拆开", "见（" + "👍、" * 12 + "）。"),
        ("括号被句号隔开，不成一对", "见（甲、乙。丙、丁）。"),
        # 指示词
        ("指示词四个，占比超过百分之三，警告", "这个、那个、这些、那些都要写名称。"),
        ("指示词三个，不警告", "这个、那个、这些都要写名称。"),
        ("指示词四个，去掉空白一百三十三字，警告", padded("这个那个这些那些", 133)),
        ("指示词四个，去掉空白一百三十四字，不警告", padded("这个那个这些那些", 134)),
        ("指示词六个，占比正好百分之三，不警告", padded("这个那个这些那些这一那一", 200)),
        ("相邻的指示词不重叠计数", "这一个这一个这些那些。"),
        # 停用的说法和语境相关的旧说法
        ("停用的说法，每一条都拦截", lines(*(f"{old}。" for old in writing.BANNED))),
        ("「露出来」拦截", "按钮露出来了。"),
        ("「暴露出来」不算", "问题暴露出来了。"),
        ("语境相关的旧说法，每一条都警告", lines(*(f"{old}。" for old in writing.SOFT))),
        ("停用的说法只在直角引号里", "用户的原话是「替人用的脚本」。"),
        ("停用的说法只在弯引号里", "用户的原话是“收起来”。"),
        ("停用的说法在引号里外都有", "「收起来」以后又收起来了。"),
        ("没有配对的引号不算引号", "用户的原话是「替人用的脚本。"),
        ("引号里套引号，到第一个右引号为止", "「外面「替人用的脚本」外面」收起来。"),
        ("语境相关的旧说法只在引号里", "用户说要「整理」一下。"),
        ("「露出来」只在引号里", "用户说「露出来了」。"),
        ("停用的说法在链接里不算", "见 https://example.com/替人用的脚本 这页。"),
        ("链接后面紧跟的字一起去掉", "见 https://example.com/a替人用的脚本走完了。"),
        ("http 开头的也是链接", "见 http://example.com/收起来 。"),
        ("大写的 HTTPS 不是链接", "见 HTTPS://example.com/收起来 。"),
        # 引号里的字
        ("引号里的字让句子超过四十字", han(30) + "「" + han(20) + "」。"),
        ("引号里的字让句子超过六十字", han(30) + "「" + han(30) + "」。"),
        ("引号里的分号", "用户写的是「甲；乙；丙」。"),
        ("引号里的括号清单", "用户写的是「（甲、乙、丙）」。"),
        ("引号里的指示词", "用户说「这个那个这些那些」。"),
        ("引号里有句号", "用户说「" + han(25) + "。" + han(25) + "」" + han(20) + "。"),
        ("引号里有链接", "见「https://example.com/a」" + han(45) + "。"),
        # 措辞一类
        ("红方、蓝方", "红方先讲，蓝方再讲。"),
        ("间隔号", "状态·字段都定了。"),
        ("日文的中点", "状态・字段都定了。"),
        ("口头说法：我站", "我站甲方。"),
        ("口头说法：站后面跟一个字母", "我们站 a 这边。"),
        ("口头说法：站后面跟两个字母不算", "站 ab 是一个名字。"),
        ("口头说法：接着跑", "接着跑下一步。"),
        ("口头说法：抠", "抠细节。"),
        ("口头说法：定过", "这件事定过了。"),
        ("拿编号指代东西，只报第一处", "场景 3 和决定12 都改了。"),
        ("编号前是全角空格", "决定　12 已作废。"),
        ("编号前是 0x1c", "决定\x1c12 已作废。"),
        ("编号用全角数字", "提升１的做法。"),
        ("统计数字：处", "改了 7 处。"),
        ("统计数字：项", "共 4 项。"),
        ("统计数字：个问题", "发现 2 个问题。"),
        ("统计数字：次", "跑了 5 次。"),
        ("统计数字：百分号", "覆盖了 100%。"),
        ("统计数字：全角百分号", "覆盖了 50％。"),
        ("统计数字：通过在前", "通过 3 条。"),
        ("统计数字：失败在后", "有 3 失败。"),
        ("统计数字：阿拉伯-印度数字", "跑了 ٣ 次。"),
        ("措辞在引号里照样报", "用户说「红方」。"),
        ("措辞在链接里照样报", "见 https://example.com/场景3 。"),
        # 其他
        ("只有空白", "  \n\t　 "),
        ("英文的句子", "The page renders a table of scenes, and each row links to the screenshots taken during the run."),
        ("Markdown 的表格", lines("| 词 | 具体是什么 | 放在哪 |", "| --- | --- | --- |", "| 主线 | 一个文件，构思的产物 | `.product-loop/主线.md` |")),
        ("Markdown 的标题和列表", lines("## 一、名词表", "", "- 第一项；第二项；第三项", "1. 编号的一项")),
    ]


def reply_edges() -> list:
    """回复自查：首行、文件名、间隔号、链接的位置，以及表格和引用行怎么交给写作校验"""
    return [
        ("首行是阶段加全角冒号", "构思第 2 轮：开始。\n正文。"),
        ("首行用半角冒号", "检查: 开始看第一屏。"),
        ("首行冒号后面只有空白", "落地第 13 轮：   \n正文。"),
        ("首行只有阶段", "落地\n正文。"),
        ("首行不以阶段开头", "第 13 轮落地：接着做。"),
        ("回复开头的空行和空白去掉以后看首行", "\n\n  提升第 1 轮：好。"),
        ("空回复", ""),
        ("文件名：扩展名大写", "落地第 1 轮：接着做。\n看 README.MD 就知道。"),
        ("文件名：中文和文件名连着写", "落地第 1 轮：接着做。\n写在计划.md。"),
        ("文件名：后面紧跟汉字就不算", "落地第 1 轮：接着做。\n写在计划.md里。"),
        ("文件名：node.js 小写也不算", "落地第 1 轮：接着做。\n页面是用 node.js 生成的。"),
        ("文件名：D3.js 不算", "落地第 1 轮：接着做。\n图是用 D3.js 画的。"),
        ("文件名：Chart.js 算", "落地第 1 轮：接着做。\n图是用 Chart.js 画的。"),
        ("文件名：只报第一个", "落地第 1 轮：接着做。\n改了 a.css 和 b.png。"),
        ("文件名：在链接里不算", "落地第 1 轮：接着做。\nhttps://example.com/a.md"),
        ("日文的中点不算间隔号", "落地第 1 轮：接着做。\n状态・字段都定了。"),
        ("链接后面只有空行", "落地第 1 轮：接着做。\nhttps://example.com/a\n\n  \n"),
        ("两个链接，最后一个在最后", "落地第 1 轮：接着做。\nhttps://example.com/a\n中间一行。\nhttps://example.com/b"),
        ("表格的分隔行去掉", "落地第 1 轮：接着做。\n| 项 | 说明 |\n|:---:|---|\n| 甲 | 乙 |"),
        ("引用行里的停用说法", "落地第 1 轮：接着做。\n> 替人用的脚本走完了。"),
        ("引用行开头有空白", "落地第 1 轮：接着做。\n  >  收起来了。"),
        ("表格行里的长句拆成几格", "落地第 1 轮：接着做。\n| " + han(35) + " | " + han(35) + " |"),
        ("回复里的长句和分号", "落地第 1 轮：接着做。\n" + han(5) + "；" + han(5) + "；" + han(70) + "。"),
    ]


# ---------- 跑旧代码 ----------

def run_writing(writing, gate, text: str) -> dict:
    """旧 check 的拦截和警告，以及措辞提醒去掉位置以后的原文"""
    block, warn = writing.check(text)
    notes = gate.wording_notes({"current": [text]})
    bad = [n for n in notes if not n.startswith(WORDING_PREFIX)]
    if bad:
        raise ExportError(f"措辞提醒的开头不是「{WORDING_PREFIX}」：{bad[0]}")
    hits = sum(1 for _, pat in gate.WORDING if pat.search(text))
    if hits != len(notes):
        raise ExportError(f"措辞提醒有 {len(notes)} 条，旧代码的 WORDING 却命中 {hits} 条：{text[:30]}")
    out = {}
    for key, xs in (("block", block), ("warn", warn), ("wording", [n[len(WORDING_PREFIX):] for n in notes])):
        if xs:
            out[key] = xs
    return out


def run_reply(reply, text: str) -> dict:
    block, warn = reply.problems(text)
    out = {"verdict": "block" if block else "pass"}
    for key, xs in (("block", block), ("warn", warn)):
        if xs:
            out[key] = xs
    return out


def selftest_cases(reply, path: Path) -> list:
    """check-reply.py 自带的样本，记下每条在文件里的行号"""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    rows = next(n.value.elts for n in tree.body if isinstance(n, ast.Assign) and any(getattr(t, "id", None) == "SELF" for t in n.targets))
    if len(rows) != len(reply.SELF):
        raise ExportError(f"SELF 在源码里有 {len(rows)} 条，运行时有 {len(reply.SELF)} 条")
    want = {"拦住": "block", "放行": "pass"}
    return [{"source": f"{path.name}:{node.lineno}", "want": want[w], "text": t} for node, (w, t) in zip(rows, reply.SELF)]


def old_selftest(path: Path) -> list:
    """整份跑一遍旧的 check-reply.py --selftest，返回每条的第一个字：对或错"""
    p = subprocess.run([sys.executable, "-X", "utf8", str(path), "--selftest"], capture_output=True, text=True, encoding="utf-8")
    marks = [line[:1] for line in p.stdout.splitlines()]
    if p.returncode or set(marks) != {"对"}:
        raise ExportError(f"旧的 check-reply.py --selftest 没有全部通过：\n{p.stdout}{p.stderr}")
    return marks


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()[:HASH_LEN]


def numbered(kind: str, group: list, width: int = 3) -> list:
    return [{"id": f"{kind}-{n:0{width}d}", "kind": kind, **c} for n, c in enumerate(group, 1)]


def unique(kind: str, group: list, seen: set, problems: list, strict: bool) -> list:
    """去掉和前面相同的文字。手写的重复是写错了，报出来；取来的重复只留第一份"""
    kept = []
    for c in group:
        if c["text"] in seen:
            if strict:
                problems.append(f"{kind} 里有一份文字和前面的相同：{c.get('name') or c.get('source')}")
            continue
        seen.add(c["text"])
        kept.append(c)
    return kept


def coverage(cases: list, writing, gate) -> list:
    """手写的样例和自带的样本要覆盖旧代码的每一种消息。包括 check 的八种和「露出来」，五条措辞提醒，以及回复自查的四种"""
    edge = [c for c in cases if c["kind"] in ("edge", "selftest", "reply")]
    said = [m for c in edge for key in ("block", "warn", "wording") for m in c.get(key, [])]
    wanted = {
        "停用的说法": "出现了术语表停用的说法「",
        "「露出来」": "出现了术语表停用的说法「露出来」",
        "语境相关的旧说法": "。如果指的是术语表里的那个意思",
        "超过六十字": "这一句超过六十字",
        "超过四十字": "这一句超过四十字",
        "两个以上的分号": "这一句里有两个以上的分号",
        "括号里的长清单": "括号里嵌了一张清单",
        "括号里的短并列": "括号里有三项以上的并列",
        "指示词过密": "指示词太密",
        "回复的首行": "首行要写当前阶段",
        "回复里的文件名": "出现了文件名「",
        "回复里的间隔号": "用了「·」",
        "回复里链接的位置": "链接后面还有字",
    }
    wanted.update({f"措辞：{rule}": f"。{rule}。" for rule, _ in gate.WORDING})
    return [f"手写的样例和自带的样本没有覆盖到「{name}」" for name, piece in wanted.items() if not any(piece in m for m in said)]


def dump(doc: dict) -> str:
    """缩进的 JSON，但页面、度量和样例一行写一份，方便看"""
    one = lambda v: json.dumps(v, ensure_ascii=False)
    out = ["{"]
    lists = ("pages", "measures", "cases")
    for k, v in doc.items():
        if k not in lists:
            out.append(f"  {one(k)}: {one(v)},")
    for k in lists:
        rows = ",\n".join(f"    {one(x)}" for x in doc[k])
        out.append(f"  {one(k)}: [" + ("\n" + rows + "\n  ]" if rows else "]") + ("," if k != lists[-1] else ""))
    out.append("}")
    return "\n".join(out) + "\n"


def export(skill: Path, tag: str, out: Path, roots: list) -> None:
    problems = []
    with tempfile.TemporaryDirectory() as tmp:
        old = Path(tmp) / "old"
        commit = extract(skill, tag, old)
        gate = load_module("legacy_build_report", old / GATE)
        writing = gate.writing  # 旧构建校验自己加载的那一份 writing.py
        reply = load_module("legacy_check_reply", old / REPLY)
        marks = old_selftest(old / REPLY)

        skill_docs, refs = doc_cases(old)
        pages, labels, cells, stats = page_cases(gate, roots)
        seen, writing_cases = set(), []
        for kind, group, strict in (("skill", skill_docs, False), ("reference", refs, False), ("page", pages, False)):
            writing_cases.append((kind, unique(kind, group, seen, problems, strict)))
        edges = [{"name": n, "text": t} for n, t in writing_edges(writing)]
        writing_cases.append(("edge", unique("edge", edges, seen, problems, True)))

        cases = []
        for kind, group in writing_cases:
            if kind == "page":
                rows = [{"id": f"page-{text_hash(c['text'])}", "kind": kind, **c} for c in group]
                if len({r["id"] for r in rows}) != len(rows):
                    problems.append("历史页面的文字取哈希以后有重复的编号，把 HASH_LEN 调长")
            else:
                rows = numbered(kind, group)
            cases += [{**c, **run_writing(writing, gate, c["text"])} for c in rows]

        selftests = selftest_cases(reply, old / REPLY)
        replies = unique("reply", [{"name": n, "text": t} for n, t in reply_edges()], {c["text"] for c in selftests}, problems, True)
        for kind, group, width in (("selftest", selftests, 2), ("reply", replies, 3)):
            cases += [{**c, **run_reply(reply, c["text"])} for c in numbered(kind, group, width)]
        wrong = [c["id"] for c in cases if c["kind"] == "selftest" and c["verdict"] != c["want"]]
        if wrong or len(marks) != len(selftests):
            problems.append(f"check-reply.py 自带的样本判定和 --selftest 对不上：{wrong}")
        problems += coverage(cases, writing, gate)

        # 度量：历史页面里的行名和每一格，手写的样例里的每一句
        strings = set(cells)
        for c in cases:
            if c["kind"] == "edge":
                strings.update(writing.sentences(writing.LINK.sub("", writing.QUOTED.sub("", c["text"]))))
        measures = [[s, writing.length(s), writing.width(s)] for s in sorted(strings)]

        doc = {
            "exported_from": tag,
            "commit": commit,
            "functions": {
                "check": f"{WRITING}:{writing.check.__code__.co_firstlineno} check",
                "wording": f"{GATE}:{gate.wording_notes.__code__.co_firstlineno} wording_notes",
                "problems": f"{REPLY}:{reply.problems.__code__.co_firstlineno} problems",
                "length": f"{WRITING}:{writing.length.__code__.co_firstlineno} length",
                "width": f"{WRITING}:{writing.width.__code__.co_firstlineno} width",
            },
            "terms": {
                "banned": [[k, v] for k, v in writing.BANNED.items()],
                "patterns": [[p.pattern, k, v] for p, (k, v) in writing.BANNED_RE.items()],
                "soft": [[k, v] for k, v in writing.SOFT.items()],
                "wording": [[rule, p.pattern] for rule, p in gate.WORDING],
            },
            "count": {kind: sum(1 for c in cases if c["kind"] == kind) for kind in KINDS},
            "pages": labels,
            "measures": measures,
            "cases": cases,
        }

    ids = [c["id"] for c in cases]
    if len(set(ids)) != len(ids):
        problems.append("样例的编号有重复")
    text = dump(doc)
    try:
        text.encode("utf-8")
    except UnicodeEncodeError as e:
        problems.append(f"输出里有写不成 UTF-8 的字符：{e}")
    if json.loads(text) != doc:
        problems.append("写出的 JSON 读回来和原来的不一样")
    if problems:
        raise ExportError("核对没有通过，没有写文件：\n" + "\n".join(problems))
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    report(doc, stats, out)


def report(doc: dict, stats: dict, out: Path) -> None:
    count, cases = doc["count"], doc["cases"]
    said = lambda kinds, key: sum(1 for c in cases if c["kind"] in kinds and key in c)
    writing_kinds = ("skill", "reference", "page", "edge")
    print(f"用 {doc['exported_from']}（{doc['commit'][:7]}）的旧代码跑了 {len(cases)} 份文字。")
    print(f"旧正文 {count['skill']} 段，参考文件 {count['reference']} 段。")
    print(f"历史页面：{len(stats['projects'])} 个项目的 {stats['files']} 个文件里有 {stats['places']} 处文字，去重后 {count['page']} 份。")
    print(f"  项目：{'、'.join(stats['projects'])}")
    print(f"手写的边界情况 {count['edge']} 份。check-reply.py 自带的样本 {count['selftest']} 条，手写的回复 {count['reply']} 份。")
    print(f"写作校验：有拦截的 {said(writing_kinds, 'block')} 份，有警告的 {said(writing_kinds, 'warn')} 份，有措辞提醒的 {said(writing_kinds, 'wording')} 份。")
    print(f"度量 {len(doc['measures'])} 个字符串。")
    print(f"写到 {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description="用旧 skill 的写作校验跑一批文字，导出成 JSON")
    ap.add_argument("--skill", type=Path, default=DEFAULT_SKILL, help=f"旧 skill 的 git 仓库，默认 {DEFAULT_SKILL}")
    ap.add_argument("--tag", default=DEFAULT_TAG, help=f"取哪个标签的代码，默认 {DEFAULT_TAG}")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT, help=f"输出文件，默认 {DEFAULT_OUT}")
    ap.add_argument("--root", action="append", type=Path, help=f"找历史页面的目录，可以写多次，默认 {' '.join(DEFAULT_ROOTS)}")
    a = ap.parse_args()
    roots = [p.expanduser() for p in (a.root or map(Path, DEFAULT_ROOTS))]
    try:
        export(a.skill.expanduser(), a.tag, a.out, roots)
    except ExportError as e:
        sys.exit(str(e))


if __name__ == "__main__":
    main()
