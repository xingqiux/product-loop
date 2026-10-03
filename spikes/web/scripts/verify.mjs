#!/usr/bin/env node
// 开工前验证：工作台的前端栈。一条命令跑完：
//   构建（先删掉路由树，证明它由插件重新生成）→ tsc --noEmit → 两个类型反例 → 无头浏览器检查，
// 逐项打印「通过 / 不通过」，最后按四项汇总，并把结果写进 evidence/verify-report.json。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { browserCheck } from './browser-check.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const bin = (name) => path.join(root, 'node_modules', '.bin', name)
const requireHere = createRequire(path.join(root, 'package.json'))

const ITEMS = {
  1: 'Vite 8 + React 19 + TanStack Router 按文件路由（中文参数、查询参数校验、tsc、构建）',
  2: 'React Aria 的 RouterProvider 接 TanStack Router；createLink 自己的链接保留类型检查',
  3: 'Tailwind CSS 4 + Motion（MotionConfig reducedMotion="user"）+ Zustand 持久化（安全存储）',
  4: '无头浏览器检查（playwright-core + 系统 Chrome，点链接走三条路由，截图）',
}

const checks = []
const probes = []
const facts = {}

function check(item, name, ok, detail = '') {
  checks.push({ item, name, ok, detail })
  console.log(`${ok ? '  通过  ' : '  不通过'} [${item}] ${name}${detail ? `\n           ${detail}` : ''}`)
}
function probe(name, confirmed, detail = '') {
  probes.push({ name, confirmed, detail })
  console.log(`  ${confirmed ? '确认  ' : '未复现'} [探针] ${name}${detail ? `\n           ${detail}` : ''}`)
}
function run(command, args) {
  const started = Date.now()
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } })
  return { code: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}`, ms: Date.now() - started }
}
function versionOf(name, from = requireHere) {
  try {
    return from(`${name}/package.json`).version
  } catch {
    return '（未找到）'
  }
}

// ── 版本 ─────────────────────────────────────────────────────────────────
const routerPluginRequire = createRequire(requireHere.resolve('@tanstack/router-plugin/package.json'))
facts.versions = {
  node: process.version,
  pnpm: JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).packageManager,
  vite: versionOf('vite'),
  '@vitejs/plugin-react': versionOf('@vitejs/plugin-react'),
  react: versionOf('react'),
  'react-dom': versionOf('react-dom'),
  '@tanstack/react-router': versionOf('@tanstack/react-router'),
  '@tanstack/router-plugin': versionOf('@tanstack/router-plugin'),
  '@tanstack/router-generator': versionOf('@tanstack/router-generator', routerPluginRequire),
  '@tanstack/react-query': versionOf('@tanstack/react-query'),
  'react-aria-components': versionOf('react-aria-components'),
  tailwindcss: versionOf('tailwindcss'),
  '@tailwindcss/vite': versionOf('@tailwindcss/vite'),
  motion: versionOf('motion'),
  zustand: versionOf('zustand'),
  zod: versionOf('zod'),
  typescript: versionOf('typescript'),
  '@fontsource-variable/inter': versionOf('@fontsource-variable/inter'),
  '@fontsource-variable/noto-sans-sc': versionOf('@fontsource-variable/noto-sans-sc'),
}
console.log('版本：')
console.log(`  ${Object.entries(facts.versions).map(([k, v]) => `${k} ${v}`).join('，')}\n`)

// ── 1. 构建：先删掉路由树和 dist，由路由插件重新生成 ────────────────────
const routeTreeFile = path.join(root, 'src', 'routeTree.gen.ts')
rmSync(routeTreeFile, { force: true })
rmSync(path.join(root, 'dist'), { recursive: true, force: true })
const build = run(bin('vite'), ['build'])
check(1, 'vite build', build.code === 0, `${build.ms} ms${build.code === 0 ? '' : `\n${build.output.slice(-2000)}`}`)

const routeTree = existsSync(routeTreeFile) ? readFileSync(routeTreeFile, 'utf8') : ''
const fullPaths = routeTree.match(/fullPaths:\s*([^\n]+)/)?.[1]?.trim() ?? ''
check(1, '路由树由 Vite 插件从 src/routes 生成', ['\'/\'', '\'/p/$project\'', '\'/p/$project/r/$round\''].every((p) => fullPaths.includes(p)),
  `src/routeTree.gen.ts 的 fullPaths: ${fullPaths}`)
const assets = existsSync(path.join(root, 'dist', 'assets')) ? readdirSync(path.join(root, 'dist', 'assets')) : []
const splitChunks = assets.filter((f) => /^(_round|_project|routes|route)-.*\.js$/.test(f))
check(1, '按路由拆分代码块（autoCodeSplitting）', splitChunks.length >= 3, splitChunks.join('，'))

// ── 1 / 2. 类型检查 ───────────────────────────────────────────────────────
const tsc = run(bin('tsc'), ['--noEmit'])
check(1, `tsc --noEmit（TypeScript ${facts.versions.typescript}）`, tsc.code === 0, `${tsc.ms} ms${tsc.code === 0 ? '' : `\n${tsc.output.slice(0, 2000)}`}`)
const typeCases = readFileSync(path.join(root, 'src', 'type-tests', 'links.tsx'), 'utf8')
const expectErrorCount = (typeCases.match(/^\s*\/\/ @ts-expect-error/gm) ?? []).length
check(2, '类型反例：写错参数名、少参数、没有的路由、查询参数类型不对，都是类型错误', tsc.code === 0 && expectErrorCount === 4,
  `src/type-tests/links.tsx 里 ${expectErrorCount} 处 @ts-expect-error 都被 tsc 认可（不是错误的话会报 TS2578）`)

const firstErrorLine = (output) => output.split('\n').find((line) => /error TS\d+/.test(line))?.slice(0, 190) ?? ''
const wrongParam = run(bin('tsc'), ['--noEmit', '-p', 'type-tests-negative/wrong-param/tsconfig.json'])
const wrongParamErrors = wrongParam.output.split('\n').filter((line) => /error TS\d+/.test(line))
check(2, '反例：把 params 的 round 写成 rund，tsc 报错', wrongParam.code !== 0 && wrongParamErrors.length === 1 && /wrong-param\.tsx.*TS2353.*'rund'/.test(wrongParamErrors[0] ?? ''),
  `${firstErrorLine(wrongParam.output)}…`)

const racDocsHref = run(bin('tsc'), ['--noEmit', '-p', 'type-tests-negative/rac-docs-href/tsconfig.json'])
probe('照 React Aria 文档把 RouterConfig.href 声明成 ToOptions[\'to\']，具体地址 \'/p/产品循环\' 成了类型错误',
  racDocsHref.code !== 0 && /rac-docs-href\.tsx.*TS2322.*\/p\/产品循环/.test(racDocsHref.output),
  `${firstErrorLine(racDocsHref.output.split('\n').filter((l) => l.includes('rac-docs-href.tsx')).join('\n'))}…`)

// 路由层面的对照（在 Node 里跑，只用 buildLocation 和 matchRoutes，不渲染）：
// 同一个带查询参数的地址，给 { to } 和给 { href } 时，TanStack 各自算出的位置和参数。
{
  const R = await import('@tanstack/react-router')
  const rootRoute = R.createRootRoute()
  const projectRoute = R.createRoute({ getParentRoute: () => rootRoute, path: '/p/$project' })
  const roundRoute = R.createRoute({ getParentRoute: () => projectRoute, path: 'r/$round' })
  const router = R.createRouter({
    routeTree: rootRoute.addChildren([projectRoute.addChildren([roundRoute])]),
    history: R.createMemoryHistory({ initialEntries: ['/'] }),
  })
  const href = '/p/产品循环/r/v2-检查-1?item=F-1'
  const leaf = (location) => router.matchRoutes(location).at(-1)
  const viaTo = leaf(router.buildLocation({ to: href }))
  const viaHref = leaf(router.buildLocation({ href }))
  probe('buildLocation({ to }) 把查询串算进了路径参数；buildLocation({ href }) 拆对了',
    viaTo?.params.round === 'v2-检查-1?item=F-1' && viaHref?.params.round === 'v2-检查-1' && viaHref?.search.item === 'F-1',
    `to → round='${viaTo?.params.round}'；href → round='${viaHref?.params.round}'，search.item='${viaHref?.search.item}'`)

  // 默认的查询参数序列化按 JSON 走：像数字的字符串写进地址会加引号，手写的 ?item=3 读出来是数字。
  // 06 里 `ploop page present` 打印的地址由后端拼，和这里的写法对不上时，页面的 z.string() 校验就会失败。
  const written = router.buildLocation({ to: '/p/$project/r/$round', params: { project: 'x', round: 'y' }, search: { item: '3' } }).searchStr
  const read = router.options.parseSearch('?item=3')
  probe('默认查询参数序列化：字符串 \'3\' 写成 ?item=%223%22，手写的 ?item=3 读成数字 3', written === '?item=%223%22' && read.item === 3,
    `写：{ item: '3' } → ${written}；读：?item=3 → ${JSON.stringify(read)}`)
}

// ── 2 / 3 / 4. 无头浏览器 ─────────────────────────────────────────────────
if (build.code === 0) {
  try {
    await browserCheck({ root, check, probe, facts })
  } catch (error) {
    check(4, '无头浏览器检查跑完', false, String(error?.stack ?? error).slice(0, 1500))
  }
} else {
  check(4, '无头浏览器检查跑完', false, '构建失败，跳过')
}

// ── 汇总 ─────────────────────────────────────────────────────────────────
console.log('\n汇总：')
let allOk = true
for (const [item, title] of Object.entries(ITEMS)) {
  const mine = checks.filter((c) => c.item === Number(item))
  const ok = mine.length > 0 && mine.every((c) => c.ok)
  allOk &&= ok
  console.log(`  ${ok ? '通过  ' : '不通过'} ${item}. ${title}（${mine.filter((c) => c.ok).length}/${mine.length}）`)
}
if (facts.consoleProblems?.length) {
  console.log(`\n控制台的错误和警告（${facts.consoleProblems.length} 条）：`)
  for (const line of facts.consoleProblems) console.log(`  ${line.slice(0, 200)}`)
}

mkdirSync(path.join(root, 'evidence'), { recursive: true })
writeFileSync(path.join(root, 'evidence', 'verify-report.json'),
  `${JSON.stringify({ at: new Date().toISOString(), ok: allOk, facts, checks, probes }, null, 2)}\n`)
console.log(`\n${allOk ? '全部通过' : '有不通过的项'}。详细结果：evidence/verify-report.json，截图：evidence/round.png`)
process.exit(allOk ? 0 : 1)
