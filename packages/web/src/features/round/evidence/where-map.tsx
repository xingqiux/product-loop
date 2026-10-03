// 出现位置：主线里哪个场景的第几步。场景和步骤都写字：场景写编号和名字，步骤写这一步做什么，
// 再写第几步、共几步。不画没有字的小方块和圆点，位置不单靠颜色表示。
// 场景名、步数和这一步的文字由后端从主线填好。
import { usePage } from "../context";

export function WhereMap({ where }: { where: { readonly scene: string; readonly step: number } }) {
  const { page } = usePage();
  const { scenes, places } = page.fill.where;
  const scene = scenes.find((item) => item.id === where.scene);
  const place = places.find((item) => item.scene === where.scene && item.step === where.step);
  const steps = scene?.steps ?? where.step;
  return (
    <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-secondary">
      <p className="text-meta font-medium text-tertiary">出现位置</p>
      <p className="text-label text-tertiary">场景</p>
      <p className="text-ui">{scene === undefined ? where.scene : `${scene.id} ${scene.name}`}</p>
      <p className="text-label text-tertiary">步骤</p>
      <p className="text-ui">{place?.do ?? place?.name ?? `第 ${where.step} 步`}</p>
      {place?.expect != null && <p className="text-meta text-tertiary">该看到：{place.expect}</p>}
      <p className="text-meta text-tertiary tabular-nums">
        第 {where.step} 步，共 {steps} 步
      </p>
    </div>
  );
}
