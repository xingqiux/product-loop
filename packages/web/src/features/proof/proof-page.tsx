// 开工验证页，见第二期计划第 8 步：组件接上路由、主题换掉紫色、Motion 的四处动效、中英文字体，四样在一页上跑通。
// 以后改主题或组件时，开发时打开 /proof 对照。生产构建里没有这一页，见 routes/proof.tsx。
import { ArrowLeft, ArrowRight } from "@untitledui/icons";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { AppLink } from "@/components/app-link";
import {
  Dialog,
  DialogTrigger,
  Modal,
  ModalOverlay,
} from "@/components/ui/application/modals/modal";
import { SlideoutMenu } from "@/components/ui/application/slideout-menus/slideout-menu";
import { Tabs } from "@/components/ui/application/tabs/tabs";
import { BadgeWithDot } from "@/components/ui/base/badges/badges";
import { Button } from "@/components/ui/base/buttons/button";
import { Checkbox } from "@/components/ui/base/checkbox/checkbox";
import { Input } from "@/components/ui/base/input/input";
import { TextArea } from "@/components/ui/base/textarea/textarea";
import { Tooltip, TooltipTrigger } from "@/components/ui/base/tooltip/tooltip";
import { cx } from "@/lib/cx";
import { motionTokens } from "@/lib/motion";
import { useUiStore } from "@/stores/ui";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4 border-t border-secondary pt-6">
      <h2 className="text-heading">{title}</h2>
      {children}
    </section>
  );
}

export function ProofPage() {
  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-10 px-8 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-title">开工验证页</h1>
        <p className="text-body text-tertiary">
          <AppLink to="/" className="text-brand-secondary underline-offset-4 hover:underline">
            回到所有项目
          </AppLink>
        </p>
      </header>
      <Fonts />
      <Components />
      <Screens />
      <Stages />
      <Cards />
    </main>
  );
}

function Fonts() {
  return (
    <Section title="字号和字体">
      <div className="flex flex-col gap-2">
        <p className="text-title">标题 22 Product Loop</p>
        <p className="text-heading">小标题 18 Workbench</p>
        <p className="text-body">
          正文 15：这个阶段定下了三件事，Inter 显示 English，思源黑体显示中文。
        </p>
        <p className="text-ui">界面字 14：按钮、输入框、表格正文</p>
        <p className="text-meta text-tertiary">注 13：2026-09-29 21:30 北京时间</p>
        <p className="text-label text-tertiary">标签 12</p>
        <p className="font-mono text-meta">ploop round start --stage 落地</p>
      </div>
    </Section>
  );
}

function Components() {
  const [picked, setPicked] = useState(false);
  const collapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  return (
    <Section title="组件">
      <div className="flex flex-wrap items-center gap-3">
        <Button color="primary">提交</Button>
        <Button color="secondary">稍后再看</Button>
        <Button color="tertiary">取消</Button>
        <Button color="link-color" href="/">
          站内链接
        </Button>
        <Button color="secondary" onClick={toggleSidebar}>
          {collapsed ? "展开左边一栏" : "折叠左边一栏"}
        </Button>
        <Tooltip title="提示条">
          <TooltipTrigger className="text-ui text-tertiary underline decoration-dotted">
            悬停看提示
          </TooltipTrigger>
        </Tooltip>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <BadgeWithDot type="modern" color="success">
          已完成
        </BadgeWithDot>
        <BadgeWithDot type="modern" color="warning">
          等待
        </BadgeWithDot>
        <BadgeWithDot type="modern" color="error">
          删
        </BadgeWithDot>
        <BadgeWithDot type="modern" color="brand">
          当前
        </BadgeWithDot>
        <BadgeWithDot type="modern" color="gray">
          已收尾
        </BadgeWithDot>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="阶段" placeholder="第 2 版的落地阶段" />
        <TextArea label="我的看法" placeholder="写下你的想法" rows={3} />
      </div>
      <motion.div
        animate={picked ? { scale: [1, 0.97, 1] } : { scale: 1 }}
        transition={motionTokens.select}
        className="w-fit"
      >
        <Checkbox label="认可这个选项" isSelected={picked} onChange={setPicked} />
      </motion.div>
      <Tabs>
        <Tabs.List type="underline" aria-label="示例">
          <Tabs.Item id="mainline">主线</Tabs.Item>
          <Tabs.Item id="decisions">决定</Tabs.Item>
          <Tabs.Item id="queue">队列</Tabs.Item>
        </Tabs.List>
        <Tabs.Panel id="mainline" className="pt-3 text-ui">
          主线全文
        </Tabs.Panel>
        <Tabs.Panel id="decisions" className="pt-3 text-ui">
          决定表
        </Tabs.Panel>
        <Tabs.Panel id="queue" className="pt-3 text-ui">
          队列看板
        </Tabs.Panel>
      </Tabs>
      <div className="flex flex-wrap gap-3">
        <DialogTrigger>
          <Button color="secondary">打开弹窗</Button>
          <ModalOverlay isDismissable>
            <Modal className="max-w-md">
              <Dialog className="flex flex-col gap-4 p-6">
                {({ close }) => (
                  <>
                    <h3 className="text-heading">提交前确认</h3>
                    <p className="text-ui text-tertiary">还有两条没点，确定现在提交吗？</p>
                    <div className="flex justify-end gap-3">
                      <Button color="secondary" onClick={close}>
                        再看看
                      </Button>
                      <Button color="primary" onClick={close}>
                        提交
                      </Button>
                    </div>
                  </>
                )}
              </Dialog>
            </Modal>
          </ModalOverlay>
        </DialogTrigger>
        <SlideoutMenu.Trigger>
          <Button color="secondary">打开侧滑面板</Button>
          <SlideoutMenu isDismissable>
            {({ close }) => (
              <>
                <SlideoutMenu.Header onClose={close}>
                  <h3 className="text-heading">展示卡片</h3>
                </SlideoutMenu.Header>
                <SlideoutMenu.Content>
                  <p className="text-ui text-tertiary">队列里一件事的详情。</p>
                </SlideoutMenu.Content>
              </>
            )}
          </SlideoutMenu>
        </SlideoutMenu.Trigger>
      </div>
    </Section>
  );
}

const screens = ["第一条：疑问", "第二条：发现问题", "第三条：提升"];

function Screens() {
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const go = (step: number) => {
    setDirection(step);
    setIndex((current) => (current + step + screens.length) % screens.length);
  };
  return (
    <Section title="换一屏">
      <div className="relative h-28 overflow-hidden rounded-xl border border-secondary">
        <AnimatePresence initial={false} custom={direction} mode="popLayout">
          <motion.div
            key={index}
            custom={direction}
            variants={{
              enter: (d: number) => ({ x: d * 40, opacity: 0 }),
              center: { x: 0, opacity: 1 },
              exit: (d: number) => ({ x: d * -40, opacity: 0 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={motionTokens.screen}
            className="absolute inset-0 flex items-center justify-center text-body"
          >
            {screens[index]}
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="flex gap-3">
        <Button color="secondary" iconLeading={ArrowLeft} onClick={() => go(-1)}>
          上一屏
        </Button>
        <Button color="secondary" iconTrailing={ArrowRight} onClick={() => go(1)}>
          下一屏
        </Button>
      </div>
    </Section>
  );
}

const stages = ["构思", "检查", "落地", "使用", "提升"];

function Stages() {
  const [current, setCurrent] = useState(1);
  return (
    <Section title="阶段推进">
      <div className="flex rounded-lg bg-secondary p-1">
        {stages.map((stage, index) => (
          <div key={stage} className="relative flex-1 py-1.5 text-center text-ui">
            {index === current && (
              <motion.div
                layoutId="stage"
                transition={motionTokens.stage}
                className="absolute inset-0 rounded-md bg-primary shadow-xs ring-1 ring-secondary"
              />
            )}
            <span
              className={cx(
                "relative",
                index === current ? "text-brand-secondary" : "text-tertiary",
              )}
            >
              {stage}
            </span>
          </div>
        ))}
      </div>
      <Button
        color="secondary"
        className="w-fit"
        onClick={() => setCurrent((current + 1) % stages.length)}
      >
        推进一个阶段
      </Button>
    </Section>
  );
}

const columns = ["等待", "要做", "在做", "完成"];

function Cards() {
  const [column, setColumn] = useState(0);
  return (
    <Section title="卡片换列">
      <LayoutGroup>
        <div className="grid grid-cols-4 gap-3">
          {columns.map((name, index) => (
            <div key={name} className="flex min-h-28 flex-col gap-2 rounded-xl bg-secondary p-3">
              <p className="text-label text-tertiary">{name}</p>
              {index === column && (
                <motion.div
                  layoutId="card"
                  transition={motionTokens.card}
                  className="rounded-lg bg-primary p-3 text-ui shadow-xs ring-1 ring-secondary"
                >
                  草稿自动保存
                </motion.div>
              )}
            </div>
          ))}
        </div>
      </LayoutGroup>
      <Button
        color="secondary"
        className="w-fit"
        onClick={() => setColumn((column + 1) % columns.length)}
      >
        移到下一列
      </Button>
    </Section>
  );
}
