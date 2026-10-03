// 一个阶段的页面，见「06 工作台」第四节和第二期计划第 12 步。
// 宽屏：左边一栏，右边一次一屏，上一屏下一屏和左右键换屏。窄屏：没有左边一栏，所有的屏依次往下排。
// 打开先到地址里写的那一条，没写就到第一条没点的。当前看哪一条记在地址里。
import { pagePurpose } from "@product-loop/model";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight } from "@untitledui/icons";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import {
  type ComponentPropsWithRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppHeader } from "@/components/app-header";
import { AppLink } from "@/components/app-link";
import { NotFound } from "@/components/not-found";
import { Notice } from "@/components/notice";
import { Button } from "@/components/ui/base/buttons/button";
import { isNotFound } from "@/lib/api";
import { useDocumentTitle } from "@/lib/document-title";
import { motionTokens, scrollBehavior } from "@/lib/motion";
import { draftQuery, pageQuery, roundQuery, statusQuery, versionsQuery } from "@/lib/queries";
import { roundNameOf } from "@/lib/rounds";
import { useWide } from "@/lib/use-media";
import { type FilledPage, PageContext, type PageContextValue } from "../context";
import { useDraft } from "../draft-store";
import {
  type Entry,
  groupsOf,
  initialScreen,
  isCurrentEntry,
  pageStateOf,
  pendingOf,
  screensOf,
} from "../model";
import { useArrowKeys } from "./keys";
import { PageHead } from "./page-head";
import { ScreenBody } from "./screen-body";
import { Sidebar } from "./sidebar";
import { SubmitArea } from "./submit-area";

type Props = {
  pid: string;
  round: string;
  /** 地址里写的第几页。没写就是在等的那一页，没有在等的就是最后一页。 */
  pageSeq: number | undefined;
  /** 地址里写的哪一条：屏的编号，或者屏里一项的编号。 */
  item: string | undefined;
  onNavigate: (search: { item?: string | undefined; page?: string | undefined }) => void;
};

/**
 * 换一屏时新旧两屏同时在页面里 220 毫秒。正在退出的那一屏不能再点，也不该被读屏和键盘读到，
 * 不然同一个选项在页面里有两份。
 */
function ScreenFrame(props: ComponentPropsWithRef<typeof motion.section>) {
  const present = useIsPresent();
  return <motion.section {...props} inert={!present} aria-hidden={present ? undefined : true} />;
}

export function RoundView(props: Props) {
  const { pid, round, pageSeq } = props;
  const detail = useQuery(roundQuery(pid, round));
  const pages = detail.data?.data.pages ?? [];
  const chosen =
    pageSeq === undefined
      ? (pages.find((p) => p.status === "已给出") ?? pages.at(-1))
      : pages.find((p) => p.seq === pageSeq);
  const page = useQuery({ ...pageQuery(pid, chosen?.id ?? 0), enabled: chosen !== undefined });
  const draft = useQuery({ ...draftQuery(pid, chosen?.id ?? 0), enabled: chosen !== undefined });
  // 页头的阶段条按现在的数据画，先取来，页面打开时就是对的，不先闪一下存下的旧状态。
  const versions = useQuery(versionsQuery(pid));
  const status = useQuery(statusQuery(pid));
  const open = useDraft((state) => state.open);
  const target = useDraft((state) => state.target);
  useEffect(() => {
    if (chosen !== undefined && draft.data !== undefined)
      open({ pid, page: chosen.id }, draft.data.data.entries);
  }, [open, pid, chosen, draft.data]);
  // 面包屑只写上一层：项目。最后一项和页面标题同一个词，不再写第二遍。
  const parent = (
    <AppLink key="p" to="/p/$project" params={{ project: pid }} className="hover:text-primary">
      {pid}
    </AppLink>
  );
  const crumbs = [parent];
  const ready =
    page.data !== undefined &&
    target?.pid === pid &&
    target.page === chosen?.id &&
    !versions.isPending &&
    !status.isPending;
  const wide = useWide();
  useDocumentTitle(status.data?.data.project.name ?? pid, roundNameOf(round));
  // 项目或者这一轮不存在：马上写找不到，带页头和回去的入口，不显示读不到的空页。
  if (status.isError && isNotFound(status.error)) {
    return (
      <NotFound
        crumbs={[
          <AppLink key="all" to="/" className="hover:underline">
            所有项目
          </AppLink>,
        ]}
      />
    );
  }
  if (detail.isError && isNotFound(detail.error)) {
    return <NotFound crumbs={crumbs} project={pid} />;
  }
  // 宽屏时整页不滚，左边一栏和右边各滚各的。
  return (
    <div className={wide ? "flex h-dvh flex-col" : undefined}>
      <AppHeader crumbs={crumbs} />
      {detail.isError ? (
        <Notice kind="error" error={detail.error} onRetry={() => void detail.refetch()}>
          读不到这个阶段。
        </Notice>
      ) : detail.data !== undefined && chosen === undefined ? (
        <Notice kind="empty">
          {pageSeq === undefined ? "这个阶段还没有给出页面。" : `这个阶段没有第 ${pageSeq} 页。`}
        </Notice>
      ) : page.isError || draft.isError ? (
        <Notice
          kind="error"
          error={page.error ?? draft.error}
          onRetry={() => {
            void page.refetch();
            void draft.refetch();
          }}
        >
          读不到这一页。
        </Notice>
      ) : !ready || detail.data === undefined ? (
        <Notice kind="loading">正在读取</Notice>
      ) : (
        <Loaded
          {...props}
          page={page.data.data as FilledPage}
          roundView={detail.data.data.round}
          pages={pages}
          wide={wide}
        />
      )}
    </div>
  );
}

function Loaded({
  pid,
  item,
  onNavigate,
  page,
  roundView,
  pages,
  wide,
}: Props & {
  wide: boolean;
  page: FilledPage;
  roundView: Parameters<typeof PageHead>[0]["round"];
  pages: Parameters<typeof PageHead>[0]["pages"];
}) {
  const entries = useDraft((state) => state.entries);
  const screens = useMemo(() => screensOf(page), [page]);
  const state = pageStateOf(page, roundView.status);
  // 只看的页没有要点的条：左边不出圆点，也不算还剩几条；阶段没收尾时也没有想法框和提交（决定 204）。
  const viewOnly = page.purpose === pagePurpose.label("view");
  const groups = useMemo(() => groupsOf(page, !viewOnly), [page, viewOnly]);
  const pending = pendingOf(groups, entries);
  // 打开时算一次先到哪一条，之后点了选项也不跟着跳。
  const [start] = useState(() => initialScreen(screens, groups, entries, item));
  const current = initialScreen(screens, groups, entries, item ?? start.item ?? start.screen);
  const index = Math.max(
    0,
    screens.findIndex((s) => s.id === current.screen),
  );
  const screen = screens[index];
  const direction = useRef<1 | -1>(1);
  // 系统开了「减少动态效果」：只渐变，不位移。
  const still = useReducedMotion() === true;
  const readOnly = state !== "open" || page.snapshot !== null;
  const scroller = useRef<HTMLElement>(null);
  // 换一屏回到顶上。点的是屏里的一项时，由区块自己滚到那一项。
  useEffect(() => {
    if (current.item === undefined) scroller.current?.scrollTo({ top: 0 });
  }, [screen?.id]);

  const scrollTo = useCallback((id: string, inner?: string) => {
    const root = document.getElementById(`screen-${id}`);
    const target =
      inner === undefined ? root : root?.querySelector(`[data-item="${CSS.escape(inner)}"]`);
    // 顶上有一条悬浮的栏，滚到一屏或一项的开头，开头留出栏的高度（scroll-margin），标题不被盖住。
    target?.scrollIntoView({ block: "start", behavior: scrollBehavior() });
  }, []);
  const go = useCallback(
    (to: string, inner?: string) => {
      if (!wide) {
        scrollTo(to, inner);
        return;
      }
      const toIndex = screens.findIndex((s) => s.id === to);
      direction.current = toIndex < index ? -1 : 1;
      onNavigate({ item: inner ?? to });
    },
    [wide, screens, index, onNavigate, scrollTo],
  );
  const step = useCallback(
    (delta: -1 | 1) => {
      const to = screens[index + delta];
      if (to !== undefined) go(to.id);
    },
    [screens, index, go],
  );
  useArrowKeys(step, wide);
  const toPending = () => {
    const first = pending[0];
    if (first !== undefined) go(first.screen, first.item);
  };
  const isCurrent = (entry: Entry) => isCurrentEntry(groups, current, entry);

  const context: PageContextValue = {
    pid,
    page,
    state,
    readOnly,
    go,
  };
  const head = (
    <PageHead
      round={roundView}
      pages={pages}
      onPage={(seq) => onNavigate({ page: String(seq), item: undefined })}
    />
  );
  const submit =
    state === "view" ? null : (
      <SubmitArea layout={wide ? "bar" : "page"} pending={pending.length} onPending={toPending} />
    );

  // 迁移进来的旧页面，快照里是旧模板的数据，不是给人看的，只写标题、日期和一句无法显示。
  if (page.snapshot !== null) {
    return (
      <PageContext value={context}>
        <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 lg:px-10">
          {head}
          <p className="text-ui text-tertiary">旧页面无法显示</p>
        </main>
      </PageContext>
    );
  }

  // 迁移进来的历史页去掉没有记录的队列以后，可能一屏都不剩。
  if (screen === undefined) {
    return (
      <PageContext value={context}>
        <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 lg:px-10">
          {head}
          <Notice kind="empty">没有内容</Notice>
        </main>
      </PageContext>
    );
  }

  if (!wide) {
    return (
      <PageContext value={context}>
        {state === "open" && pending.length > 0 && (
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-secondary bg-primary/95 px-4 py-2 backdrop-blur">
            <button
              type="button"
              onClick={toPending}
              className="inline-flex min-h-6 items-center text-ui text-brand-secondary"
            >
              看未点的 {pending.length} 条
            </button>
          </div>
        )}
        <main className="flex flex-col gap-10 px-4 py-6">
          {head}
          {screens.map((s) => (
            <section
              key={s.id}
              id={`screen-${s.id}`}
              className="scroll-mt-14 border-b border-secondary pb-10"
            >
              <ScreenBody screen={s} />
            </section>
          ))}
          {submit !== null && (
            <section className="rounded-xl p-4 ring-1 ring-secondary">{submit}</section>
          )}
        </main>
      </PageContext>
    );
  }

  return (
    <PageContext value={context}>
      <div className="flex min-h-0 flex-1">
        <Sidebar
          groups={groups}
          isCurrent={isCurrent}
          onPick={(entry) => go(entry.screen, entry.item)}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* relative：单选框的隐藏输入框是绝对定位，要被这一块包住，不然整个网页多出一条滚动条。 */}
          <main
            ref={scroller}
            className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-8 overflow-y-auto px-10 pt-8"
          >
            {head}
            {/* 新旧两屏同时过渡，总共 220 毫秒（规范）；旧屏脱离排版，不占位置。 */}
            <AnimatePresence mode="popLayout" initial={false} custom={direction.current}>
              <ScreenFrame
                key={screen.id}
                id={`screen-${screen.id}`}
                custom={direction.current}
                variants={{
                  enter: (d: number) => ({ opacity: 0, x: still ? 0 : 24 * d }),
                  shown: { opacity: 1, x: 0 },
                  leave: (d: number) => ({ opacity: 0, x: still ? 0 : -24 * d }),
                }}
                initial="enter"
                animate="shown"
                exit="leave"
                transition={motionTokens.screen}
                className="mx-auto w-full max-w-5xl"
              >
                <ScreenBody screen={screen} item={current.item} />
              </ScreenFrame>
            </AnimatePresence>
            {/* 上一屏、下一屏贴在这一块的底边：内容再高也在窗口里。 */}
            <nav
              aria-label="换一屏"
              className="sticky bottom-0 z-10 mx-auto mt-auto flex w-full max-w-5xl items-center justify-between border-t border-secondary bg-primary py-3"
            >
              <Button
                color="tertiary"
                iconLeading={ArrowLeft}
                isDisabled={index === 0}
                onClick={() => step(-1)}
              >
                上一屏
              </Button>
              <span className="text-meta text-quaternary tabular-nums">
                {index + 1} / {screens.length}
              </span>
              <Button
                color="tertiary"
                iconTrailing={ArrowRight}
                isDisabled={index === screens.length - 1}
                onClick={() => step(1)}
              >
                下一屏
              </Button>
            </nav>
          </main>
          {/* 提交区固定在页面底下，左边一栏收起时也在。只看的页没有。 */}
          {submit !== null && (
            <footer className="shrink-0 border-t border-secondary bg-primary px-10 py-3">
              <div className="mx-auto w-full max-w-5xl">{submit}</div>
            </footer>
          )}
        </div>
      </div>
    </PageContext>
  );
}
