// 页面数据定义的简表：一行一个字段，写字段名、必填与否、类型和一句说明。
// ploop page schema --brief 打印它。完整的 JSON Schema 有几十 KB，写一页数据前先看简表，
// 用到哪个字段再查完整的定义。只读 JSON Schema，不碰别的。

type Node = { [key: string]: unknown };

const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nodeOf = (value: unknown): Node => (isNode(value) ? value : {});
const nodesOf = (value: unknown): Node[] => (Array.isArray(value) ? value.filter(isNode) : []);

/** 说明的第一句。没有句号就整段。 */
function firstSentence(text: unknown): string {
  if (typeof text !== "string") return "";
  const flat = text.replace(/\s+/gu, " ").trim();
  const end = flat.search(/[。！？]/u);
  return end < 0 ? flat : flat.slice(0, end + 1);
}

/** 一处 $ref 指到的定义。只认 #/$defs/<名字>。 */
function deref(root: Node, node: Node): { node: Node; name?: string } {
  const ref = node["$ref"];
  if (typeof ref !== "string") return { node };
  const name = ref.replace(/^#\/\$defs\//u, "");
  const target = nodeOf(nodeOf(root["$defs"])[name]);
  // 引用处写的说明比定义里的更具体，用引用处的。
  const description = node["description"];
  return { node: description === undefined ? target : { ...target, description }, name };
}

/** 一个字段的类型，写给人看。 */
function typeWord(node: Node): string {
  const values = node["enum"];
  if (Array.isArray(values)) return `${values.join("、")} 之一`;
  if (node["const"] !== undefined) return `只能写 ${String(node["const"])}`;
  switch (node["type"]) {
    case "string":
      return "文字";
    case "boolean":
      return "true 或 false";
    case "integer":
    case "number":
      return "数字";
    case "array":
      return "列表";
    default:
      return "";
  }
}

type Walk = {
  readonly root: Node;
  readonly lines: string[];
  /** 已经展开过的定义：路径。再遇到只写一行指回去。 */
  readonly seen: Map<string, string>;
};

const indentOf = (depth: number) => "  ".repeat(depth);

/** 对象的每个字段一行，字段是对象或对象的列表时接着往下写。 */
function walkObject(walk: Walk, object: Node, path: string, depth: number): void {
  const required = new Set(Array.isArray(object["required"]) ? object["required"] : []);
  const props = nodeOf(object["properties"]);
  for (const [key, raw] of Object.entries(props)) {
    const { node, name } = deref(walk.root, nodeOf(raw));
    const items = node["type"] === "array" ? deref(walk.root, nodeOf(node["items"])) : undefined;
    const inner = items?.node ?? node;
    const innerName = items === undefined ? name : items.name;
    const label = `${key}${items === undefined ? "" : "[]"}`;
    const here = path === "" ? label : `${path}.${label}`;
    const kind = items === undefined ? typeWord(node) : "列表";
    const note = firstSentence(node["description"]);
    const mark = required.has(key) ? " *" : "";
    const tail = [kind, note].filter((part) => part !== "").join("：");
    const seenAt = innerName === undefined ? undefined : walk.seen.get(innerName);
    const head = `${indentOf(depth)}${label}${mark}`;
    if (seenAt !== undefined && seenAt !== here && hasFields(inner)) {
      walk.lines.push(`${head}  ${tail}（字段同 ${seenAt}）`.trimEnd());
      continue;
    }
    walk.lines.push(`${head}  ${tail}`.trimEnd());
    if (innerName !== undefined && hasFields(inner)) walk.seen.set(innerName, here);
    walkInto(walk, inner, here, depth + 1);
  }
}

/** 有字段可以展开：对象，或几种写法里有对象。 */
function hasFields(node: Node): boolean {
  if (isNode(node["properties"])) return true;
  return [...nodesOf(node["anyOf"]), ...nodesOf(node["oneOf"])].some((variant) =>
    isNode(variant["properties"]),
  );
}

function walkInto(walk: Walk, node: Node, path: string, depth: number): void {
  if (isNode(node["properties"])) {
    walkObject(walk, node, path, depth);
    return;
  }
  // 几种写法：把有字段的写法合起来，字段都不算必填。
  const variants = [...nodesOf(node["anyOf"]), ...nodesOf(node["oneOf"])].map(
    (variant) => deref(walk.root, variant).node,
  );
  const merged: Node = {};
  for (const variant of variants) {
    const props = nodeOf(variant["properties"]);
    for (const [key, value] of Object.entries(props)) {
      const kept = nodeOf(merged["properties"]);
      if (!(key in kept)) merged["properties"] = { ...kept, [key]: value };
    }
  }
  if (isNode(merged["properties"])) walkObject(walk, merged, path, depth);
}

/** 页面数据的定义（JSON Schema）写成简表的行。 */
export function pageBriefLines(schema: unknown): string[] {
  const root = nodeOf(schema);
  const walk: Walk = { root, lines: [], seen: new Map() };
  walkObject(walk, root, "", 0);
  return walk.lines;
}
