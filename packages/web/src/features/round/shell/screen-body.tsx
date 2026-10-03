// 一屏里放哪个区块。
import { CardBlock } from "../blocks/card";
import { ChangeBlock } from "../blocks/change";
import { DroppedBlock, LandBlock, PreviousBlock, RefsBlock, UseBlock } from "../blocks/info";
import { AlignBlock, ScenesBlock, SpecBlock } from "../blocks/items";
import { QueueBlock } from "../blocks/queue";
import type { Screen } from "../model";

export function ScreenBody({ screen, item }: { screen: Screen; item?: string | undefined }) {
  switch (screen.kind) {
    case "previous":
      return <PreviousBlock />;
    case "dropped":
      return <DroppedBlock />;
    case "use":
      return <UseBlock />;
    case "align":
      return <AlignBlock item={item} />;
    case "scenes":
      return <ScenesBlock item={item} />;
    case "spec":
      return <SpecBlock item={item} />;
    case "card":
      return <CardBlock section={screen.section} index={screen.index} />;
    case "change":
      return <ChangeBlock index={screen.index} />;
    case "land":
      return <LandBlock />;
    case "refs":
      return <RefsBlock />;
    case "queue":
      return <QueueBlock />;
  }
}
