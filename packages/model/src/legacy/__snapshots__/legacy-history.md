# 历史页面转换以后

由 convert-history.test.ts 生成。
「转换以前」是不转换、直接按这一阶段的定义校验报的问题数。「转换以后」是转换以后还要改的地方。

8 页都能转换。转换以前没有一页通过，转换以后 6 页通过。

| 页面 | 阶段 | 转换以前 | 备注 | 转换以后 |
| --- | --- | --- | --- | --- |
| skill-own/2026-09-19/think-2.json | think | 83 处 | header×3 sawSource×6 seeDiffs×14 emptyValues×11 stanceText×7 whereScene whereTotals×2 whereText hiddenFields×2 cardSaw sourceOldForm×2 | legacyPage.where.sceneName asks[2].where.scene |
| skill-own/2026-09-19/report-2.json | land | 35 处 | header×3 cardSaw seeDiffs×2 emptyValues×5 stanceText sourceOldForm hiddenFields | 通过 |
| skill-own/2026-09-20/check-2.json | check | 42 处 | header×3 sawSource×2 seeDiffs×5 emptyValues×10 whereScene whereTotals×2 whereText×2 queueBoard | 通过 |
| skill-own/2026-09-20/fix-2.json | land | 17 处 | header×3 emptyValues×4 queueBoard | 通过 |
| skill-own/2026-09-20/land-17.json | land | 25 处 | header×3 land emptyValues×7 queueRow×4 sectionAsk×2 whereScene×2 whereText×4 | 通过 |
| skill-own/2026-09-20/think-27.json | think | 30 处 | header×3 queueRow×4 emptyValues×9 | 通过 |
| skill-own/2026-09-20/use-1.json | use | 13 处 | header×3 usage emptyValues×5 queueBoard | 通过 |
| skill-own/2026-09-20/improve-1.json | improve | 67 处 | header×3 seeDiffs×10 emptyValues×16 whereScene×3 whereTotals×6 whereText×6 queueBoard | page.stage.changes changes |
