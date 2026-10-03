// 文案表：给人和 AI 看的文字都从这里取，持续检查对它跑一遍写作校验，
// 见「10 工程规范与流程」第二节。文字里的参数写成 {名字}，名字用英文小驼峰，
// 因为传参数时它是对象的键，Biome 只收 ASCII 的键。花括号只用来标参数，
// 汇总的测试查每条样例渲染以后没有残留的花括号。

/** 参数的取值。数字照原样写出，例如 "第 {line} 行"。 */
export type ParamValue = string | number;

/** 文字里的全部参数名，例如 "还有 {count} 行：{lines}" 得到 "count" | "lines"。 */
export type ParamNames<S extends string> = S extends `${string}{${infer Name}}${infer Rest}`
  ? Name | ParamNames<Rest>
  : never;

/** 渲染一条文案要传的参数：文字里有几个就传几个，不能少，也不能多。 */
export type Params<S extends string> = { readonly [Name in ParamNames<S>]: ParamValue };

/** 没有参数的文案可以不传参数。 */
export type ParamArgs<S extends string> = [ParamNames<S>] extends [never]
  ? [params?: Params<S>]
  : [params: Params<S>];

export type CopyEntry<S extends string = string> = {
  readonly text: S;
  /** 一组像真的一样的参数。测试用它渲染每一条，写作校验查的也是渲染的结果。 */
  readonly sample: Params<S>;
};

/** 定义一条文案。有参数的要给一组样例参数。 */
export function copy<S extends string>(text: S, ...[sample]: ParamArgs<S>): CopyEntry<S> {
  return { text, sample: sample ?? ({} as Params<S>) };
}

const placeholder = /\{([A-Za-z][A-Za-z0-9]*)\}/gu;

/** 把参数填进文字。 */
export function renderCopy<S extends string>(
  entry: CopyEntry<S>,
  ...[params]: ParamArgs<S>
): string {
  const values: Readonly<Record<string, ParamValue>> = params ?? {};
  return entry.text.replace(placeholder, (whole, name: string) => {
    const value = Object.hasOwn(values, name) ? values[name] : undefined;
    return value === undefined ? whole : String(value);
  });
}

/** 文案表的一组：每个值是一条文案，或者下一层的一组。键用英文小驼峰。 */
export type CopyTree = CopyEntry | { readonly [name: string]: CopyTree };

/** 摊平以后的一条。键是各层的名字用点连起来，例如 parse.roundLabel.shape.message。 */
export type CopyItem = { readonly key: string; readonly entry: CopyEntry };

export function flattenCopy(prefix: string, tree: CopyTree): CopyItem[] {
  if (isCopyEntry(tree)) return [{ key: prefix, entry: tree }];
  return Object.entries(tree).flatMap(([name, child]) => flattenCopy(`${prefix}.${name}`, child));
}

function isCopyEntry(tree: CopyTree): tree is CopyEntry {
  return typeof tree.text === "string";
}
