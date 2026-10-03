import { z } from "zod";

// 枚举的英文键存进数据库和代码，中文标签给用户和 AI 看。两者写在同一个常量对象里，
// 见「10 工程规范与流程」第一节。不用 TypeScript 的 enum，因为 Node 的类型剥离不支持。

/** T 是键到标签的原表。带上它，按某个键取标签时能得到那一个标签的类型。 */
export type EnumDef<
  K extends string,
  L extends string,
  T extends Readonly<Record<K, L>> = Readonly<Record<K, L>>,
> = {
  /** 键到标签的原表，键的顺序就是展示的顺序。 */
  readonly table: T;
  readonly keys: readonly [K, ...K[]];
  readonly labels: readonly [L, ...L[]];
  label<Key extends K>(key: Key): T[Key];
  /** 按中文标签找键，找不到时返回 undefined。 */
  key(label: string): K | undefined;
  isKey(value: string): value is K;
  /** 只收英文键，用在代码内部和数据库里。 */
  readonly keySchema: z.ZodType<K, K>;
  /** 只收中文标签。 */
  readonly labelSchema: z.ZodType<L, L>;
  /**
   * 接口上收发中文、代码里用英文键，见「05 接口」第一节，这一条是用户定的。
   * 解码时把中文标签换成键，编码时把键换回标签。经过接口的定义、AI 写的输入文件
   * 和页面数据，枚举都用它。z.input 得到中文的类型，z.output 得到英文键的类型。
   */
  readonly codec: z.ZodCodec<z.ZodType<L, L>, z.ZodType<K, K>>;
};

export type KeyOf<E> = E extends EnumDef<infer K, string> ? K : never;
export type LabelOf<E> = E extends EnumDef<string, infer L> ? L : never;

export function defineEnum<const T extends Record<string, string>>(
  table: T,
): EnumDef<Extract<keyof T, string>, T[Extract<keyof T, string>], T> {
  type K = Extract<keyof T, string>;
  type L = T[K];
  const keys = Object.keys(table) as K[] as [K, ...K[]];
  const labels = keys.map((k) => table[k]) as [L, ...L[]];
  const byLabel = new Map<string, K>(keys.map((k) => [table[k] as string, k]));
  const isKey = (value: string): value is K => Object.hasOwn(table, value);
  const keySchema: z.ZodType<K, K> = z.enum(keys);
  const labelSchema: z.ZodType<L, L> = z.enum(labels);
  return {
    table,
    keys,
    labels,
    label: (key) => table[key],
    key: (label) => byLabel.get(label),
    isKey,
    keySchema,
    labelSchema,
    // 标签已经过 labelSchema 的校验，一定找得到键。
    codec: z.codec(labelSchema, keySchema, {
      decode: (label) => byLabel.get(label) as K,
      encode: (key) => table[key],
    }),
  };
}
