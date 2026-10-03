#!/usr/bin/env python3
"""用旧 skill 的文字逐行对比算一批改前改后，连同输入导出成一份 JSON，给移植过去的新代码做对照。

用法：python3 tools/legacy/export_diff.py [--skill 旧 skill 的目录] [--tag v1-final] [--out 输出文件] [--root 找历史页面的目录 ...]

旧代码从 git 标签里取出，放进临时目录再跑。旧 skill 的目录和各项目的目录只读，不写。
输入有三类：历史页面里的改前改后、反例样本里的改前改后、构造的样例。
构造的样例包括手写的边界情况、由历史文字变出来的样例，以及用固定种子随机生成的样例。
写文件之前核对三件事：每份输入只出现一次，输出能原样写回，几份专门的样例确实能区分 autojunk。
"""
import argparse
import difflib
import json
import os
import random
import re
import sys
import tempfile
import types
from pathlib import Path

sys.dont_write_bytecode = True  # 引用同目录的 export_samples.py，不在仓库里留下 __pycache__
from export_samples import ExportError, extract, load_module  # noqa: E402

HERE = Path(__file__).resolve().parent
DEFAULT_SKILL = Path("~/.agents/skills/product-loop").expanduser()
DEFAULT_TAG = "v1-final"
DEFAULT_OUT = HERE / "out" / "diff-cases.json"
DEFAULT_ROOTS = ("~/code", "~/proj", "~/Documents/doc/md/项目")
SAMPLES = HERE / "out" / "samples.json"
GATE = "scripts/build-report.py"

# 找历史页面时跳过的目录。产品循环自己的仓库和它的工作树里没有旧页面，只有导出的数据
SKIP_DIRS = {"node_modules", ".git", "product-loop", "product-loop-wt"}
REPORT_DATA = re.compile(r'<script id="report-data" type="application/json">(.*?)</script>', re.S)
SEED = 17
RANDOM_SMALL = 240
RANDOM_LARGE = 60


# ---------- 历史页面和反例样本 ----------

def find_pages(roots: list) -> list:
    """各项目 walk 文件夹里的页面数据（.json）和生成的网页（.html）"""
    pages = set()
    for root in roots:
        for d, dirs, files in os.walk(root):
            dirs[:] = sorted(x for x in dirs if x not in SKIP_DIRS)
            if "walk" not in Path(d).parts:
                continue
            pages.update(Path(d, f).resolve() for f in files if f.endswith((".json", ".html")))
    return sorted(pages)


def page_data(path: Path):
    """页面数据。网页里的数据在 report-data 那一段，读不出来的返回 None"""
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    if path.suffix == ".html":
        m = REPORT_DATA.search(text)
        if not m:
            return None
        text = m.group(1)  # 生成网页时把 </ 写成了 <\/，JSON 自己认得这种写法
    try:
        return json.loads(text)
    except ValueError:
        return None


def text_pairs(node, where: str = ""):
    """数据里每一处带 textBefore 或 textAfter 的地方：位置、改前、改后"""
    if isinstance(node, dict):
        if "textBefore" in node or "textAfter" in node:
            yield where, node.get("textBefore"), node.get("textAfter")
        for k, v in node.items():
            yield from text_pairs(v, f"{where}.{k}" if where else k)
    elif isinstance(node, list):
        for i, x in enumerate(node):
            yield from text_pairs(x, f"{where}[{i}]")


def page_label(path: Path) -> str:
    """出处从项目的文件夹写起，不写完整路径"""
    parts = path.parts
    start = parts.index(".product-loop") - 1 if ".product-loop" in parts else parts.index("walk") - 2
    return "/".join(parts[max(start, 0):])


def collect(roots: list) -> tuple:
    """历史页面和反例样本里的改前改后。两边都是文字的才算，相同的一对只留一份，记下所有出处"""
    history, stats = {}, {"pages": 0, "places": 0, "skipped": 0, "sample_places": 0}
    for path in find_pages(roots):
        hits = list(text_pairs(page_data(path)))
        stats["pages"] += bool(hits)
        for where, before, after in hits:
            if isinstance(before, str) and isinstance(after, str):
                history.setdefault((before, after), []).append(f"{page_label(path)} {where}")
                stats["places"] += 1
            else:
                stats["skipped"] += 1
    samples = {}
    for s in json.loads(SAMPLES.read_text(encoding="utf-8"))["samples"]:
        for where, before, after in text_pairs(s["input"]):
            stats["sample_places"] += 1
            if isinstance(before, str) and isinstance(after, str):
                samples.setdefault((before, after), []).append(f"samples.json {s['id']} {where}")
            else:
                stats["skipped"] += 1
    if not history:
        raise ExportError(f"在 {', '.join(map(str, roots))} 下没有找到带改前改后文字的历史页面，检查 --root")
    return as_cases(history), as_cases(samples), stats


def as_cases(found: dict) -> list:
    """按第一处出处排好，出处也排好"""
    return [{"sources": sorted(v), "before": k[0], "after": k[1]} for k, v in sorted(found.items(), key=lambda item: min(item[1]))]


# ---------- 手写的边界情况 ----------

def lines(*xs) -> str:
    return "\n".join(xs)


def numbered(n: int, start: int = 1) -> list:
    return [f"第{i}行" for i in range(start, start + n)]


def with_change(n: int, changed: dict, both: dict | None = None) -> tuple:
    """n 行编号的文字，改后把 changed 里的几行改掉，返回改前和改后。both 里的几行两边一起换掉"""
    before = [(both or {}).get(i, x) for i, x in enumerate(numbered(n))]
    after = [changed.get(i, x) for i, x in enumerate(before)]
    return lines(*before), lines(*after)


def after_context(tail: list) -> tuple:
    """第二行有改动，改动后面两行在留下的范围里，再往后接上 tail，最后是几行不变的"""
    head = ["开头", "要改的一行", "范围里的第一行", "范围里的第二行"]
    rest = tail + ["后面不变的一行", "后面不变的又一行", "最后一行"]
    return lines(*head, *rest), lines(head[0], "改过的一行", *head[2:], *rest)


def edge_cases() -> list:
    """每一项：说明、改前、改后、选项。选项里 context 是折叠时留的行数，autojunk 表示打开 autojunk 时结果应当变"""
    rng = random.Random(SEED)
    long_cjk = "".join(rng.choice("的一是在不了有和人这中大为上个我以要他时来用们生到作地于出就分对成会可发年动同工也能下过说种面而方后多定行学法所得") for _ in range(3000))
    spaced = "".join(rng.choice("ab ") for _ in range(400))
    blanky = []
    for i in range(240):
        blanky += [f"段落{i}", ""] if i % 3 else [f"段落{i}"]
    blanky_after = list(blanky)
    blanky_after[100] = "段落改了"
    blanky_after.insert(200, "新加的段落")
    del blanky_after[30:34]
    braces = []
    for i in range(80):
        braces += [f"function f{i}() {{", f"  return {i};", "}"]
    braces_after = list(braces)
    braces_after[40] = "  return 999;"
    braces_after[120:120] = ["}", "}"]
    thousand = numbered(1000)
    thousand_after = list(thousand)
    thousand_after[10] = "第11行改了"
    thousand_after[500:503] = ["中间换成的一行"]
    thousand_after.insert(900, "")
    thousand_after[-1] = "最后一行改了"
    many = numbered(40)
    many_after = list(many)
    for i in (2, 12, 19, 27, 38):
        many_after[i] = many_after[i] + "（改）"

    cases = [
        ("两边都是空的", "", ""),
        ("改前是空的", "", "新加的一行"),
        ("改后是空的", "删掉的一行", ""),
        ("改前只有换行", "\n\n\n", "一行"),
        ("两边只有换行，个数不同", "\n", "\n\n\n"),
        ("两边只有空格", "   ", " "),
        ("一行，完全相同", "不变的一行", "不变的一行"),
        ("多行，完全相同", lines("第一行", "第二行", "第三行"), lines("第一行", "第二行", "第三行")),
        ("只差首尾的换行", "甲\n乙", "\n\n甲\n乙\n\n"),
        ("末尾加了几行", lines(*numbered(3)), lines(*numbered(5))),
        ("开头加了几行", lines(*numbered(3, 3)), lines(*numbered(5))),
        ("中间加了几行", lines("第1行", "第2行", "第5行", "第6行"), lines(*numbered(6))),
        ("只删了开头的行", lines(*numbered(6)), lines(*numbered(4, 3))),
        ("只删了中间的行", lines(*numbered(6)), lines("第1行", "第2行", "第6行")),
        ("只删了末尾的行", lines(*numbered(6)), lines(*numbered(2))),
        ("一行改了几个字", "今天的天气很好，适合出门。", "今天的天气不好，不适合出门。"),
        ("一行整行换掉，一个字都不像", "abc", "xyz"),
        ("相似度正好是 0.3，不配成一对", "abcdefghij", "abcxxxxxxx"),
        ("相似度刚过 0.3，配成一对", "abcdefghij", "abcxxxxxx"),
        ("两行和同一行一样像，取靠前的那一行", "abcd", lines("abxy", "abzw")),
        ("配上的行前面有没配过的行，先作为加上的行排出来", "hello world", lines("zzz", "hello there world")),
        ("后一行本来更像，被前一行先排走了", lines("alpha beta", "gamma delta"), lines("gamma delta!", "alpha beta!")),
        ("删掉的行比加上的行多", lines("第一句话。", "第二句话。", "第三句话。", "第四句话。"), lines("第二句话！", "另外一句")),
        ("加上的行比删掉的行多", lines("第一句话。", "第三句话。"), lines("一行新的", "第一句话！", "第二句话。", "第三句话！", "再一行新的")),
        ("行内既有删又有加", "把队列写成一张表", "把队列写成一份数据"),
        ("行内只删了字", "按系统、第几轮来记", "按第几轮来记"),
        ("行内只加了字", "按第几轮来记", "按系统、第几轮来记"),
        ("回车换行，改了一行", "a\r\nb\r\nc", "a\r\nB\r\nc"),
        ("回车换行和换行，内容相同", "第一行\r\n第二行\r\n第三行", "第一行\n第二行\n第三行"),
        ("末尾多了回车换行", "a\nb", "a\nb\r\n"),
        ("开头是回车换行", "\r\na\nb", "a\nb"),
        ("只改了空白：多一个空格", "a b c", "a  b c"),
        ("只改了空白：制表符换成空格", "\tx = 1\n\ty = 2", "    x = 1\n\ty = 2"),
        ("只改了空白：行尾的空格", "x \ny\nz", "x\ny\nz"),
        ("只改了空白：全角空格换成半角", "甲\u3000乙", "甲 乙"),
        ("只改了空白：空行里的空格", lines("甲", "", "乙"), lines("甲", "  ", "乙")),
        ("很长的一行，中间改了一个字", long_cjk, long_cjk[:1500] + "改" + long_cjk[1501:]),
        ("很长的一行，字母少、重复多，打开 autojunk 结果会变", spaced, spaced[:150] + "ba" + spaced[152:300] + "  " + spaced[300:], {"autojunk": True}),
        ("很长的几行，每行改一处", lines(long_cjk[:800], long_cjk[800:1600], long_cjk[1600:2400]), lines(long_cjk[:400] + "改" + long_cjk[401:800], long_cjk[800:1600], "加上的" + long_cjk[1600:2400])),
        ("中文标点和引号", "用户说：“这里不对”。", "用户说：「这里不对」。"),
        ("表情：共用同一个高位代理的两个表情", "👍 好", "👎 好"),
        ("表情：肤色、家庭、旗帜", "👍🏽 👨\u200d👩\u200d👧 🇨🇳", "👍🏿 👨\u200d👩\u200d👦 🇯🇵"),
        ("表情：加在中间", "开始结束", "开始🎉结束"),
        ("组合用的重音符和预组合的字", "cafe\u0301", "caf\u00e9"),
        ("零宽空格和字节顺序标记", "a\u200bb\ufeffc", "abc"),
        ("控制字符", "a\x00b\x01c", "a\x00B\x01c"),
        ("行分隔符不算换行", "甲\u2028乙\n丙", "甲\u2028乙\n丁"),
        ("两处改动隔得远，中间折起来", *with_change(20, {2: "第3行（改）", 16: "第17行（改）"})),
        ("两处改动之间正好隔四行，不折", *with_change(12, {2: "第3行（改）", 7: "第8行（改）"})),
        ("两处改动之间隔五行，折起一行", *with_change(12, {2: "第3行（改）", 8: "第9行（改）"})),
        ("两处改动之间隔五行，中间一行是空行，留下", *with_change(12, {2: "第3行（改）", 8: "第9行（改）"}, {5: ""})),
        ("改动在第一行", *with_change(8, {0: "第1行（改）"})),
        ("改动在最后一行", *with_change(8, {7: "第8行（改）"})),
        ("改动在第三行，前面不折", *with_change(8, {2: "第3行（改）"})),
        ("改动在第四行，前面折起一行", *with_change(8, {3: "第4行（改）"})),
        ("改动在倒数第三行，后面不折", *with_change(8, {5: "第6行（改）"})),
        ("改动在倒数第四行，后面折起一行", *with_change(8, {4: "第5行（改）"})),
        ("范围后面紧跟一行空行，留下", *after_context([""])),
        ("范围后面紧跟两行空行，只多留一行", *after_context(["", ""])),
        ("范围后面紧跟只有空格和制表符的行", *after_context([" \t "])),
        ("范围后面紧跟只有全角空格的行", *after_context(["\u3000"])),
        ("范围后面紧跟只有 \\x1c 的行，Python 算作空白", *after_context(["\x1c"])),
        ("范围后面紧跟只有 \\x85 的行，Python 算作空白", *after_context(["\x85"])),
        ("范围后面紧跟只有 \\ufeff 的行，Python 不算空白", *after_context(["\ufeff"])),
        ("范围后面紧跟只有 \\u200b 的行，不算空白", *after_context(["\u200b"])),
        ("范围后面紧跟只有 \\u2028 的行，算作空白", *after_context(["\u2028"])),
        ("范围后面紧跟只有回车的行", *(x.replace("\n", "\r\n") for x in after_context([""]))),
        ("范围前面的空行不多留", lines("甲", "乙", "", "丙", "丁", "戊", "要改的一行", "己"), lines("甲", "乙", "", "丙", "丁", "戊", "改过的一行", "己")),
        # 开头的空行会被去掉，所以第一行用一个空格。旧代码写了 i and，不会拿最后一行当它的前一行
        ("第一行只有空格，前面没有行，不留", lines(" ", "甲", "乙", "丙", "要改的一行"), lines(" ", "甲", "乙", "丙", "改过的一行")),
        ("折起的一段里有空行", *with_change(14, {1: "第2行（改）", 12: "第13行（改）"}, {5: "", 6: ""})),
        ("折起的一段从空行开始", *with_change(14, {1: "第2行（改）", 12: "第13行（改）"}, {4: "", 5: ""})),
        ("重复的行，中间插入一行", lines("a", "a", "a"), lines("a", "a", "b", "a")),
        ("重复的行，多了一行", lines("a", "a", "a"), lines("a", "a", "a", "a")),
        ("两段对调", lines("A", "B", "C", "D"), lines("C", "D", "A", "B")),
        ("交替重复的行", lines("x", "y", "x", "y", "x"), lines("y", "x", "y")),
        ("一样长的匹配有好几处", lines("a", "b", "c", "a", "b", "c"), lines("c", "a", "b", "d", "a", "b")),
        ("行内重复的字", "aaaa", "aaa"),
        ("行内的字对调", "abab", "baba"),
        ("四百行，三分之一是空行", lines(*blanky), lines(*blanky_after)),
        ("超过两百行，右花括号占三分之一，打开 autojunk 结果会变", lines(*braces), lines(*braces_after), {"autojunk": True}),
        ("一千行里改了几处", lines(*thousand), lines(*thousand_after)),
        ("五处改动，默认留两行", lines(*many), lines(*many_after)),
        ("五处改动，context 为 0", lines(*many), lines(*many_after), {"context": 0}),
        ("五处改动，context 为 1", lines(*many), lines(*many_after), {"context": 1}),
        ("五处改动，context 为 3", lines(*many), lines(*many_after), {"context": 3}),
        ("context 为 5，比全文还长", *with_change(6, {2: "第3行（改）"}), {"context": 5}),
        ("context 为 0，空行紧跟改动", lines("甲", "要改的一行", "", "乙"), lines("甲", "改过的一行", "", "乙"), {"context": 0}),
    ]
    out = []
    for name, before, after, *opt in cases:
        opt = opt[0] if opt else {}
        out.append({"name": name, **({"context": opt["context"]} if "context" in opt else {}),
                    "before": before, "after": after, "autojunk": opt.get("autojunk", False)})
    return out


# ---------- 由历史文字变出来的样例，以及随机的样例 ----------

LINE_POOL = ["", " ", "a", "b", "ab", "ba", "abc", "甲", "甲乙", "甲乙丙", "👍", "x y", "\t", "\u3000", "}", "a\r", "\r"]
CHAR_POOL = list("abc 甲乙") + ["👍", "👎", "🇨🇳", "\t", "\u3000", "\x1c", "\ufeff", "\x85", "\r"]


def random_line(rng, chars: list) -> str:
    if rng.random() < 0.35:
        return rng.choice(LINE_POOL)
    return "".join(rng.choice(chars) for _ in range(rng.randint(0, 10)))


def mutate_line(rng, line: str, chars: list) -> str:
    """一行里随机插入、删掉或换掉几个字"""
    xs = list(line)
    for _ in range(rng.randint(1, 3)):
        op, pos = rng.randrange(3), rng.randint(0, len(xs))
        if op == 0:
            xs.insert(pos, rng.choice(chars))
        elif xs and op == 1:
            del xs[min(pos, len(xs) - 1)]
        elif xs:
            xs[min(pos, len(xs) - 1)] = rng.choice(chars)
    return "".join(xs)


def mutate_lines(rng, rows: list, edits: int, chars: list, pool: list) -> list:
    """随机加行、删行、改行、复制一行、挪动一行、整行换掉"""
    rows = list(rows)
    for _ in range(edits):
        op, pos = rng.randrange(6), rng.randint(0, len(rows))
        at = min(pos, len(rows) - 1)
        if op == 0:
            rows.insert(pos, rng.choice(pool) if pool else random_line(rng, chars))
        elif not rows:
            continue
        elif op == 1:
            del rows[at]
        elif op == 2:
            rows[at] = mutate_line(rng, rows[at], chars)
        elif op == 3:
            rows.insert(at, rows[at])
        elif op == 4:
            x = rows.pop(at)
            rows.insert(rng.randint(0, len(rows)), x)
        else:
            rows[at] = rng.choice(pool) if pool else random_line(rng, chars)
    return rows


def derived_cases(history: list) -> list:
    """每一对历史文字变出两份：改前改后对调，以及把改后的文字随机改几处"""
    rng = random.Random(SEED)
    swapped, mutated = [], []
    for n, h in enumerate(history, 1):
        ref = f"history-{n:03d}"
        swapped.append({"name": "历史页面的改前改后对调", "from": ref, "before": h["after"], "after": h["before"]})
        rows = h["after"].split("\n")
        chars = sorted(set(h["after"] + h["before"]) - {"\n"})
        pool = rows + h["before"].split("\n")
        mutated.append({"name": "历史页面的改后文字随机改几处", "from": ref, "before": h["after"],
                        "after": "\n".join(mutate_lines(rng, rows, rng.randint(1, 6), chars, pool))})
    return swapped + mutated


def random_cases(seen: set) -> list:
    """固定种子随机生成。字和行都从很小的集合里取，重复多，容易出现一样长的匹配"""
    rng = random.Random(SEED)
    out = []
    while len(out) < RANDOM_SMALL + RANDOM_LARGE:
        size = 10 if len(out) < RANDOM_SMALL else 60
        before = [random_line(rng, CHAR_POOL) for _ in range(rng.randint(0, size))]
        if rng.random() < 0.1:
            after = [random_line(rng, CHAR_POOL) for _ in range(rng.randint(0, size))]
        else:
            after = mutate_lines(rng, before, rng.randint(1, max(1, size // 3)), CHAR_POOL, [])
        sep = "\r\n" if rng.random() < 0.15 else "\n"
        other = sep if rng.random() < 0.9 else ("\n" if sep == "\r\n" else "\r\n")
        b = rng.choice(["", "", "", "\n", "\n\n"]) + sep.join(before) + rng.choice(["", "", "\n", sep])
        a = rng.choice(["", "", "", "\n"]) + other.join(after) + rng.choice(["", "", "\n", other])
        context = 2 if rng.random() < 0.85 else rng.choice([0, 1, 3])
        if (b, a, context) in seen:
            continue
        seen.add((b, a, context))
        out.append({"name": f"随机生成，种子 {SEED}", **({"context": context} if context != 2 else {}), "before": b, "after": a})
    return out


# ---------- 跑旧代码、核对、写文件 ----------

class AutoJunk(difflib.SequenceMatcher):
    """把 autojunk 强制打开，用来确认那几份样例能区分它"""

    def __init__(self, isjunk=None, a="", b="", autojunk=True):
        super().__init__(isjunk, a, b, True)


def run_with_autojunk(gate, case: dict):
    real = gate.difflib
    gate.difflib = types.SimpleNamespace(SequenceMatcher=AutoJunk)
    try:
        return gate.text_diff(case["before"], case["after"], case.get("context", 2))
    finally:
        gate.difflib = real


def dump(doc: dict) -> str:
    """缩进的 JSON，但对比结果一行写一行，方便看"""
    one = lambda v: json.dumps(v, ensure_ascii=False)
    out = ["{"]
    for k, v in doc.items():
        if k != "cases":
            out.append(f"  {one(k)}: {one(v)},")
    out.append('  "cases": [')
    for n, case in enumerate(doc["cases"]):
        out.append("    {")
        for k, v in case.items():
            if k == "output":
                rows = [f"        {one(r)}" for r in v]
                out.append('      "output": [' + ("\n" + ",\n".join(rows) + "\n      ]" if rows else "]"))
            else:
                out.append(f"      {one(k)}: {one(v)},")
        out.append("    }" + ("," if n < len(doc["cases"]) - 1 else ""))
    out.append("  ]")
    out.append("}")
    return "\n".join(out) + "\n"


def export(skill: Path, tag: str, out: Path, roots: list) -> None:
    history, samples, stats = collect(roots)
    edges = edge_cases()
    derived = derived_cases(history)

    with tempfile.TemporaryDirectory() as tmp:
        old = Path(tmp) / "old"
        commit = extract(skill, tag, old)
        gate = load_module("legacy_build_report", old / GATE)
        text_diff = gate.text_diff
        problems = []

        # 每份输入只出现一次。手写的和前面重复是写错了，变出来的重复就跳过
        seen, cases = set(), []
        for kind, group in (("history", history), ("sample", samples), ("edge", edges), ("derived", derived)):
            kept = []
            for c in group:
                key = (c["before"], c["after"], c.get("context", 2))
                if key in seen and kind != "derived":
                    problems.append(f"{kind} 里有一份输入和前面的相同：{c.get('name') or c['sources'][0]}")
                if key not in seen:
                    kept.append(c)
                seen.add(key)
            cases += [{"id": f"{kind}-{n:03d}", "kind": kind, **c} for n, c in enumerate(kept, 1)]
        cases += [{"id": f"random-{n:03d}", "kind": "random", **c} for n, c in enumerate(random_cases(seen), 1)]

        for c in cases:
            c["output"] = text_diff(c["before"], c["after"], c.get("context", 2))
            if c.pop("autojunk", False) and run_with_autojunk(gate, c) == c["output"]:
                problems.append(f"{c['id']}「{c['name']}」打开 autojunk 结果不变，区分不了")

    doc = {
        "exported_from": tag,
        "commit": commit,
        "function": f"{GATE}:{text_diff.__code__.co_firstlineno} text_diff",
        "count": {kind: sum(1 for c in cases if c["kind"] == kind) for kind in ("history", "sample", "edge", "derived", "random")},
        "cases": cases,
    }
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
    print(f"用 {doc['exported_from']}（{doc['commit'][:7]}）的 {doc['function']} 算了 {len(cases)} 份。")
    print(f"历史页面：{stats['pages']} 个文件里有 {stats['places']} 处改前改后，去重后 {count['history']} 对。")
    print(f"反例样本：{stats['sample_places']} 处，两边都是文字的去重后 {count['sample']} 对。两边不全是文字的跳过了 {stats['skipped']} 处。")
    print(f"构造的样例：手写的边界情况 {count['edge']} 份，由历史文字变出来的 {count['derived']} 份，随机生成的 {count['random']} 份。")
    print(f"写到 {out}")


def main() -> None:
    ap = argparse.ArgumentParser(description="用旧 skill 的文字逐行对比算一批改前改后，导出成 JSON")
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
