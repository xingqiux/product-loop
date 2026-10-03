// 无头浏览器检查：用 vite preview 提供构建好的 dist，用系统的 Chrome 点链接走三条路由，逐项记录结果。
// playwright-core 借用 /Users/alice/code/xy/atlas 里装好的，不另装浏览器。
import { mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { preview } from 'vite'

export const PLAYWRIGHT_FROM = '/Users/alice/code/xy/atlas/package.json'

const PROJECT = '产品循环'
const ROUND = 'v2-落地-3'
const enc = encodeURIComponent
const PROJECT_PATH = `/p/${enc(PROJECT)}`
const ROUND_PATH = `${PROJECT_PATH}/r/${enc(ROUND)}`
const BRAND_600_RGB = 'rgb(36, 87, 200)' // #2457c8，见 src/styles/app.css

/**
 * @param {{ root: string, check: (item: number, name: string, ok: boolean, detail?: string) => void,
 *           probe: (name: string, confirmed: boolean, detail?: string) => void, facts: Record<string, unknown> }} ctx
 */
export async function browserCheck({ root, check, probe, facts }) {
  const { chromium } = createRequire(PLAYWRIGHT_FROM)('playwright-core')
  facts.playwrightCore = createRequire(PLAYWRIGHT_FROM)('playwright-core/package.json').version

  const server = await preview({
    root,
    configFile: false,
    logLevel: 'silent',
    preview: { host: '127.0.0.1', port: 4780, strictPort: false },
  })
  const origin = new URL(server.resolvedUrls.local[0]).origin
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  facts.chrome = browser.version()
  check(4, '用系统 Chrome 启动无头浏览器', true, `playwright-core ${facts.playwrightCore}（借用 atlas），Chrome ${facts.chrome}，页面由 vite preview 提供：${origin}`)

  const pageErrors = []
  const consoleProblems = []
  let phase = '主流程'
  const fontRequests = new Set()

  async function openPage(label, contextOptions = {}, initScript) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 760 }, ...contextOptions })
    if (initScript) await context.addInitScript(initScript)
    const page = await context.newPage()
    page.on('pageerror', (error) => pageErrors.push(`[${label}] ${error.message}`))
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') consoleProblems.push(`[${label}·${phase}] ${message.type()}: ${message.text().replace(/\s+/g, ' ')}`)
    })
    page.on('request', (request) => {
      const match = request.url().match(/\/assets\/((?:noto-sans-sc|inter)-[\w-]+?)-[\w-]{8}\.woff2$/)
      if (match) fontRequests.add(match[1])
    })
    return { context, page }
  }

  const pathOf = (page) => {
    const url = new URL(page.url())
    return url.pathname + url.search
  }
  const bootId = (page) => page.evaluate(() => window.__spike.bootId)
  const historyLength = (page) => page.evaluate(() => history.length)
  const textOf = (page, testId) => page.getByTestId(testId).textContent()
  const attrOf = (page, testId, name) => page.getByTestId(testId).getAttribute(name)
  const collapsedOf = (page) => attrOf(page, 'sidebar', 'data-collapsed')

  // 换一屏时逐帧取样：transform 的平移量和透明度。取样期间做 action（点链接）。
  async function sampleScreenWhile(page, action, ms = 1500) {
    const sampling = page.evaluate(
      (duration) =>
        new Promise((resolve) => {
          const frames = []
          const start = performance.now()
          const tick = () => {
            const el = document.querySelector('[data-testid="screen"]')
            if (el) {
              const style = getComputedStyle(el)
              const x = style.transform === 'none' ? 0 : new DOMMatrixReadOnly(style.transform).m41
              frames.push({ t: Math.round(performance.now() - start), item: el.getAttribute('data-item'), x, opacity: Number(style.opacity) })
            }
            if (performance.now() - start < duration) requestAnimationFrame(tick)
            else resolve(frames)
          }
          requestAnimationFrame(tick)
        }),
      ms,
    )
    await page.waitForTimeout(60)
    await action()
    return sampling
  }
  const summarizeFrames = (frames) => {
    const midX = frames.filter((f) => Math.abs(f.x) > 1 && Math.abs(f.x) < 31)
    const midOpacity = frames.filter((f) => f.opacity > 0.05 && f.opacity < 0.95)
    return { frames: frames.length, midX: midX.length, midOpacity: midOpacity.length, sampleX: midX.slice(0, 4).map((f) => Math.round(f.x * 10) / 10) }
  }

  try {
    // ── 场景 A：正常浏览器 ────────────────────────────────────────────────
    const { context: ctxA, page } = await openPage('正常')
    await page.goto(`${origin}/`)
    await page.getByRole('heading', { name: '所有项目' }).waitFor()
    check(1, '路由 / 渲染', pathOf(page) === '/', `地址 ${pathOf(page)}`)
    const boot1 = await bootId(page)

    const brandColor = await page.getByTestId('brand-chip').evaluate((el) => getComputedStyle(el).backgroundColor)
    const bodyFont = await page.evaluate(() => getComputedStyle(document.body).fontFamily)
    check(3, 'Tailwind 4：自己的 @theme 变量生成了工具类', brandColor === BRAND_600_RGB, `bg-brand-600 算出来是 ${brandColor}`)
    check(3, 'Tailwind 4：字体栈覆盖到 --font-sans', bodyFont.startsWith('"Inter Variable"'), bodyFont)

    // React Aria 的 Link，只给了 href 字符串 '/p/产品循环'
    const racHref = await attrOf(page, `rac-link-${PROJECT}`, 'href')
    let historyBefore = await historyLength(page)
    await page.getByTestId(`rac-link-${PROJECT}`).click()
    await page.waitForURL((url) => url.pathname === PROJECT_PATH)
    await page.getByTestId('project-name').waitFor()
    const projectName = await textOf(page, 'project-name')
    const roundListText = await textOf(page, 'round-list')
    const sameBootAfterRac = (await bootId(page)) === boot1
    const historyDeltaRac = (await historyLength(page)) - historyBefore
    check(2, 'React Aria Link（href 字符串）经 RouterProvider 单页跳转', racHref === PROJECT_PATH && sameBootAfterRac && historyDeltaRac === 1,
      `href=${racHref}，点后地址 ${pathOf(page)}，没有整页刷新=${sameBootAfterRac}，历史 +${historyDeltaRac}`)
    check(1, '路由 /p/$project 渲染，中文项目名经地址往返', projectName === PROJECT, `页面上的项目名「${projectName}」`)
    check(3, 'TanStack Query：加载器预取、组件读缓存', roundListText.includes(ROUND), `轮次列表：${roundListText.replace(/\s+/g, ' ').trim()}`)

    // createLink 包出来的 AppLink：to + params + search 都有类型
    const appLinkTestId = `round-link-${ROUND}`
    const appHref = await attrOf(page, appLinkTestId, 'href')
    const expectedAppHref = `${ROUND_PATH}?item=${enc('疑问-2')}`
    await page.getByTestId(appLinkTestId).hover()
    await page.waitForTimeout(400)
    const preloaded = await page.evaluate(() => window.__spike.events.some((e) => e.kind === 'loader:round' && e.detail?.preload === true))
    check(2, 'AppLink 悬停即预加载（TanStack 的 onMouseEnter 穿过 React Aria Link）', preloaded, preloaded ? '悬停后 /p/$project/r/$round 的加载器以 preload=true 跑过' : '悬停后没有预加载')

    historyBefore = await historyLength(page)
    await page.getByTestId(appLinkTestId).click()
    await page.waitForURL((url) => url.pathname === ROUND_PATH)
    await page.getByTestId('param-round').waitFor()
    const round1 = { project: await textOf(page, 'param-project'), round: await textOf(page, 'param-round'), item: await textOf(page, 'search-item') }
    const sameBootAfterApp = (await bootId(page)) === boot1
    const historyDeltaApp = (await historyLength(page)) - historyBefore
    check(2, 'AppLink（createLink 包 React Aria Link）单页跳转', appHref === expectedAppHref && sameBootAfterApp && historyDeltaApp === 1,
      `href=${appHref}，没有整页刷新=${sameBootAfterApp}，历史 +${historyDeltaApp}`)
    check(1, '路由 /p/$project/r/$round 渲染，中文轮次经地址往返为有类型的参数', round1.project === PROJECT && round1.round === ROUND && pathOf(page) === expectedAppHref,
      `地址 ${pathOf(page)} → params { project: '${round1.project}', round: '${round1.round}' }`)
    check(1, '查询参数 item 经 Zod 校验，中文值往返', round1.item === '疑问-2', `search.item = '${round1.item}'`)

    // 指向当前页的链接：className 函数拿到 React Aria 的 isCurrent
    const currentClass = (await attrOf(page, 'item-link-疑问-2', 'class')) ?? ''
    const currentAria = await attrOf(page, 'item-link-疑问-2', 'aria-current')
    check(2, 'AppLink 指向当前页时，React Aria 的 className 函数照常工作', currentClass.includes('is-current') && currentAria === 'page' && !currentClass.includes('=>'),
      `aria-current=${currentAria}，class="${currentClass.slice(0, 60)}…"`)
    const rawClass = (await attrOf(page, 'probe-raw-createlink', 'class')) ?? ''
    probe('不加 activeProps 的 createLink，指向当前页时 className 函数被拼成字符串', rawClass.includes('=>'), `class="${rawClass.slice(0, 80)}…"`)

    // Motion：点「下一条」，逐帧看平移和透明度
    const normalFrames = summarizeFrames(await sampleScreenWhile(page, () => page.getByTestId('next').click()))
    await page.waitForURL((url) => url.search === `?item=${enc('F-7')}`)
    check(3, 'Motion：换一屏有平移动画（正常设置）', normalFrames.midX >= 3 && normalFrames.midOpacity >= 3,
      `${normalFrames.frames} 帧里 ${normalFrames.midX} 帧处在平移中途（如 x=${normalFrames.sampleX.join(', ')}），${normalFrames.midOpacity} 帧处在透明度中途`)
    check(1, '点「下一条」只改查询参数', (await textOf(page, 'search-item')) === 'F-7', `地址 ${pathOf(page)}`)

    // Zustand 持久化：折叠左栏 → 刷新（深链接由服务器回退到 index.html）→ 还是折叠的
    await page.getByTestId('toggle-sidebar').click()
    const collapsedNow = await collapsedOf(page)
    const stored = await page.evaluate(() => localStorage.getItem('ploop-ui'))
    await page.reload()
    await page.getByTestId('param-round').waitFor()
    const collapsedAfterReload = await collapsedOf(page)
    const roundAfterReload = await textOf(page, 'param-round')
    check(3, 'Zustand persist：折叠左栏后刷新仍记得', collapsedNow === 'true' && collapsedAfterReload === 'true' && stored?.includes('"sidebarCollapsed":true'),
      `存进本地的是 ${stored}`)
    check(1, '在中文深链接上刷新，路由照常解析', roundAfterReload === ROUND && pathOf(page) === `${ROUND_PATH}?item=${enc('F-7')}`, `刷新后 round='${roundAfterReload}'`)
    await page.getByTestId('toggle-sidebar').click()
    const boot2 = await bootId(page)

    // 前进后退
    await page.goBack()
    await page.waitForURL((url) => url.search === `?item=${enc('疑问-2')}`)
    const backItem = await textOf(page, 'search-item')
    await page.goBack()
    await page.waitForURL((url) => url.pathname === PROJECT_PATH)
    await page.getByTestId('round-list').waitFor()
    await page.goForward()
    await page.waitForURL((url) => url.pathname === ROUND_PATH)
    const forwardItem = await textOf(page, 'search-item')
    check(1, '后退、前进回到原处', backItem === '疑问-2' && forwardItem === '疑问-2', `后退到 item='${backItem}'，再后退到项目页，前进回到 item='${forwardItem}'`)
    await page.goBack()
    await page.waitForURL((url) => url.pathname === PROJECT_PATH)
    await page.getByTestId('round-list').waitFor()

    // React Aria Link 的 href 里带查询参数
    const queryHref = await attrOf(page, 'rac-link-with-query', 'href')
    const expectedQueryHref = `${PROJECT_PATH}/r/${enc('v2-检查-1')}?item=F-1`
    await page.getByTestId('rac-link-with-query').click()
    await page.waitForURL((url) => url.pathname === `${PROJECT_PATH}/r/${enc('v2-检查-1')}`)
    await page.getByTestId('param-round').waitFor()
    const queryRound = await textOf(page, 'param-round')
    const queryItem = await textOf(page, 'search-item')
    check(2, 'React Aria Link 的 href 带 ?查询参数 也能单页跳转', queryHref === expectedQueryHref && queryRound === 'v2-检查-1' && queryItem === 'F-1' && (await bootId(page)) === boot2,
      `href=${queryHref} → round='${queryRound}'，item='${queryItem}'`)

    // 对照：同一个带查询参数的 href，按 React Aria 文档的 { to } 接法跳
    await page.goBack()
    await page.waitForURL((url) => url.pathname === PROJECT_PATH)
    await page.getByTestId('docs-wiring-link').waitFor()
    const bootDocs = await bootId(page)
    await page.getByTestId('docs-wiring-link').click()
    await page.waitForURL((url) => url.pathname === `${PROJECT_PATH}/r/${enc('v2-检查-1')}`)
    await page.getByTestId('param-round').waitFor()
    const docsRound = await textOf(page, 'param-round')
    const docsItem = await textOf(page, 'search-item')
    probe('React Aria 文档的 { to } 接法：href 带查询参数，最终也跳对了（TanStack 写进地址后重新解析）',
      docsRound === 'v2-检查-1' && docsItem === 'F-1' && (await bootId(page)) === bootDocs,
      `round='${docsRound}'，item='${docsItem}'；但 buildLocation({ to }) 的中间结果把查询串算进了路径参数`)

    // 键盘：Tab 到 React Aria Link，按回车
    await page.goto(`${origin}/`)
    await page.getByRole('heading', { name: '所有项目' }).waitFor()
    const boot3 = await bootId(page)
    historyBefore = await historyLength(page)
    await page.getByTestId(`rac-link-${PROJECT}`).focus()
    await page.keyboard.press('Enter')
    await page.waitForURL((url) => url.pathname === PROJECT_PATH)
    await page.getByTestId('project-name').waitFor()
    const historyDeltaKey = (await historyLength(page)) - historyBefore
    check(2, '键盘：焦点在 React Aria Link 上按回车，单页跳转', (await bootId(page)) === boot3 && historyDeltaKey === 1, `历史 +${historyDeltaKey}`)

    // 直接打开中文深链接（地址栏里写的是汉字），截图
    await page.goto(`${origin}/p/${PROJECT}/r/${ROUND}?item=疑问-2`)
    await page.getByTestId('param-round').waitFor()
    await page.waitForTimeout(700)
    const direct = { round: await textOf(page, 'param-round'), item: await textOf(page, 'search-item') }
    check(1, '直接打开中文深链接', direct.round === ROUND && direct.item === '疑问-2', `打开 /p/${PROJECT}/r/${ROUND}?item=疑问-2 → 地址栏 ${pathOf(page)}`)
    await page.evaluate(() => document.fonts.ready)
    const fonts = await page.evaluate(() => ({
      cjk: document.fonts.check('16px "Noto Sans SC Variable"', '落地疑问'),
      latin: document.fonts.check('16px "Inter Variable"', 'Round'),
    }))
    const evidenceDir = path.join(root, 'evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const screenshot = path.join(evidenceDir, 'round.png')
    await page.screenshot({ path: screenshot })
    check(4, '截图', true, path.relative(root, screenshot))

    // 查询参数长得像数字：TanStack 默认按 JSON 解析，?item=3 会变成数字 3（这一步预期会在控制台留一条校验错误）
    phase = '?item=3 探针，预期报错'
    await page.goto(`${origin}${ROUND_PATH}?item=3`)
    await page.locator('[data-testid="route-error"], [data-testid="param-round"]').first().waitFor()
    const numericError = await page.getByTestId('route-error').count()
    probe('?item=3 被 TanStack 的默认解析当成数字，z.string() 校验不过，页面进错误边界', numericError === 1,
      numericError === 1 ? `页面显示：${(await textOf(page, 'route-error'))?.replace(/\s+/g, ' ').slice(0, 90)}…` : `页面显示 item='${await textOf(page, 'search-item')}'`)
    phase = '主流程'
    facts.fonts = { ...fonts, requested: [...fontRequests].sort() }
    probe('字体按需加载：只下载页面上用到的 Noto Sans SC 切片', fonts.cjk && [...fontRequests].filter((f) => f.startsWith('noto')).length < 20,
      `Noto Sans SC 已加载=${fonts.cjk}，Inter 已加载=${fonts.latin}；下载了 ${[...fontRequests].filter((f) => f.startsWith('noto')).length} 个 Noto 切片（共 101 个）、${[...fontRequests].filter((f) => f.startsWith('inter')).length} 个 Inter 文件`)
    await ctxA.close()

    // ── 场景 B：系统开了「减少动态效果」 ─────────────────────────────────
    const { context: ctxB, page: pageB } = await openPage('减少动态效果', { reducedMotion: 'reduce' })
    await pageB.goto(`${origin}${ROUND_PATH}?item=${enc('疑问-2')}`)
    await pageB.getByTestId('next').waitFor()
    await pageB.waitForTimeout(700)
    const reducedFrames = summarizeFrames(await sampleScreenWhile(pageB, () => pageB.getByTestId('next').click()))
    check(3, 'Motion：MotionConfig reducedMotion="user" 在减少动态效果时去掉平移、保留透明度', reducedFrames.midX === 0 && reducedFrames.midOpacity >= 3,
      `${reducedFrames.frames} 帧里 ${reducedFrames.midX} 帧处在平移中途，${reducedFrames.midOpacity} 帧处在透明度中途`)
    await ctxB.close()

    // ── 场景 C：本地存储用不了 ───────────────────────────────────────────
    const storageCases = [
      ['访问 localStorage 就抛 SecurityError', () => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError') } })
      }],
      ['setItem 抛 QuotaExceededError', () => {
        Storage.prototype.setItem = function setItem() { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError') }
      }],
      ['存的内容不是合法 JSON', () => {
        try { localStorage.setItem('ploop-ui', '{坏掉的 JSON') } catch { /* 忽略 */ }
      }],
    ]
    for (const [label, init] of storageCases) {
      const errorsBefore = pageErrors.length
      const { context, page: p } = await openPage(label, {}, init)
      await p.goto(`${origin}/`)
      await p.getByRole('heading', { name: '所有项目' }).waitFor()
      const before = await collapsedOf(p)
      await p.getByTestId('toggle-sidebar').click()
      const after = await collapsedOf(p)
      const rehydrate = await p.evaluate(() => window.__spike.events.find((e) => e.kind === 'ui:rehydrated')?.detail)
      const ok = before === 'false' && after === 'true' && pageErrors.length === errorsBefore
      check(3, `Zustand 安全存储：${label}，页面照常用`, ok,
        `折叠前=${before}，点后=${after}，页面报错 ${pageErrors.length - errorsBefore} 条${rehydrate?.error ? `；读取时的错误被接住：${rehydrate.error}` : ''}`)
      await context.close()
    }
  } finally {
    await browser.close()
    await server.close()
  }

  check(4, '整个过程没有未捕获的页面错误', pageErrors.length === 0, pageErrors.length ? pageErrors.join(' | ') : '0 条')
  facts.consoleProblems = consoleProblems
  facts.fontRequests = [...fontRequests]
}
