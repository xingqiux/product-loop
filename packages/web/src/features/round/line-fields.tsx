// 回复的一行：几个字段，每个一个名字加一个值，见 model.ts 的 lineFields。
// 回复去处和展示卡片里的来源都用它。
export function LineFields({ fields }: { fields: readonly (readonly [string, string])[] }) {
  return (
    <dl className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-ui">
      {fields.map(([name, value]) => (
        <div key={name} className="contents">
          <dt className="text-tertiary">{name}</dt>
          <dd className="wrap-anywhere">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
