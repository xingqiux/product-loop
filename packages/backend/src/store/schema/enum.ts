import type { EnumDef } from "@product-loop/model";
import { getTableName, type SQL, sql } from "drizzle-orm";
import { CasingCache } from "drizzle-orm/casing";
import { type AnySQLiteColumn, check, text } from "drizzle-orm/sqlite-core";

// 枚举列在数据库里存名称表的英文键。text 加取值列表只约束类型，生成的 SQL 里没有检查。
// 所以每个枚举列另加一条检查约束，见「02 技术选型」第九节第 2 条。

type Keys<K extends string> = Pick<EnumDef<K, string>, "keys">;

// 列名按 drizzle.config.ts 的 casing 转换，和 drizzle-kit 算出的一样。
const casing = new CasingCache("snake_case");

const columnName = (column: AnySQLiteColumn): string => casing.getColumnCasing(column);

/**
 * 只写列名，不带表名。drizzle 默认写成 `"rounds"."stage"`。
 * 照 SQLite 文档手写迁移重建这张表时，新表里认不出这个名字。
 */
export const bareColumn = (column: AnySQLiteColumn) => sql.identifier(columnName(column));

const literal = (key: string): string => `'${key.replaceAll("'", "''")}'`;

/** 枚举列，类型上只收名称表的英文键。 */
export function enumText<K extends string>(def: Keys<K>) {
  return text({ enum: def.keys });
}

/** 枚举列的检查约束，名字是「表名_列名_enum」。 */
export function enumCheck<K extends string>(column: AnySQLiteColumn, def: Keys<K>) {
  const keys = def.keys.map(literal).join(", ");
  return check(
    `${getTableName(column.table)}_${columnName(column)}_enum`,
    sql`${bareColumn(column)} in (${sql.raw(keys)})`,
  );
}

/** 条件「这一列是某个键」，例如 `"status" = 'voided'`。 */
export function isKey<C extends AnySQLiteColumn<{ data: string }>>(
  column: C,
  key: C["_"]["data"],
): SQL {
  return sql`${bareColumn(column)} = ${sql.raw(literal(key))}`;
}

/** 索引的条件「这一列不是某个键」，例如 `"status" <> 'closed'`。 */
export function notKey<C extends AnySQLiteColumn<{ data: string }>>(
  column: C,
  key: C["_"]["data"],
): SQL {
  return sql`${bareColumn(column)} <> ${sql.raw(literal(key))}`;
}
