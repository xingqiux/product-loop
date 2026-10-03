"""把一轮的 JSON 灌进报告模板，生成这一轮的网页。

用法：python3 build-report.py report-4.json report-4.html [项目的队列文件]
JSON 字段见 templates/README.md。模板本身不改，所有轮次长一个样。
队列文件不写就顺着 JSON 所在的位置往上找 队列.json、.product-loop/队列.json 或 docs/队列.json。
"""
import difflib
import json
import pathlib
import re
import sys

TEMPLATE_DIR = pathlib.Path(__file__).resolve().parent.parent / "templates" / "report"

def load_template() -> str:
    """模板拆成了几个文件：shell.html 是壳，*.css、*.js 按文件名的顺序拼进去。生成出来仍然是一个 html，本机双击就能打开"""
    shell = (TEMPLATE_DIR / "shell.html").read_text(encoding="utf-8")
    css = "\n".join(p.read_text(encoding="utf-8") for p in sorted(TEMPLATE_DIR.glob("*.css")))
    js = "\n".join(p.read_text(encoding="utf-8") for p in sorted(TEMPLATE_DIR.glob("*.js")))
    return shell.replace("/*@css*/", css, 1).replace("/*@js*/", js, 1)
EVIDENCE_TYPES = {"sizes", "swatches", "type", "spacing", "image", "excerpt", "live"}
STAGES = ("构思", "使用", "检查", "落地", "提升")
CARD_BLOCKS = ("asks", "findings", "improvements", "rethink")

# 措辞一类只提醒、不拦住：要看上下文，可能是正当的引用。结构一类才拦住
WORDING = [
    ("不写红方、蓝方，候选就叫候选", re.compile(r"红方|蓝方")),
    ("不用间隔号", re.compile("[\u00b7\u30fb]")),
    ("用书面语，不用口头说法", re.compile(r"我站|站\s*[abc](?![a-z])|接着跑|抠|定过")),
    ("不拿编号指代东西，第一次出现写它的名字", re.compile(r"(场景|任务|决定|疑问|发现|提升)\s*\d+")),
    ("不对用户报统计数字", re.compile(r"\d+\s*(处|项|个问题|次|%|％)|(通过|失败)\s*\d+|\d+\s*(通过|失败)")),
]
SKIP_KEYS = {"usedIn", "state", "since", "origin", "diagrams", "diagram", "research", "land", "landDir", "sketch", "mock", "html", "css", "src", "key", "type", "from", "textBefore", "textAfter", "diff", "queueRow", "hex", "kind", "easing", "effect", "as", "tone"}

def walk_text(node, where):
    """数据里 AI 填的每一段字，连同它在哪里"""
    if isinstance(node, str):
        yield where, node
    elif isinstance(node, list):
        for i, x in enumerate(node):
            yield from walk_text(x, where)
    elif isinstance(node, dict):
        label = node.get("title") or node.get("name") or ""
        for k, v in node.items():
            if k in SKIP_KEYS:
                continue
            yield from walk_text(v, f"{where}「{label}」" if label and "「" not in where else where)

def wording_notes(data):
    notes = []
    # 选项长短差得太多：多半是一个认真写、其余陪衬。只提醒，字数齐不等于内容真
    # 落地的页交出去之前，AI 自己先挑一遍刺，写进提升；真的没有，用 noLift 写一句为什么
    if data.get("stage") == "落地" and not (data.get("improvements") or []) and not str(data.get("noLift") or "").strip():
        notes.append("提醒：这一页是落地，提升（improvements）是空的。交出去之前以设计师的眼光把刚做出来的看一遍，把自己觉得还不对的写进提升：哪里、为什么、是小毛病还是设计问题；设计问题同时进队列标构思。看过了确实没有，写 noLift 说一句为什么")
    for block in CARD_BLOCKS:
        for f in data.get(block) or []:
            opts = [o for o in f.get("options", []) if o.get("diffs") and o.get("cost")]
            size = [sum(len(str(o.get(k) or "")) for k in ("why", "cost", "when")) + sum(len(str(c)) for c in o.get("diffs") or []) for o in opts]
            if len(size) >= 2 and max(size) > 2.2 * min(size):
                notes.append(f"提醒：{block}「{f.get('title')}」的选项长短差得太多。每个选项写到同样深：选了它能不能直接动手做。代价写取舍，不写反驳")
    for block in CARD_BLOCKS + ("changes", "current", "progress", "queue", "screens", "usage", "scenes", "spec"):
        for where, text in walk_text(data.get(block), block):
            for rule, pat in WORDING:
                m = pat.search(text)
                if m:
                    notes.append(f"提醒：{where} 里出现「{m.group(0)}」。{rule}。是引用就留着，是写错了就改")
    return notes

def walk_prose(node, where):
    """和 walk_text 一样，但跳过引用的原话和队列里的来源：这些要照录，不参加写作校验"""
    if isinstance(node, str):
        yield where, node
    elif isinstance(node, list):
        for x in node:
            yield from walk_prose(x, where)
    elif isinstance(node, dict):
        if node.get("quote"):
            return
        label = node.get("title") or node.get("name") or ""
        for k, v in node.items():
            if k in SKIP_KEYS:
                continue
            yield from walk_prose(v, f"{where}「{label}」" if label and "「" not in where else where)

def _load(name: str):
    import importlib.util
    spec = importlib.util.spec_from_file_location(name, pathlib.Path(__file__).resolve().parent / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

writing = _load("writing")
queue = _load("queue")
CELL_MAX = 60  # 选项卡的一格最多两行
ROW_MAX = 8  # 对照表的行名最多八个字

def check_writing(data):
    """写作规范的五项。拦截的直接停下；警告的交给 wording_notes 一起打印。设计规范区块要展示反例，不参加"""
    warns, blocks = [], []
    for blk in CARD_BLOCKS + ("align", "changes", "current", "progress", "queue", "screens", "usage", "scenes"):
        for where, text in walk_prose(data.get(blk), blk):
            block, warn = writing.check(text)
            # 队列的文字是从队列数据里摆进来的，不属于这一页。拦住它会连累整份报告生成不出来，
            # 而队列不许手改，所以这一块的问题只提醒，由写的人下一次用队列脚本重写那一件
            if blk == "queue":
                warns += [f"提醒：{where}：{x}（队列数据里的文字，用 scripts/queue.py 重写那一件）" for x in block + warn]
                continue
            blocks += [f"{where}：{x}" for x in block]
            warns += [f"提醒：{where}：{w}" for w in warn]
    if blocks:
        sys.exit("以下文字不符合写作规范（主线的设计规范「写作规范」）：\n" + "\n".join(dict.fromkeys(blocks)))
    return warns

def text_diff(before: str, after: str, context: int = 2):
    """文字的改前改后算成逐行对比。对比是确定的计算，在这里算好，模板只负责上色。
    每一行：{k: same / del / ins / mix / gap, parts: [[same|del|ins, 字]]}"""
    a, b = before.strip("\n").split("\n"), after.strip("\n").split("\n")
    rows = []
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            rows += [{"k": "same", "parts": [["same", x]]} for x in a[i1:i2]]
            continue
        olds, news = a[i1:i2], b[j1:j2]
        used = set()
        for x in olds:
            # 改了一部分的行，和它最像的那一行配成一对，行内标出删的字和加的字
            best, score = None, 0.3
            for k, y in enumerate(news):
                r = difflib.SequenceMatcher(None, x, y, autojunk=False).ratio()
                if k not in used and r > score:
                    best, score = k, r
            if best is None:
                rows.append({"k": "del", "parts": [["del", x]]})
                continue
            for k in range(best):
                if k not in used:
                    used.add(k)
                    rows.append({"k": "ins", "parts": [["ins", news[k]]]})
            used.add(best)
            parts = []
            for t, p1, p2, q1, q2 in difflib.SequenceMatcher(None, x, news[best], autojunk=False).get_opcodes():
                if t == "equal":
                    parts.append(["same", x[p1:p2]])
                else:
                    if p2 > p1:
                        parts.append(["del", x[p1:p2]])
                    if q2 > q1:
                        parts.append(["ins", news[best][q1:q2]])
            rows.append({"k": "mix", "parts": parts})
        rows += [{"k": "ins", "parts": [["ins", y]]} for k, y in enumerate(news) if k not in used]
    # 没有变化的长段折起来，只留改动前后各几行
    keep = [False] * len(rows)
    for i, r in enumerate(rows):
        if r["k"] != "same":
            for k in range(max(0, i - context), min(len(rows), i + context + 1)):
                keep[k] = True
    out, gap = [], False
    for i, r in enumerate(rows):
        if keep[i] or not r["parts"][0][1].strip() and i and keep[i - 1]:
            out.append(r)
            gap = False
        elif not gap:
            out.append({"k": "gap", "parts": []})
            gap = True
    return out

def find_queue_file(src: pathlib.Path):
    """顺着这一轮数据所在的位置往上找项目的队列数据。只认新格式；只剩旧格式的，让项目先迁过去"""
    旧 = None
    for d in list(src.resolve().parents)[:6]:
        for sub in ("", ".product-loop", "docs"):
            base = d / sub if sub else d
            if (base / "队列.json").is_file():
                return base / "队列.json"
            旧 = 旧 or ((base / "队列.md") if (base / "队列.md").is_file() else None)
    if 旧:
        sys.exit(f"队列文件 {旧} 还是旧的表格格式。队列已经改成一份固定字段的数据，只由 scripts/queue.py 写入：把这张表里每一行迁进 队列.json（十格：内容、阶段、提出、创建时间、状态、依赖、验收标准、完成证据、子项、来源），迁完删掉旧文件")
    return None

def 摆出队列(doc):
    """队列不再由人手抄进页面数据，由这里从队列数据直接摆出来。做完和不做的不上看板"""
    live = [x for x in doc["事项"] if x["状态"]["值"] in ("待办", "进行中", "等待")]
    return [{"stage": x["阶段"], "text": x["内容"], "from": x["提出"], "state": x["状态"]["值"],
             "note": x["状态"]["说明"], "since": x["创建时间"], "dep": x["依赖"],
             "accept": x["验收标准"], "proof": x["完成证据"], "items": x["子项"], "origin": x["来源"]}
            for x in live]

def queue_refs(node):
    """这一页里写明「从队列的哪一行拿出来的」的地方：任何一处的 queueRow，字符串或数组"""
    if isinstance(node, dict):
        for k, v in node.items():
            if k == "queueRow":
                yield from ([v] if isinstance(v, str) else [x for x in v if isinstance(x, str)])
            else:
                yield from queue_refs(v)
    elif isinstance(node, list):
        for x in node:
            yield from queue_refs(x)

def check_queue_file(data, path):
    """进入一个阶段，队列数据里属于这个阶段、还没做完的，要全部拿进这一页。
    确实要等别的事的，在队列数据里标成「等待」并写明依赖，不必拿进来"""
    stage = data.get("stage")
    refs = [r.strip() for r in queue_refs(data) if r.strip()]
    for r in refs:
        if len(r) < 6:
            print(f"提醒：这一页写的 queueRow「{r}」不到六个字，这一次没有拿它去对队列。写队列那一件内容开头的六个字以上", file=sys.stderr)
    named = [r for r in refs if len(r) >= 6]
    doc = queue.load(path)
    # 先按全名对，对不上再按开头的几个字对。一个 queueRow 同时对上两件时拦住：
    # 两件的内容互为开头时，写短的那一个会把另一件也算成拿出来了，规则就失效了
    got = set()
    for r in named:
        中 = [x for x in doc["事项"] if x["内容"] == r] or [x for x in doc["事项"] if x["内容"].startswith(r)]
        if not 中:
            print(f"提醒：这一页写的 queueRow「{r[:30]}」在队列数据里对不上任何一件。是不是抄错了", file=sys.stderr)
        elif len(中) > 1:
            sys.exit("这一页写的 queueRow「" + r[:30] + "」同时对上了好几件：" + "；".join(x["内容"][:20] for x in 中) + "。多写几个字，让它只对上一件")
        else:
            got.add(中[0]["内容"])
    for x in doc["事项"]:
        if x["阶段"] != stage or x["状态"]["值"] in ("已完成", "已取消", "等待"):
            continue
        if x["内容"] not in got:
            sys.exit(f"队列数据（{path}）里还有属于当前阶段（{stage}）的事没有拿出来：「{x['内容'][:40]}」。拿进这一页，在那张卡或那条更改上写 queueRow（这一件内容开头的几个字，至少六个）；确实要等别的事先确定的，用 python3 scripts/queue.py 在等什么 写明等的是什么")
    data["queue"] = 摆出队列(doc)

def check_cards(data) -> None:
    """每张卡：来源一条一条、选项写齐、陪衬的检验"""
    for block in CARD_BLOCKS:
        for f in data.get(block, []):
            # 来源：一条一条的，每条配一张同名的图。用户说过的话是原话（quote），不配图
            srcs = f.get("sources")
            if not (isinstance(srcs, list) and srcs):
                sys.exit(f"{block} 每张卡都要写来源（sources）：[{{name, saw, src}}]，一条一样东西：它叫什么、在它上面看到了什么、它的图。用户说过的话写成 {{name, saw, quote: true}}，不配图。只写一段话（saw）读的人找不到它在哪：{f.get('title')}")
            for x in srcs:
                if not (isinstance(x, dict) and str(x.get("name") or "").strip()):
                    sys.exit(f"{block} 的来源每一条要有 name（这样东西叫什么）：{f.get('title')}")
                if not x.get("quote") and not str(x.get("src") or "").strip():
                    sys.exit(f"{block} 的来源「{x.get('name')}」没有图（src）。界面用截图；文字用那一段原文的截图（scripts/shot-text.mjs），相关的几行标出来。没看过的不写：{f.get('title')}")
                if x.get("quote") and not str(x.get("saw") or "").strip():
                    sys.exit(f"{block} 的来源「{x.get('name')}」是原话，saw 里要写出原话：{f.get('title')}")
            opts = f.get("options", [])
            # 只有一个可行方向：不凑数。写明只有这一个，列出排除掉的方向，用户同意或否决
            if f.get("only"):
                if len(opts) != 1 or not f.get("dropped"):
                    sys.exit(f"{block} 写了 only（只有这一个方向）的卡，options 只能有一个，并且要有 dropped（想过、排除掉的方向）：{f.get('title')}")
                opts[0]["key"] = "同意"
            elif len(opts) == 1:
                sys.exit(f"{block} 只有一个选项。真的只有这一个方向，就写 only: true，并在 dropped 里列出排除掉的方向和原因；不要凑第二个：{f.get('title')}")
            for x in f.get("dropped") or []:
                if not (isinstance(x, dict) and str(x.get("name") or "").strip() and str(x.get("because") or "").strip()):
                    sys.exit(f"{block} 的 dropped 每一项要有 name（这个方向）和 because（为什么排除）：{f.get('title')}")
            # 选项卡的版式（决定 109）：共同的部分写一遍，选项只写差别，按行对照。旧的 see 字段不再接受
            rows = f.get("rows") or []
            if opts:
                for r in rows if isinstance(rows, list) else []:
                    # 行名过长会在对照表里换行，把整行撑高；过长通常也说明这一行混了两处差别
                    if isinstance(r, str) and writing.width(r) > ROW_MAX:
                        sys.exit(f"{block} 的行名「{r}」超过 {ROW_MAX} 个字（一个汉字算一个字，两个英文字母或数字算一个字）。行名是一处差别的名称，写成短语；一个名字说不完，多半是这一行混了两处差别，拆成两行：{f.get('title')}")
                if not (isinstance(rows, list) and rows and all(isinstance(r, str) and r.strip() for r in rows)):
                    sys.exit(f"{block} 带选项的卡要写 rows：选项之间有差别的地方，每处起一个名称，例如 [\"包含的步骤\", \"脚本是否拦截\"]：{f.get('title')}")
                sh = f.get("shared")
                if len(opts) >= 2 and not (isinstance(sh, dict) and str(sh.get("text") or "").strip()):
                    sys.exit(f"{block} 有两个以上选项的卡要写 shared：{{text, diagrams?}}，几个选项共同的部分只写一遍：{f.get('title')}")
            for o in opts:
                # 发现和提升的最后一个选项可以是「不改」，只写留下的是什么
                last = o is opts[-1] and block in ("findings", "improvements")
                if "see" in o:
                    sys.exit(f"{block} 选项 {o.get('key')} 还在用旧的 see 字段。改为新格式：卡上写 rows（差别的名称），每个选项写 diffs（和 rows 一一对应，每格只写这个选项在这一处的做法），共同的部分写进卡的 shared：{f.get('title')}")
                diffs = o.get("diffs") or []
                if not isinstance(diffs, list) or len(diffs) != len(rows) or not all(isinstance(c, str) and c.strip() for c in diffs):
                    sys.exit(f"{block} 选项 {o.get('key')} 的 diffs 要和 rows 一一对应，每格都要写（rows 有 {len(rows)} 行，diffs 有 {len(diffs)} 格）：{f.get('title')}")
                for c in diffs:
                    if writing.length(str(c)) > CELL_MAX:
                        sys.exit(f"{block} 选项 {o.get('key')} 的差别有一格超过两行。一格只写这个选项在这一处的做法，共同的内容移到 shared：{str(c)[:30]}……")
                if not last and not (o.get("why") and o.get("cost")):
                    sys.exit(f"{block} 选项 {o.get('key')} 缺理由 why 或代价 cost：{f.get('title')}")
                # 陪衬的检验：一个真选项一定存在某种情况是它最好。说不出来就不是选项
                if not last and not f.get("only") and not str(o.get("when") or "").strip():
                    sys.exit(f"{block} 选项 {o.get('key')} 没写 when（什么情况下该选它）。说不出来的选项是陪衬，删掉；只剩一个方向就写 only：{f.get('title')}")

def check_evidence(data) -> None:
    """每张卡右边的证据、位置、我的看法"""
    for block in CARD_BLOCKS:
        for f in data.get(block, []):
            evs = f.get("evidence")
            for e in (evs if isinstance(evs, list) else [evs]) if evs else []:
                if not isinstance(e, dict) or e.get("type") not in EVIDENCE_TYPES:
                    sys.exit(f"{block} 的 evidence.type 只能是 {sorted(EVIDENCE_TYPES)}：{f.get('title')}")
            # 发现和提升要写清问题出现的位置（右边画成位置图）
            if block in ("findings", "improvements") and not f.get("where"):
                sys.exit(f"{block} 每张卡都要有 where（问题出现的位置：哪个场景、哪一步）：{f.get('title')}")
            for e in (evs if isinstance(evs, list) else [evs]) if evs else []:
                if e.get("type") == "excerpt":
                    sys.exit(f"{block} 的右边不放文字：excerpt 证据去掉，要说的话写在左边「看到」里：{f.get('title')}")
                if e.get("type") == "live" and not (e.get("html") and e.get("css") and e.get("from")):
                    sys.exit(f"{block} 的 live 证据要有 html、css 和 from（从哪一屏哪个组件提取的）：{f.get('title')}")
            w = f.get("where")
            if w is not None and not (isinstance(w, dict) and w.get("scenario") and w.get("step")):
                sys.exit(f"{block} 的 where 要有 scenario 和 step：{f.get('title')}")
            if w is not None and not (w.get("title") and w.get("stepText")):
                sys.exit(f"{block} 的 where 要写名字：title 是场景的名字，stepText 是这一步做什么。只写编号读的人看不懂：{f.get('title')}")
            st = f.get("stance")
            if st and not (isinstance(st, dict) and st.get("pick") and st.get("because")):
                sys.exit(f"{block} 的 stance 只填两格：{{\"pick\": \"a\", \"because\": \"为什么\"}}。「我的看法是」「因为」由模板写：{f.get('title')}")

def check_changes(data) -> None:
    """更改：一对截图，或文字的改前改后"""
    # 更改：界面的给一对截图；文字的给改前、改后的原文，这里算成逐行对比
    for c in data.get("changes", []) or []:
        has_text = "textBefore" in c or "textAfter" in c
        if has_text and not (str(c.get("textBefore") or "").strip() and str(c.get("textAfter") or "").strip()):
            sys.exit(f"changes 里文字的更改要同时给 textBefore（改前的原文）和 textAfter（改后的原文）：{c.get('title')}")
        if not has_text and not ((c.get("after") or {}).get("src")):
            sys.exit(f"changes 每一条要么给一对截图（before / after），要么给文字的改前改后（textBefore / textAfter）。做完只有一种证明：改前改后：{c.get('title')}")
        if has_text:
            c["diff"] = text_diff(c["textBefore"], c["textAfter"])

def check_queue(data) -> None:
    """队列不写进页面数据。它是一份只由脚本写入的数据，看板由构建校验从那份数据摆出来"""
    if data.get("queue"):
        sys.exit("页面数据里不要再手抄 queue（队列）。队列改成了一份固定字段的数据，用 python3 scripts/queue.py 放进去 / 拿出来 / 在等什么 / 做完了 / 不做了 维护它；页面上的看板由构建校验从那份数据直接摆出来。把 queue 从这份数据里删掉")

def check_screens(data) -> None:
    """元素清单"""
    # 元素清单：检查阶段必须留下。每一屏一份，每行写这样东西是什么、它替用户回答什么问题
    screens = data.get("screens")
    if data.get("stage") == "检查" and not screens:
        sys.exit("检查阶段要有元素清单（screens）：每一屏一份，[{name, elements: [{what, answers}]}]。先列清单，再问三个根问题")
    for sc in screens or []:
        if not (isinstance(sc, dict) and sc.get("name") and sc.get("elements")):
            sys.exit(f"screens 每一屏要有 name 和 elements：{sc}")
        for el in sc["elements"]:
            if not (isinstance(el, dict) and str(el.get("what") or "").strip() and str(el.get("answers") or "").strip()):
                sys.exit(f"元素清单每一行要写 what（这样东西是什么）和 answers（它替用户回答什么问题）；答不出来就写「答不出」，并进发现：{sc.get('name')} {el}")

def check_scenes(data) -> None:
    """场景清单"""
    # 场景清单：只在构思阶段出现，有自己的一块。每个场景写名字和步骤，每一步写做什么、该看到什么
    scenes = data.get("scenes")
    if scenes is not None:
        if data.get("stage") != "构思":
            sys.exit("场景清单（scenes）这一块只在构思阶段出现。别的阶段要提到场景，写在那张卡的 where 里")
        for x in scenes or []:
            if not (isinstance(x, dict) and str(x.get("name") or "").strip() and x.get("steps")):
                sys.exit(f"scenes 每个场景要有 name 和 steps：{x}")
            for st in x["steps"]:
                if not (isinstance(st, dict) and str(st.get("do") or "").strip() and str(st.get("see") or "").strip()):
                    sys.exit(f"场景的每一步要写 do（做什么）和 see（该看到什么）：{x.get('name')} {st}")

def check_spec(data) -> None:
    """设计规范这一块"""
    # 设计规范：样张墙。只在构思阶段出现；每一格是看的东西，不是读的
    if data.get("stage") == "构思" and any(c.get("design") for blk in CARD_BLOCKS for c in data.get(blk) or []) and not data.get("spec"):
        sys.exit("这一页有设计类的卡（design），却没有设计规范这一块（spec）。把这个新组件用到的规范摆在同一页：已有的原样摆出来，没有的先补成一格让用户点保留、修改、删除。草稿要对着规范画")
    SPEC_KINDS = ("colors", "type", "radius", "spacing", "motion", "table", "text")
    spec = data.get("spec")
    if spec is not None:
        if data.get("stage") != "构思":
            sys.exit("设计规范（spec）这一块只在构思阶段出现")
        for x in spec or []:
            if not x.get("name") or x.get("kind") not in SPEC_KINDS:
                sys.exit(f"spec 每一格要有 name 和 kind（{' / '.join(SPEC_KINDS)}）：{x}")
            if x["kind"] == "text":
                if not str(x.get("text") or "").strip():
                    sys.exit(f"spec「{x['name']}」是 text，要写 text：一条规则或者一个例子")
                # 一个标题加一段字，用户没法逐条判断（构思第 19 轮真实留下的）。超过三行的拆成表
                if len([l for l in str(x["text"]).splitlines() if l.strip()]) > 3:
                    sys.exit(f"spec「{x['name']}」是一段超过三行的字。规范是看的，不是读的：并列的几条写成 table（columns 是这一类规范自己的列，rows 一行一条），text 只留给一条规则或者一个例子")
                continue
            if x["kind"] == "table":
                cols, rows = x.get("columns") or [], x.get("rows") or []
                if not cols or not all(isinstance(c, dict) and c.get("name") for c in cols):
                    sys.exit(f"spec「{x['name']}」是 table，要有 columns，每一列写 name：{cols}")
                if not rows or not all(isinstance(r, list) and len(r) == len(cols) for r in rows):
                    sys.exit(f"spec「{x['name']}」的 rows 每一行的格数要和 columns 一样多，一行一条规范")
                continue
            vals = x.get("values") or []
            if not vals:
                sys.exit(f"spec「{x['name']}」没有 values。这一格是样张，要有东西给人看")
            for v in vals:
                if x["kind"] == "colors" and not (isinstance(v, dict) and v.get("name") and re.fullmatch(r"#[0-9a-fA-F]{3,8}", str(v.get("hex") or ""))):
                    sys.exit(f"spec「{x['name']}」的每个颜色要有 name 和 hex（#开头的色值）：{v}")
                if x["kind"] == "type" and not (isinstance(v, dict) and v.get("name") and isinstance(v.get("size"), (int, float))):
                    sys.exit(f"spec「{x['name']}」的每个字号要有 name 和 size（数字，像素）：{v}")
                if x["kind"] in ("radius", "spacing") and not isinstance(v, (int, float)):
                    sys.exit(f"spec「{x['name']}」的 values 是一串数字（像素）：{v}")
                if x["kind"] == "motion" and not (isinstance(v, dict) and v.get("name") and isinstance(v.get("ms"), (int, float))):
                    sys.exit(f"spec「{x['name']}」的每个动效要有 name 和 ms（时长，毫秒），可以写 easing 和 effect（move / fade / grow）：{v}")

def check_design(data) -> None:
    """设计类的卡：先看、再画、再谈"""
    # 设计类的卡：先看、再画、再谈。来源里要有外面的东西，每个选项要有画出来的草稿
    for block in CARD_BLOCKS:
        for f in data.get(block) or []:
            if not f.get("design"):
                continue
            outside = [x for x in f.get("sources") or [] if x.get("outside") and x.get("src")]
            if not outside:
                sys.exit(f"{block}「{f.get('title')}」写了 design（设计类的卡），来源里要有至少一个外面的东西：已有的产品或网上的设计，截图放 src，标 outside: true，写一句它怎么解决同一个问题")
            for o in f.get("options") or []:
                if not str(o.get("sketch") or "").strip():
                    sys.exit(f"{block}「{f.get('title')}」是设计类的卡，选项 {o.get('key')} 没有草稿。每个选项画出来：线稿积木，或者一张草稿图")

def check_scene_text(data) -> None:
    """卡里整段写了场景清单"""
    # 场景清单的草稿整段写进一张卡的文字里，读的人看不下去：出现成串的「场景几」就拦住，让它用 scenes
    for block in CARD_BLOCKS:
        for f in data.get(block, []):
            body = "\n".join(str(f.get(k) or "") for k in ("why", "saw")) + "\n".join(str(c) for o in f.get("options", []) for c in (o.get("diffs") or []))
            if len(re.findall(r"(?m)^场景[一二三四五六七八九十\d]+", body)) >= 2:
                sys.exit(f"{block} 这张卡的文字里整段写了场景清单。场景清单有自己的一块：写进 scenes（[{{name, who, mark, steps: [{{do, see, src?}}]}}]），卡里只留要问的那一件事：{f.get('title')}")

def check_usage(data) -> None:
    """使用阶段那一页"""
    # 使用阶段那一页：每个场景一行
    usage = data.get("usage")
    if usage is not None:
        for u in usage.get("scenes", []) or []:
            if not u.get("name") or u.get("state") not in ("走通", "断了", "没有走"):
                sys.exit(f"usage.scenes 每行要有 name 和 state（走通 / 断了 / 没有走）：{u}")
            if u.get("state") != "走通" and not u.get("stepText"):
                sys.exit(f"usage.scenes 断了或没有走的要写 stepText（断在哪一步，或为什么没有走）：{u.get('name')}")

SPEC_TWELVE = ("信息结构", "配色", "字体", "布局", "交互", "动效", "图标", "文案", "给 AI", "状态", "无障碍", "做法")
RESEARCH_TIERS = ("不查", "快查", "深查")

def check_mainline(data, qf) -> None:
    """主线的设计规范要回答十二样。检查阶段对着它查一致，缺了拦住；别的阶段只提醒"""
    f = qf.parent / "主线.md" if qf else None
    if not (f and f.is_file()):
        return
    text = f.read_text(encoding="utf-8")
    m = re.search(r"(?ms)^##[^#\n]*设计规范.*?(?=^##\s|\Z)", text)
    body = m.group(0) if m else ""
    missing = [k for k in SPEC_TWELVE if not re.search(rf"(?m)^\s*(\||#+|[-*])\s*[^|\n]{{0,14}}{re.escape(k)}", body)]
    if not missing:
        return
    msg = f"主线的设计规范还缺这几样：{'、'.join(missing)}。按 references/构思反问.md 把缺的问一遍，每样写一个值、一条规则或一个例子；这个产品没有的写「无」和原因"
    if data.get("stage") == "检查":
        sys.exit(msg + "。检查阶段的交互一致性要对着它查，缺了没法查")
    print("提醒：" + msg, file=sys.stderr)

def check_research(data) -> None:
    """调研分三档。构思里带着外面看来的东西的卡，要写明这一条是哪一档"""
    if data.get("stage") != "构思":
        return
    for f in data.get("asks") or []:
        if not any(x.get("outside") for x in f.get("sources") or []):
            continue
        r = f.get("research") or {}
        if not isinstance(r, dict):
            sys.exit(f"asks「{f.get('title')}」的 research 要写成对象：{{tier: …}}，不是一个词")
        if r.get("tier") not in RESEARCH_TIERS:
            sys.exit(f"asks「{f.get('title')}」带着外面看来的东西，要写 research：{{tier: {' / '.join(RESEARCH_TIERS)}}}。先定胃口再查")
        if r["tier"] == "深查" and not str(r.get("approved") or "").strip():
            sys.exit(f"asks「{f.get('title')}」是深查，要写 approved：问句和检索计划是哪一轮给用户批的")
        if r["tier"] == "不查" and not str(r.get("reason") or "").strip():
            sys.exit(f"asks「{f.get('title')}」写了不查，要写 reason：为什么这一条不用查")

def short_cmd(cmd) -> str:
    """命令里很长的绝对路径只留最后一段，给人看的"""
    return " ".join(("…/" + t.rstrip("/'\"").split("/")[-1]) if t.lstrip("'\"").startswith("/") and t.count("/") > 2 else t for t in cmd)

def failing_line(tail: str) -> str:
    """失败那一次的输出里，挑出说哪里失败的那一行；通过的行（对、走通）跳过"""
    lines = [l.strip() for l in tail.splitlines() if l.strip()]
    bad = [l for l in lines if not l.startswith(("对", "走通"))]
    return (bad[0] if bad else (lines[-1] if lines else "失败"))[:120]

DIAGRAM_KINDS = ("流程图", "时序图", "状态图", "架构图", "思维导图", "象限图", "时间线", "改前改后的结构", "目录树")

def iter_diagrams(data):
    for blk in CARD_BLOCKS:
        for f in data.get(blk) or []:
            for g in f.get("diagrams") or []:
                yield f"{blk}「{f.get('title')}」", g
            for g in ((f.get("shared") or {}).get("diagrams") or []) if isinstance(f.get("shared"), dict) else []:
                yield f"{blk}「{f.get('title')}」共同的部分", g
    for a in data.get("align") or []:
        if isinstance(a, dict) and a.get("diagram"):
            yield f"align「{a.get('name')}」", a["diagram"]

def check_diagrams(data) -> None:
    """图表：种类要在主线「内容配什么形式」那张表里；要有标题；架构图的每条线写明关系"""
    for where, g in iter_diagrams(data):
        if not isinstance(g, dict) or g.get("kind") not in DIAGRAM_KINDS:
            sys.exit(f"{where} 的图表要写 kind，取值是：{' / '.join(DIAGRAM_KINDS)}。内容对不上任何一种的，不画图")
        if not str(g.get("title") or "").strip() or not str(g.get("code") or "").strip():
            sys.exit(f"{where} 的图表要有 title（标题）和 code（文字定义）：{g.get('kind')}")
        if g["kind"] == "架构图":
            for line in str(g["code"]).splitlines():
                prev = 0
                for m in re.finditer(r"(--+>|==+>|-\.+->)(\|[^|]+\|)?", line):
                    # 逐条线判断：箭头后面跟着 |关系|，或者箭头前面这一段是「-- 关系」
                    seg, prev = line[prev:m.start()], m.end()
                    labelled = bool(m.group(2)) or bool(re.search(r"(--|==|-\.)\s*[^\s\-=.>|][^>]*$", seg))
                    if not labelled:
                        sys.exit(f"{where} 的架构图里有一条线没有写明关系：{line.strip()}。每条线写明是什么关系，例如 A-- 调用 -->B")

REF_FIELDS = (
    ("kind", "类型", ("书", "文章", "规范", "产品", "开源项目", "研究")),
    ("depth", "阅读深度", ("已读原文", "仅摘要")),
    ("relevance", "相关度", ("高", "中", "低")),
    ("strength", "证据强度", ("强", "中", "弱")),
    ("advice", "建议", ("采用", "试用", "观察", "不用")),
)

def check_refs(data) -> None:
    """参考（构思第 21 轮定的取值）：五格都是枚举，正文写清它说了什么"""
    if not isinstance(data.get("refs") or [], list):
        sys.exit("refs 要写成列表：[{name, kind, depth, relevance, strength, advice, body, where?}]")
    for r in data.get("refs") or []:
        name = str((r or {}).get("name") or "").strip() if isinstance(r, dict) else ""
        if not name:
            sys.exit("参考的每一条要写 name：这样东西叫什么")
        for key, label, vals in REF_FIELDS:
            if str(r.get(key) or "").strip() not in vals:
                sys.exit(f"参考「{name}」的 {key}（{label}）只能是：{' / '.join(vals)}。现在写的是「{r.get(key)}」")
        if not str(r.get("body") or "").strip():
            sys.exit(f"参考「{name}」要写 body：它说了什么，以及这个项目用到了哪一条")

def check_align(data) -> None:
    """先对齐的小卡（决定 114）：名称、用在、意思、例子齐全；「用在」写的是本页疑问卡的标题"""
    titles = [str(f.get("title") or "") for f in data.get("asks") or []]
    seen = set()
    if not isinstance(data.get("align") or [], list):
        sys.exit("align 要写成列表：[{name, usedIn, meaning, example, diagram?}]")
    for a in data.get("align") or []:
        name = str((a or {}).get("name") or "").strip() if isinstance(a, dict) else ""
        if not name:
            sys.exit("align 的每一项要写 name：要对齐的术语，全篇只用这一个名称")
        if name in seen:
            sys.exit(f"align 里「{name}」出现了两次，一个术语只对齐一次")
        seen.add(name)
        for key, label in (("meaning", "意思，一句话"), ("example", "例子，这个项目里的一件真事")):
            if not str(a.get(key) or "").strip():
                sys.exit(f"align「{name}」缺 {key}（{label}）")
        used = a.get("usedIn") or []
        if not isinstance(used, list) or not used:
            sys.exit(f"align「{name}」要写 usedIn：哪几张疑问卡用到它，写卡的标题")
        for u in used:
            if u not in titles:
                sys.exit(f"align「{name}」的 usedIn 写的「{u}」不是本页任何一张疑问卡的标题")

def check_land(data, src: str) -> None:
    """落地的页：有更改，就要有落地的记录，五步齐了才放行。记录摆进页面的工程证据那一块"""
    data.pop("land", None)  # 这一块只由这里摆进去，数据里自己写的不收
    if data.get("stage") != "落地" or not (data.get("changes") or []):
        return
    rel = str(data.get("landDir") or "").strip()
    if not rel:
        sys.exit("落地的页有更改，要写 landDir：这一轮落地的记录在哪个文件夹（相对这份数据的位置）。代码里面也要有人看：计划、整理、先失败后通过、评审，由 scripts/land.py 记")
    d = (pathlib.Path(src).parent / rel).resolve()
    if not d.is_dir():
        sys.exit(f"landDir 指的文件夹不存在：{d}")
    import importlib.util
    spec = importlib.util.spec_from_file_location("land", pathlib.Path(__file__).resolve().parent / "land.py")
    land = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(land)
    ev = land.evidence(d)  # 不齐的时候它自己停下并说缺哪一步
    data["land"] = {
        "tidy": {"skipped": True} if ev["tidy"].get("skipped") else {"commit": ev["tidy"].get("commit"), "cmd": short_cmd(ev["tidy"].get("cmd") or [])},
        "changes": [{"name": k, "cmd": short_cmd(v["red"]["cmd"]), "red": [failing_line(v["red"]["tail"])], "green": ["通过"]} for k, v in ev["changes"].items()],
        "review": ev["review"],
        "rulings": [[c.strip() for c in line.strip().strip("|").split("|")] for line in ev["rulings"].splitlines() if line.strip().startswith("|") and "---" not in line][1:],
    }

def check_queue_source(data, src: str, queue_path: str) -> 'pathlib.Path | None':
    """项目的队列文件：拿没拿全由这里判定，不靠 AI 自己记得去读"""
    qf = pathlib.Path(queue_path) if queue_path else find_queue_file(pathlib.Path(src))
    if queue_path and not qf.is_file():
        sys.exit(f"找不到队列文件：{queue_path}")
    if qf:
        check_queue_file(data, qf)
    else:
        data["queue"] = []
        print("提醒：没有找到项目的队列数据（队列.json 或 .product-loop/队列.json），队列里属于当前阶段的事有没有拿全，这一次没有查。用 python3 scripts/queue.py 放进去 建一份", file=sys.stderr)
    return qf if qf else None

def main(src: str, dst: str, queue_path: str = "") -> None:
    raw = pathlib.Path(src).read_text(encoding="utf-8")
    data = json.loads(raw)  # 先校验，坏 JSON 直接报错
    for key in ("system", "stage", "round", "date"):
        if key not in data:
            sys.exit(f"JSON 缺字段 {key}")
    if data["stage"] not in STAGES:
        sys.exit(f"stage 只能是五个阶段之一（{' / '.join(STAGES)}）：{data['stage']}。「修复」已经改名叫「落地」")
    check_cards(data)
    check_evidence(data)
    check_changes(data)
    check_queue(data)
    qf = check_queue_source(data, src, queue_path)
    check_mainline(data, qf)
    check_research(data)
    check_screens(data)
    check_scenes(data)
    check_spec(data)
    check_design(data)
    check_scene_text(data)
    check_usage(data)
    check_diagrams(data)
    check_align(data)
    check_refs(data)
    check_land(data, src)
    for note in check_writing(data) + wording_notes(data):
        print(note, file=sys.stderr)
    html = load_template()
    html = re.sub(
        r'(<script id="report-data" type="application/json">)(.*?)(</script>)',
        lambda m: m.group(1) + "\n" + json.dumps(data, ensure_ascii=False, indent=1).replace("</", "<\\/") + "\n" + m.group(3),
        html,
        count=1,
        flags=re.S,
    )
    html = html.replace("<title>产品循环报告</title>", f"<title>{data['system']} {data['stage']} 第 {data['round']} 轮</title>", 1)
    pathlib.Path(dst).write_text(html, encoding="utf-8")
    print("写好了", dst)

if __name__ == "__main__":
    if len(sys.argv) not in (3, 4):
        sys.exit(__doc__)
    main(*sys.argv[1:])
