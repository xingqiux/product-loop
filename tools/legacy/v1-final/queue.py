"""队列：一份固定格式的数据，只由这个脚本写入。构建校验读它，报告网页的看板由它摆出来。

用法：
  python3 queue.py 放进去 <队列.json> --内容 … --阶段 … --提出 … [--依赖 …] [--验收标准 …] [--来源 …] [--子项 …]
  python3 queue.py 拿出来 <队列.json> --内容 … --轮 17
  python3 queue.py 在等什么 <队列.json> --内容 … --依赖 …
  python3 queue.py 做完了 <队列.json> --内容 … --证据 …
  python3 queue.py 不做了 <队列.json> --内容 … --原因 …
  python3 queue.py 看 <队列.json>
内容按前缀匹配，写头几个字就够，对上两件以上会拦截。
"""
import argparse
import datetime
import re
import json
import pathlib
import sys

阶段们 = ("构思", "使用", "检查", "落地", "提升")
状态们 = ("待办", "进行中", "等待", "已完成", "已取消")
文字格 = ("内容", "阶段", "提出", "依赖", "验收标准", "完成证据", "来源", "创建时间")

def 今天() -> str:
    return datetime.date.today().isoformat()

def load(path: pathlib.Path) -> dict:
    """读出整份队列并校验。格式不对的直接报错，不让它流进页面"""
    if not path.is_file():
        return {"版本": 1, "事项": []}
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"队列文件 {path} 不是一份完整的数据：{e}。它只由 scripts/queue.py 写入，不要手改")
    if not isinstance(doc, dict) or not isinstance(doc.get("事项"), list):
        sys.exit(f"队列文件 {path} 的最外层要是 {{版本, 事项: []}}")
    for x in doc["事项"]:
        for 问题 in 查一件(x):
            sys.exit(f"队列文件 {path} 里有一件不合格式：{问题}")
    return doc

def 查一件(x) -> list:
    """一件事要有的十格。缺一格、取值不对的，都在这里说清楚"""
    坏 = []
    if not isinstance(x, dict):
        return [f"一件事要写成对象：{x}"]
    名 = str(x.get("内容") or "")[:20] or "（没写内容）"
    if not str(x.get("内容") or "").strip():
        坏.append("有一件没有写内容。内容是这件事的名字，找它、拿它都靠它")
    for k in 文字格:
        if not isinstance(x.get(k), str):
            坏.append(f"「{名}」缺这一格或写的不是文字：{k}")
    if x.get("阶段") not in 阶段们:
        坏.append(f"「{名}」的阶段要是这五个之一：{' / '.join(阶段们)}")
    s = x.get("状态")
    if not isinstance(s, dict) or s.get("值") not in 状态们:
        坏.append(f"「{名}」的状态要写成 {{值, 说明}}，值是这五个之一：{' / '.join(状态们)}")
    elif not isinstance(s.get("说明"), str):
        坏.append(f"「{名}」的状态少了说明这一层")
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", str(x.get("创建时间") or "")):
        坏.append(f"「{名}」的创建时间要写成年月日，例如 2026-09-22。写别的样子，页面上算不出它停了多久")
    if not isinstance(x.get("子项"), list) or not all(isinstance(t, str) for t in x.get("子项") or []):
        坏.append(f"「{名}」的子项要是一列文字")
    # 并列的几件事用分号挤进内容，读的人要自己拆；写进子项，页面上才摆得开。做完和不做的只是存档，不上看板，不查这一条
    elif (isinstance(s, dict) and s.get("值") not in ("已完成", "已取消")
          and str(x.get("内容") or "").count("；") + str(x.get("内容") or "").count(";") >= 2 and not x.get("子项")):
        坏.append(f"「{名}」把几件并列的事用分号写进了内容。内容只写这件事是什么，并列的几件放进子项")
    return 坏

def save(path: pathlib.Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

def 找一件(doc: dict, 内容: str) -> dict:
    """先按全名找，找不到再按开头的几个字找。一件都对不上，或者对上两件以上，都拦住。
    先全名后前缀，是因为一件的内容正好是另一件的开头时，按全名仍然找得到它"""
    中 = [x for x in doc["事项"] if x["内容"] == 内容] or [x for x in doc["事项"] if x["内容"].startswith(内容)]
    if not 中:
        sys.exit(f"队列里没有「{内容}」这件事。先用「放进去」把它放进队列")
    if len(中) > 1:
        sys.exit("「" + 内容 + "」对上了好几件：" + "；".join(x["内容"][:20] for x in 中) + "。内容多写几个字")
    return 中[0]

def 放进去(doc, a) -> str:
    if a.阶段 not in 阶段们:
        sys.exit(f"阶段要是这五个之一：{' / '.join(阶段们)}")
    if any(x["内容"] == a.内容 for x in doc["事项"]):
        sys.exit(f"队列里已经有「{a.内容}」了。改它的状态用别的操作")
    新 = {"内容": a.内容, "阶段": a.阶段, "提出": a.提出, "创建时间": a.日期 or 今天(),
          "状态": {"值": "待办", "说明": ""}, "依赖": a.依赖 or "", "验收标准": a.验收标准 or "",
          "完成证据": "", "子项": [t for t in (a.子项 or "").split("；") if t.strip()], "来源": a.来源 or ""}
    # 写盘之前先按格式查一遍。不查就写，队列会被写成之后连读都读不开的样子
    for 问题 in 查一件(新):
        sys.exit(f"这一件不合格式，没有放进去：{问题}")
    doc["事项"].append(新)
    return f"放进去了：{a.内容}"

def 拿出来(doc, a) -> str:
    x = 找一件(doc, a.内容)
    if x["状态"]["值"] in ("已完成", "已取消"):
        sys.exit(f"「{x['内容']}」已经{x['状态']['值']}了，不能再拿出来。重新要做的，用「放进去」记一件新的")
    x["状态"] = {"值": "进行中", "说明": f"已进{x['阶段']}第 {a.轮} 轮"}
    return f"拿出来了：{x['内容']}"

def 在等什么(doc, a) -> str:
    x = 找一件(doc, a.内容)
    if not (a.依赖 or "").strip():
        sys.exit("在等什么要写明等的是什么，用 --依赖")
    x["状态"] = {"值": "等待", "说明": a.依赖}
    x["依赖"] = a.依赖
    return f"记下了在等什么：{x['内容']}"

def 做完了(doc, a) -> str:
    x = 找一件(doc, a.内容)
    if not (a.证据 or "").strip():
        sys.exit("做完了要写完成证据，用 --证据。看得见的东西才算做完")
    x["状态"] = {"值": "已完成", "说明": a.证据}
    x["完成证据"] = a.证据
    return f"记下了做完：{x['内容']}"

def 不做了(doc, a) -> str:
    x = 找一件(doc, a.内容)
    if not (a.原因 or "").strip():
        sys.exit("不做了要写原因，用 --原因")
    x["状态"] = {"值": "已取消", "说明": a.原因}
    return f"记下了不做：{x['内容']}"

def 看(doc, a) -> str:
    行 = [f"{x['状态']['值']}　{x['阶段']}　{x['内容'][:40]}" for x in doc["事项"]]
    return "\n".join(行) if 行 else "队列是空的"

def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("操作", choices=["放进去", "拿出来", "在等什么", "做完了", "不做了", "看"])
    p.add_argument("文件")
    for k in ("--内容", "--阶段", "--提出", "--依赖", "--验收标准", "--来源", "--子项", "--证据", "--原因", "--轮", "--日期"):
        p.add_argument(k, default="")
    a = p.parse_args()
    path = pathlib.Path(a.文件)
    doc = load(path)
    if a.操作 != "看" and not a.内容.strip():
        sys.exit("要写 --内容")
    if a.操作 == "放进去" and not (a.提出.strip() and a.阶段.strip()):
        sys.exit("放进去要写 --阶段 和 --提出")
    if a.操作 == "拿出来" and not a.轮.strip():
        sys.exit("拿出来要写 --轮，记下它进的是第几轮")
    说 = {"放进去": 放进去, "拿出来": 拿出来, "在等什么": 在等什么, "做完了": 做完了, "不做了": 不做了, "看": 看}[a.操作](doc, a)
    if a.操作 != "看":
        save(path, doc)
    print(说)

if __name__ == "__main__":
    main()
