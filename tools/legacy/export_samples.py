#!/usr/bin/env python3
"""把旧 skill 的反例样本连同旧构建校验的判定导出成一份 JSON，给新的校验做对照。

用法：python3 tools/legacy/export_samples.py [--skill 旧 skill 的目录] [--tag v1-final] [--out 输出文件]

旧代码从 git 标签里取出，放进临时目录再跑。旧 skill 的目录只读，不写。
每份样本跑三遍旧的构建校验：照 check-samples.py 的方式跑一遍，带追踪跑一遍，
用导出的数据重建样本再跑一遍。临时目录换成占位符以后，三遍的输出逐字相同，才写出文件。
另外整份跑一遍旧的 check-samples.py，份数和每份的判定要和导出的一致。
"""
import argparse
import ast
import builtins
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import tempfile
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_SKILL = Path("~/.agents/skills/product-loop").expanduser()
DEFAULT_TAG = "v1-final"
DEFAULT_OUT = HERE / "out" / "samples.json"

GATE = "scripts/build-report.py"
SAMPLES_SCRIPT = "scripts/check-samples.py"
SAMPLE_DIR = "<样本目录>"
OLD_TREE = "<v1-final>"

# check-samples.py 的三种判定，和导出里用的键
VERDICTS = {"拦住": "block", "提醒": "warn", "放行": "pass"}

# build-report.py 的 main() 依次执行的二十二道检查，名称和 07-校验.md 第四节的表一致
CHECKS = (
    ("parse_json", "解析 JSON"),
    ("required_fields", "四个必填字段"),
    ("stage_enum", "stage 五选一"),
    ("check_cards", "卡片的来源和选项"),
    ("check_evidence", "证据、位置和看法"),
    ("check_changes", "更改的改前改后"),
    ("check_queue", "页面数据里不许手抄队列"),
    ("check_queue_source", "队列文件和本阶段的事"),
    ("check_mainline", "主线的设计规范十二样"),
    ("check_research", "调研分档"),
    ("check_screens", "元素清单"),
    ("check_scenes", "场景清单"),
    ("check_spec", "设计规范区块"),
    ("check_design", "设计类的卡先看再画"),
    ("check_scene_text", "卡里整段写场景清单"),
    ("check_usage", "使用区块"),
    ("check_diagrams", "图表"),
    ("check_align", "先对齐"),
    ("check_refs", "参考"),
    ("check_land", "落地的记录"),
    ("check_writing", "写作校验"),
    ("wording_notes", "措辞警告"),
)
CHECK_IDS = [c for c, _ in CHECKS]

# main() 里直接写的三道检查，按 v1-final 的行号
INLINE = {584: ("parse_json", "json.loads(raw)"),
          587: ("required_fields", "JSON 缺字段"),
          589: ("stage_enum", "stage 只能是五个阶段之一")}
# 只转述别处消息的几行。消息算到最初产生它的那一行，这几行不算规则
RELAYS = {("build-report.py", 111): "以下文字不符合写作规范",
          ("build-report.py", 608): "print(note, file=sys.stderr)",
          ("queue.py", 38): "里有一件不合格式：{问题}",
          ("land.py", 26): "sys.exit(msg)"}
# 旧构建校验会走到的函数。None 表示整份文件
SCOPE = {"build-report.py": None,
         "writing.py": {"check"},
         "queue.py": {"load", "查一件"},
         "land.py": {"evidence", "check_plan", "check_review", "stop"}}
# 不由 main() 直接调用的函数，消息算到调用它的那道检查
HELPER_CHECK = {("build-report.py", "find_queue_file"): "check_queue_source",
                ("build-report.py", "check_queue_file"): "check_queue_source",
                ("writing.py", "check"): "check_writing",
                ("queue.py", "load"): "check_queue_source",
                ("queue.py", "查一件"): "check_queue_source",
                ("land.py", "evidence"): "check_land",
                ("land.py", "check_plan"): "check_land",
                ("land.py", "check_review"): "check_land"}
# 先攒进列表、再由别处打印的消息：函数和攒消息的列表名
ACCUMULATORS = {("writing.py", "check"): ("block", "warn"),
                ("queue.py", "查一件"): ("坏",),
                ("build-report.py", "wording_notes"): ("notes",)}
# 这几个键下面是样本的原始数据，保留原来的字段顺序：有的旧消息会把字典原样打印出来，顺序一变，消息的原文就变了
RAW_KEYS = {"base", "input", "json"}


class ExportError(Exception):
    pass


# ---------- 带追踪地跑一次旧的构建校验（在子进程里执行） ----------

def trace_one(gate: str, src: str, dst: str, events_path: str) -> None:
    """照常运行旧的构建校验，输出和退出码不变；每条消息从哪一行来，写进 events_path"""
    import runpy

    gate = os.path.abspath(gate)
    scripts = os.path.realpath(os.path.dirname(gate))
    main_file = os.path.realpath(gate)
    events, items, cache = [], [], {}

    def in_old(code) -> bool:
        if code not in cache:
            cache[code] = os.path.dirname(os.path.realpath(code.co_filename)) == scripts
        return cache[code]

    def is_main(code) -> bool:
        return code.co_name == "main" and in_old(code) and os.path.realpath(code.co_filename) == main_file

    def site(frame) -> dict:
        return {"file": os.path.basename(frame.f_code.co_filename), "line": frame.f_lineno, "func": frame.f_code.co_name}

    def check_of(frame):
        """main() 直接调用的那个函数就是这道检查；消息直接出在 main() 里的记为 main"""
        below = None
        while frame is not None:
            if is_main(frame.f_code):
                return below.f_code.co_name if below is not None else "main"
            below, frame = frame, frame.f_back
        return None

    def tracer(frame, event, arg):
        code = frame.f_code
        if not in_old(code):
            return None
        names = ACCUMULATORS.get((os.path.basename(code.co_filename), code.co_name))
        if names is None:
            return None
        seen = dict.fromkeys(names, 0)
        last = [frame.f_lineno]
        base = {"file": os.path.basename(code.co_filename), "func": code.co_name, "check": check_of(frame)}

        def local(frame, event, arg):
            # 列表变长了，新的几条来自刚执行完的那一行
            for n in names:
                lst = frame.f_locals.get(n)
                if isinstance(lst, list) and len(lst) > seen[n]:
                    items.extend({**base, "line": last[0], "list": n, "text": t} for t in lst[seen[n]:])
                    seen[n] = len(lst)
            if event == "return" and isinstance(arg, list) and all(arg is not frame.f_locals.get(n) for n in names):
                items.extend({**base, "line": frame.f_lineno, "list": "return", "text": t} for t in arg)
            last[0] = frame.f_lineno
            return local

        return local

    real_exit, real_print = sys.exit, builtins.print

    def fake_exit(arg=None):
        frame = sys._getframe(1)
        if frame.f_code.co_name == "stop" and os.path.basename(frame.f_code.co_filename) == "land.py":
            frame = frame.f_back  # land.py 的 stop() 只转一手
        events.append({"kind": "exit", "text": arg if isinstance(arg, str) else None, **site(frame), "check": check_of(frame)})
        real_exit(arg)

    def fake_print(*args, sep=" ", end="\n", file=None, flush=False):
        if file is not None and file is sys.stderr:
            frame = sys._getframe(1)
            text = (" " if sep is None else sep).join(map(str, args))
            events.append({"kind": "print", "text": text, "end": end, **site(frame), "check": check_of(frame)})
        real_print(*args, sep=sep, end=end, file=file, flush=flush)

    sys.argv = [gate, src, dst]
    sys.path[0] = os.path.dirname(gate)  # 和直接运行时一样
    sys.exit, builtins.print = fake_exit, fake_print
    sys.settrace(tracer)
    try:
        runpy.run_path(gate, run_name="__main__")
    finally:
        sys.settrace(None)
        sys.exit, builtins.print = real_exit, real_print
        Path(events_path).write_text(json.dumps({"events": events, "items": items}, ensure_ascii=False), encoding="utf-8")


# ---------- 取出旧代码 ----------

def git(skill: Path, *args: str) -> bytes:
    p = subprocess.run(["git", "-C", str(skill), *args], capture_output=True)
    if p.returncode:
        raise ExportError(f"git {' '.join(args)} 失败：{p.stderr.decode(errors='replace').strip()}")
    return p.stdout


def extract(skill: Path, tag: str, dest: Path) -> str:
    """把标签指向的那一版代码解到 dest，返回提交号"""
    commit = git(skill, "rev-parse", "--verify", f"{tag}^{{commit}}").decode().strip()
    with tarfile.open(fileobj=io.BytesIO(git(skill, "archive", "--format=tar", commit))) as tar:
        if hasattr(tarfile, "data_filter"):
            tar.extractall(dest, filter="data")
        else:
            tar.extractall(dest)
    return commit


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ---------- 旧代码里产生消息的每一行 ----------

def is_attr(node, value: str, attr: str) -> bool:
    return isinstance(node, ast.Attribute) and node.attr == attr and isinstance(node.value, ast.Name) and node.value.id == value


def site_level(file: str, func: str, node):
    """这个语法节点会产生消息时，返回它的级别"""
    if isinstance(node, ast.Return):
        return ["block"] if (file, func) == ("queue.py", "查一件") and isinstance(node.value, ast.List) else None
    if not isinstance(node, ast.Call):
        return None
    f = node.func
    if is_attr(f, "sys", "exit") or (file == "land.py" and isinstance(f, ast.Name) and f.id == "stop"):
        return ["block"]
    if isinstance(f, ast.Name) and f.id == "print":
        return ["warn"] if any(k.arg == "file" and is_attr(k.value, "sys", "stderr") for k in node.keywords) else None
    if isinstance(f, ast.Attribute) and f.attr == "append" and (file, func) in ACCUMULATORS:
        names = {n.id for n in ast.walk(f.value) if isinstance(n, ast.Name)}
        return [lv for lv, keys in (("block", {"block", "坏"}), ("warn", {"warn", "notes"})) if names & keys] or None
    return None


def check_for(file: str, func: str, line: int) -> str:
    if (file, func) == ("build-report.py", "main"):
        if line not in INLINE:
            raise ExportError(f"build-report.py 的 main() 第 {line} 行有一处消息，不在行号表里")
        return INLINE[line][0]
    return HELPER_CHECK.get((file, func), func)


def scan_rules(scripts: Path) -> dict:
    """静态地列出旧构建校验里每一处产生拦截或警告的代码行"""
    rules = {}
    for file, funcs in SCOPE.items():
        src = (scripts / file).read_text(encoding="utf-8")
        lines = src.splitlines()
        for (f, line), snippet in RELAYS.items():
            if f == file and snippet not in lines[line - 1]:
                raise ExportError(f"{file} 第 {line} 行和 v1-final 不一样，行号表要重对")
        for fn in ast.parse(src).body:
            if not isinstance(fn, ast.FunctionDef) or (funcs is not None and fn.name not in funcs):
                continue
            for node in ast.walk(fn):
                level = site_level(file, fn.name, node)
                if level is None or (file, node.lineno) in RELAYS:
                    continue
                rid = f"{file}:{node.lineno}"
                rules[rid] = {"id": rid, "file": file, "line": node.lineno, "func": fn.name,
                              "check": check_for(file, fn.name, node.lineno), "level": level,
                              "code": lines[node.lineno - 1].strip()}
    gate_lines = (scripts / "build-report.py").read_text(encoding="utf-8").splitlines()
    for line, (_, snippet) in INLINE.items():
        if snippet not in gate_lines[line - 1]:
            raise ExportError(f"build-report.py 第 {line} 行和 v1-final 不一样，行号表要重对")
    # 坏 JSON 不经过 sys.exit，是 json.loads 抛出的异常
    rules["build-report.py:584"] = {"id": "build-report.py:584", "file": "build-report.py", "line": 584, "func": "main",
                                    "check": "parse_json", "level": ["block"], "code": gate_lines[583].strip()}
    bad = sorted({r["check"] for r in rules.values()} - set(CHECK_IDS))
    if bad:
        raise ExportError(f"有规则算不到二十二道检查里：{bad}")
    return rules


def verify_checks(scripts: Path) -> None:
    """二十二道检查的顺序要和 main() 里调用的顺序一致"""
    tree = ast.parse((scripts / "build-report.py").read_text(encoding="utf-8"))
    main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
    calls = sorted((n for n in ast.walk(main) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)),
                   key=lambda n: (n.lineno, n.col_offset))
    called = [n.func.id for n in calls if n.func.id in CHECK_IDS]
    if called != CHECK_IDS[3:]:
        raise ExportError(f"main() 调用检查的顺序和表不一致：{called}")


# ---------- 样本 ----------

def sample_sources(path: Path, samples: list) -> list:
    """每份样本在 check-samples.py 里的行号和原代码"""
    src = path.read_text(encoding="utf-8")
    assign = next(n for n in ast.parse(src).body
                  if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "SAMPLES" for t in n.targets))
    elts = assign.value.elts
    if len(elts) != len(samples):
        raise ExportError(f"SAMPLES 的写法里有 {len(elts)} 项，运行出来有 {len(samples)} 项")
    out = []
    for elt, sample in zip(elts, samples):
        if not (isinstance(elt, ast.Tuple) and isinstance(elt.elts[0], ast.Constant) and elt.elts[0].value == sample[0]):
            raise ExportError(f"对不上 SAMPLES 里的一项：{sample[0]}")
        out.append((elt.lineno, ast.get_source_segment(src, elt)))
    return out


def materialize(d: Path, data, rest, cs) -> None:
    """照 check-samples.py 的 run() 摆出一份样本：页面数据、队列文件、主线、落地的记录"""
    d.mkdir()
    (d / "round.json").write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    if data.get("landDir") == "land":
        cs.make_land(d / "land")
    queue = rest[0] if rest else cs.qfile()
    if isinstance(queue, dict):
        (d / "队列.json").write_text(json.dumps(queue, ensure_ascii=False), encoding="utf-8")
    elif queue is not None:
        (d / ("队列.json" if queue.startswith("{") else "队列.md")).write_text(queue, encoding="utf-8")
    if len(rest) > 1:
        (d / "主线.md").write_text(rest[1], encoding="utf-8")


def as_content(rel: str, text: str) -> dict:
    """能原样写回的 JSON 存成值，其余存原文"""
    if rel.endswith(".json"):
        try:
            value = json.loads(text)
        except ValueError:
            return {"text": text}
        if json.dumps(value, ensure_ascii=False) == text:
            return {"json": value}
    return {"text": text}


def collect_files(d: Path) -> dict:
    return {p.relative_to(d).as_posix(): as_content(p.name, p.read_text(encoding="utf-8"))
            for p in sorted(d.rglob("*")) if p.is_file() and p.relative_to(d).as_posix() != "round.json"}


def write_back(d: Path, sample: dict) -> None:
    """用导出的数据重建一份样本"""
    d.mkdir()
    (d / "round.json").write_text(json.dumps(sample["input"], ensure_ascii=False), encoding="utf-8")
    for rel, content in sample["files"].items():
        p = d / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(json.dumps(content["json"], ensure_ascii=False) if "json" in content else content["text"], encoding="utf-8")


def guard() -> None:
    """旧构建校验会从样本目录往上找五层队列文件。样本目录都建在系统的临时目录下，上面有队列文件，判定就不准了"""
    root = Path(tempfile.gettempdir()) / "tmp-sample-root"  # 和 TemporaryDirectory() 建出来的目录同一层
    for d in list((root / "s0" / "round.json").resolve().parents)[1:6]:
        for sub in ("", ".product-loop", "docs"):
            for name in ("队列.json", "队列.md"):
                if (d / sub / name).is_file():
                    raise ExportError(f"临时目录的上层有队列文件 {d / sub / name}，会被旧构建校验找到。换一个临时目录（TMPDIR）再跑")


def run_gate(gate: Path, d: Path):
    """和 check-samples.py 的 run() 用同一条命令"""
    p = subprocess.run([sys.executable, str(gate), str(d / "round.json"), str(d / "round.html")], capture_output=True, text=True)
    return p.returncode, p.stdout, p.stderr


def run_traced(gate: Path, d: Path, events: Path):
    p = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--trace-one", str(gate),
                        str(d / "round.json"), str(d / "round.html"), str(events)], capture_output=True, text=True)
    return (p.returncode, p.stdout, p.stderr), json.loads(events.read_text(encoding="utf-8"))


def verdict_of(code: int, out: str, err: str) -> str:
    return "拦住" if code else ("提醒" if "提醒" in (err + out) else "放行")


def old_verdict(want: str, got: str) -> str:
    """check-samples.py 给每份样本下的结论"""
    if got == want:
        return "对"
    if want == "放行":
        return "错拦" if got == "拦住" else "错提醒"
    return "漏过去" if got == "放行" else f"应该{want}，实际{got}"


def said_of(out: str, err: str) -> str:
    s = (err or "").strip() or (out or "").strip()
    return s.splitlines()[0] if s else ""


def normalizer(*pairs):
    """把临时目录换成占位符。/private/var 和 /var 两种写法都换"""
    subs = []
    for path, token in pairs:
        for form in sorted({os.path.realpath(path), os.path.abspath(path)}, key=len, reverse=True):
            subs.append((form, token))
    subs.sort(key=lambda s: len(s[0]), reverse=True)

    def norm(text: str) -> str:
        for form, token in subs:
            text = text.replace(form, token)
        return text
    return norm


def find_item(items: list, text: str):
    """转述的消息里包着哪一条攒下的消息。取最长的那条"""
    hits = [it for it in items if isinstance(it["text"], str) and it["text"] and it["text"] in text]
    return max(hits, key=lambda it: len(it["text"])) if hits else None


def build_messages(trace: dict, norm, rules: dict, name: str) -> list:
    msgs = []

    def add(level: str, text: str, origin) -> None:
        if origin is None:
            raise ExportError(f"样本「{name}」有一条消息找不到来源：{text[:60]}")
        check = check_for(origin["file"], origin["func"], origin["line"]) if origin["check"] == "main" else origin["check"]
        rid = f"{origin['file']}:{origin['line']}"
        # 攒下的消息可能被降级：队列里的文字触发写作校验的拦截，旧代码只给警告。直接产生的消息级别要和规则表一致
        relayed = origin.get("list") is not None
        if rid not in rules or rules[rid]["check"] != check or (not relayed and level not in rules[rid]["level"]):
            raise ExportError(f"样本「{name}」的一条消息算到了 {rid}（{check}），规则表里对不上")
        msgs.append({"level": level, "text": norm(text), "check": check, "rule": rid})

    for ev in trace["events"]:
        level = "block" if ev["kind"] == "exit" else "warn"
        key = (ev["file"], ev["line"])
        if ev["kind"] == "print" and ev.get("end") != "\n":
            raise ExportError(f"样本「{name}」有一行输出没有换行结尾")
        if key == ("build-report.py", 111):
            # check_writing 把写作校验的拦截合成一段：第一行是总的说明，之后一行一条
            header, *lines = ev["text"].split("\n")
            for line in lines:
                add(level, line, find_item(trace["items"], line))
        elif key in RELAYS:
            add(level, ev["text"], find_item(trace["items"], ev["text"]))
        else:
            add(level, ev["text"], ev)
    return msgs


def replay_text(events: list) -> str:
    """把追踪到的消息拼回去，应该正好是旧构建校验写到 stderr 的内容"""
    return "".join(ev["text"] + "\n" for ev in events)


def canonical(node):
    """键按名称排序，样本的原始数据除外"""
    if isinstance(node, dict):
        return {k: (node[k] if k in RAW_KEYS else canonical(node[k])) for k in sorted(node)}
    if isinstance(node, list):
        return [canonical(x) for x in node]
    return node


def parallel(fn, args: list) -> list:
    """每份样本在自己的目录里跑，互不影响；结果按原来的顺序返回"""
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=min(8, os.cpu_count() or 1)) as ex:
        return list(ex.map(lambda a: fn(*a), args))


# ---------- 主流程 ----------

def export(skill: Path, tag: str, out: Path) -> None:
    guard()
    with tempfile.TemporaryDirectory() as work_tmp:
        work = Path(work_tmp).resolve()
        old = work / "old"
        commit = extract(skill, tag, old)
        scripts = old / "scripts"
        gate = old / GATE
        rules = scan_rules(scripts)
        verify_checks(scripts)

        cs = load_module("legacy_check_samples", old / SAMPLES_SCRIPT)
        sources = sample_sources(old / SAMPLES_SCRIPT, cs.SAMPLES)

        # 整份跑一遍旧的 check-samples.py，拿它的结果来核对
        rows_path = work / "check-samples.json"
        p = subprocess.run([sys.executable, str(old / SAMPLES_SCRIPT), str(rows_path)], capture_output=True, text=True, cwd=work)
        if not rows_path.is_file():
            raise ExportError(f"check-samples.py 没有跑完：{p.stderr.strip()[-300:]}")
        rows = json.loads(rows_path.read_text(encoding="utf-8"))
        if len(rows) != len(cs.SAMPLES):
            raise ExportError(f"check-samples.py 跑了 {len(rows)} 份，SAMPLES 里有 {len(cs.SAMPLES)} 份")
        tmp_base = tempfile.gettempdir()
        cs_dir = re.compile("(?:" + "|".join(re.escape(f) for f in sorted({os.path.realpath(tmp_base), os.path.abspath(tmp_base)}, key=len, reverse=True)) + r")/[^/\s]+/s\d+")

        def run_sample(i: int, sample: tuple, line: int, code: str):
            name, want, data, *rest = sample
            problems = []
            d = run_root / f"s{i}"
            materialize(d, data, rest, cs)
            raw_input = (d / "round.json").read_text(encoding="utf-8")
            page = json.loads(raw_input)
            if json.dumps(page, ensure_ascii=False) != raw_input:
                problems.append(f"「{name}」的页面数据写不回原样")
            files = collect_files(d)
            norm = normalizer((d, SAMPLE_DIR), (old, OLD_TREE))

            code_, out_, err_ = run_gate(gate, d)
            if "Traceback (most recent call last)" in err_:
                raise ExportError(f"样本「{name}」让旧构建校验异常退出，导出脚本没有处理这种情况")
            traced, trace = run_traced(gate, d, work / f"events-{i}.json")
            if traced != (code_, out_, err_):
                problems.append(f"「{name}」带追踪运行的输出和直接运行不同")
            if replay_text(trace["events"]) != err_:
                problems.append(f"「{name}」追踪到的消息拼不回旧的输出")
            got = verdict_of(code_, out_, err_)

            row = rows[i]
            mine = {"name": name, "want": want, "got": got, "verdict": old_verdict(want, got), "said": norm(said_of(out_, err_))}
            theirs = {**row, "said": cs_dir.sub(SAMPLE_DIR, row["said"])}
            if mine != theirs:
                problems.append(f"「{name}」和 check-samples.py 的结果不同：{theirs} ≠ {mine}")

            return {
                "id": f"legacy-{i + 1:03d}",
                "name": name,
                "source": f"check-samples.py:{line}",
                "code": code,
                "input": page,
                "files": files,
                "expected": VERDICTS[want],
                "actual": VERDICTS[got],
                "match": want == got,
                "messages": build_messages(trace, norm, rules, name),
                "output": {"exit": code_, "stdout": norm(out_), "stderr": norm(err_)},
            }, problems

        with tempfile.TemporaryDirectory() as run_tmp:
            run_root = Path(run_tmp)  # 和 check-samples.py 一样：临时目录下直接放 s0、s1……
            results = parallel(run_sample, [(i, s, line, code) for i, (s, (line, code)) in enumerate(zip(cs.SAMPLES, sources))])
        samples = [r for r, _ in results]
        problems = [p for _, ps in results for p in ps]

        # 汇总：每道检查、每条规则命中了几份样本
        rule_hits, check_hits = defaultdict(set), defaultdict(lambda: defaultdict(set))
        for s in samples:
            for m in s["messages"]:
                rule_hits[m["rule"]].add(s["id"])
                check_hits[m["check"]][m["level"]].add(s["id"])
        rule_list = [{**r, "samples": len(rule_hits[r["id"]])} for r in sorted(rules.values(), key=lambda r: (list(SCOPE).index(r["file"]), r["line"]))]
        checks = []
        for order, (cid, label) in enumerate(CHECKS, 1):
            mine = [r for r in rule_list if r["check"] == cid]
            checks.append({"order": order, "id": cid, "label": label,
                           "rules": len(mine), "rules_hit": sum(1 for r in mine if r["samples"]),
                           "samples_block": len(check_hits[cid]["block"]), "samples_warn": len(check_hits[cid]["warn"])})

        doc = {
            "exported_from": tag,
            "commit": commit,
            "count": len(samples),
            "verdicts": {v: k for k, v in VERDICTS.items()},
            "base": cs.BASE,
            "checks": checks,
            "rules": rule_list,
            "samples": samples,
        }
        text = json.dumps(canonical(doc), ensure_ascii=False, indent=2) + "\n"

        # 用写出去的数据重建每份样本，再跑一遍旧构建校验，输出要逐字不变
        def replay(i: int, s: dict) -> list:
            d = replay_root / f"s{i}"
            write_back(d, s)
            code_, out_, err_ = run_gate(gate, d)
            norm = normalizer((d, SAMPLE_DIR), (old, OLD_TREE))
            if {"exit": code_, "stdout": norm(out_), "stderr": norm(err_)} != s["output"]:
                return [f"「{s['name']}」用导出的数据重跑，输出变了"]
            return []

        with tempfile.TemporaryDirectory() as replay_tmp:
            replay_root = Path(replay_tmp)
            problems += [p for ps in parallel(replay, list(enumerate(json.loads(text)["samples"]))) for p in ps]

        if problems:
            raise ExportError("核对没有通过，没有写文件：\n" + "\n".join(problems))
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(text, encoding="utf-8")

    report(doc, out, rows)


def report(doc: dict, out: Path, rows: list) -> None:
    samples = doc["samples"]
    count = {k: sum(1 for s in samples if s["actual"] == k) for k in ("block", "warn", "pass")}
    print(f"导出了 {doc['count']} 份样本，来自 {doc['exported_from']}（{doc['commit'][:7]}）。")
    print(f"实际判定：拦截 {count['block']} 份，警告 {count['warn']} 份，通过 {count['pass']} 份。")
    print(f"check-samples.py 跑了 {len(rows)} 份，逐份和导出的一致。")
    wrong = [s for s in samples if not s["match"]]
    print("预期和实际全部一致。" if not wrong else "预期和实际不一致的样本：")
    for s in wrong:
        print(f"  {s['id']} {s['name']}：预期 {s['expected']}，实际 {s['actual']}")
    print(f"写到 {out}")
    print("各道检查命中的样本数（拦截、警告）和规则数（命中、总数）：")
    for c in doc["checks"]:
        print(f"  {c['order']:>2} {c['id']:<19} 样本 {c['samples_block']:>2} {c['samples_warn']:>2}  规则 {c['rules_hit']:>2} {c['rules']:>2}  {c['label']}")


def main() -> None:
    if len(sys.argv) == 6 and sys.argv[1] == "--trace-one":
        trace_one(*sys.argv[2:])
        return
    ap = argparse.ArgumentParser(description="把旧 skill 的反例样本连同旧构建校验的判定导出成 JSON")
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
