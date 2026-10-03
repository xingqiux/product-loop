// 地址里的查询参数只按字符串读写，见「02 技术选型」第十节。
// TanStack Router 默认按 JSON 读写，?item=3 会读成数字，和后端拼出的地址对不上。

/** 把 ?a=1&b=x 读成 { a: "1", b: "x" }。同名的参数取最后一个。 */
export function parseSearch(search: string): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(search));
}

/** 把对象写回 ?a=1&b=x。值为空或不是字符串的项不写。 */
export function stringifySearch(search: Record<string, unknown>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && value !== "") params.set(key, value);
  }
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
