// /admin 不进打包产物（2026-10-05，Issue #2 方案 1）
//
// ## 病
//
// `App.tsx` 里那句 `lazy(() => import('./pages/admin/AdminPage'))` 是**无条件**的，
// 于是 `pages/admin/` 那 1482 行与它引用的 echarts 都会被打进安装版。全仓库没有任何
// 口令、token 或解锁状态检查（搜 `password|passphrase|requireAuth|unlock` 只命中
// loading 动画的 class），所以**能开 devtools 的人改一下 hash 就能进 /admin**。
//
// ## 修法
//
// `import.meta.env.DEV` 是 Vite 的编译期常量：`npm run build` 时它恒为 `false`，
// Rollup 的死代码消除会把整个 true 分支连同那句 `import()` 一起丢掉。改回无条件
// lazy import 的话 /admin 路由又会回到安装版里 —— 那是本判据要挡的。
//
// ## 为什么判据落在构建产物上
//
// 光看源码证不到这件事：`import()` 写在源码里，Vite 照样会为它生成 chunk。
// **只有真的 build 一次、再到产物里找那段代码，才能证明它没被打进去。**

import { describe, it, expect, beforeAll } from 'vitest'
import { execFileSync } from 'child_process'
import { readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const ASSETS = join(ROOT, 'dist', 'renderer', 'assets')
const ADMIN_DIR = join(ROOT, 'src', 'renderer', 'src', 'pages', 'admin')
const APP_TSX = join(ROOT, 'src', 'renderer', 'src', 'App.tsx')

/**
 * 判据要挑**admin 独占**的字符串 —— 挑了别处也有的词，那条断言就是自证式空转。
 *
 * 选它们之前实测过一轮（2026-10-05）：
 *   - 「知识库」admin 之外还有 5 个文件（首页、检索面板、备份…）⇒ 不能用
 *   - 「数据库」11 个文件 ⇒ 不能用
 *   - 「会话历史」1 个文件 ⇒ 不能用
 *   - **「提示词中心」0 个文件** ⇒ 独占，可用
 *   - 组件名 `KnowledgeBase` / `DatabaseBrowser` / `PromptCenter` / `SessionHistory`
 *     **各 0 个文件** ⇒ 全部独占，可用
 *   （`AdminDashboard` 反而有 3 个文件在别处引用它 —— 所以它不在名单里）
 *
 * 组件名那条比中文更硬：即使文案被压缩，标识也会跟着进产物。
 */
const ADMIN_ONLY_STRINGS = ['提示词中心']

/** admin 组件内部才有的标识 —— 打包后即使文案被压缩，标识也跟着走 */
const ADMIN_ONLY_SYMBOLS = ['KnowledgeBase', 'DatabaseBrowser', 'PromptCenter', 'SessionHistory']

function build(): void {
  // `shell: true`：Windows 上 npm 是 `npm.cmd`，execFileSync 直接 spawn 'npm' 会 ENOENT
  execFileSync('npm run build', { cwd: ROOT, stdio: 'pipe', shell: true, timeout: 300_000 })
}

function chunkNames(): string[] {
  return existsSync(ASSETS) ? readdirSync(ASSETS).filter((f) => f.endsWith('.js')) : []
}

function allChunks(): string {
  return chunkNames()
    .map((f) => readFileSync(join(ASSETS, f), 'utf8'))
    .join('\n')
}

/** admin 源码目录里全部文件的合订（量的是"这些字符串在源码里真实存在"） */
function adminSource(): string {
  return readdirSync(ADMIN_DIR)
    .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
    .map((f) => readFileSync(join(ADMIN_DIR, f), 'utf8'))
    .join('\n')
}

describe('/admin 不进打包产物', () => {
  beforeAll(() => {
    rmSync(ASSETS, { recursive: true, force: true })
    build()
  }, 310_000)

  it('构建产物里没有 admin chunk 文件', () => {
    const names = chunkNames()
    expect(names.length, '构建没产出任何 js —— 锚点变了或构建失败').toBeGreaterThan(10)
    expect(names.filter((f) => /admin/i.test(f)), '产物里还有 admin chunk').toEqual([])
  })

  it('产物里搜不到 admin 独有的文案', () => {
    const chunks = allChunks()
    expect(ADMIN_ONLY_STRINGS.filter((s) => chunks.includes(s)), '这些 admin 专属文案进了产物').toEqual([])
  })

  it('产物里搜不到 admin 组件名（压缩后也不该有）', () => {
    const chunks = allChunks()
    expect(ADMIN_ONLY_SYMBOLS.filter((s) => chunks.includes(s)), 'admin 组件标识进了产物').toEqual([])
  })

  // ↓↓ 负向断言必须配「该发生的确实发生了」。上面三条若这套扫描根本看不见东西，
  // 它们会永远绿 —— 所以下面先证明"这些字符串在源码里真实存在"，也就是扫描有视野。
  it('反证 · 这套扫描有视野：admin 独占的那些字符串在源码里一条都不缺', () => {
    const src = adminSource()
    expect(src.length, 'admin 源码目录读空了 —— 扫描没东西可看').toBeGreaterThan(1000)
    const all = [...ADMIN_ONLY_STRINGS, ...ADMIN_ONLY_SYMBOLS]
    expect(
      all.filter((s) => !src.includes(s)),
      '这些字符串连 admin 源码里都没有，判据的字符串选错了',
    ).toEqual([])
  })

  it('反证 · 产物里确实有别的中文文案（证明上面那两条 grep 不是永远 0 命中）', () => {
    const chunks = allChunks()
    expect(chunks.length).toBeGreaterThan(1000)
    // 「复习」「设置」这类词在别的页面里必然出现 —— 它们命中，说明这套扫描看得见中文
    const anyCommon = ['复习', '设置', '书架'].filter((s) => chunks.includes(s))
    expect(anyCommon.length, '连设置页的文案都搜不到，说明扫描本身坏了').toBeGreaterThan(0)
  })

  it('反证 · 把 App.tsx 改回无条件 lazy import，产物里就会重新出现 admin', () => {
    // 只量"现在没有"不够 —— 还得证明"是因为做了那个改动才没有"，否则判据钉不住任何东西。
    const original = readFileSync(APP_TSX, 'utf8')
    const mutated = original.replace(
      /const AdminPage = import\.meta\.env\.DEV[\s\S]*?\n\n/,
      "const AdminPage = lazy(() => import('./pages/admin/AdminPage'))\n\n",
    )
    expect(mutated, '变异没改到位 —— App.tsx 里那段代码的形状变了').not.toBe(original)

    try {
      writeFileSync(APP_TSX, mutated, 'utf8')
      build()
      expect(
        chunkNames().some((f) => /admin/i.test(f)),
        '改回无条件 import 后产物里仍然没有 admin —— 判据没牙',
      ).toBe(true)
    } finally {
      // 还原并重建，判据文件自己不许把仓库留在改坏的状态
      writeFileSync(APP_TSX, original, 'utf8')
      expect(readFileSync(APP_TSX, 'utf8'), 'App.tsx 没还原干净').toBe(original)
      build()
    }
  }, 620_000)
})