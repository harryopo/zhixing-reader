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
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, readFileSync, existsSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'

const execFileAsync = promisify(execFile)

const ROOT = join(__dirname, '..')
const ASSETS = join(ROOT, 'dist', 'renderer', 'assets')
const ADMIN_DIR = join(ROOT, 'src', 'renderer', 'src', 'pages', 'admin')
const APP_TSX = join(ROOT, 'src', 'renderer', 'src', 'App.tsx')
const APP_TSX_REL = 'src/renderer/src/App.tsx'

/**
 * 这个文件相对 HEAD 有没有未提交改动。
 *
 * `git diff --quiet` 用退出码说话：0 = 干净，1 = 有差异。**其他退出码一律抛出去**
 * （git 没跑成时不能把"查不出来"演成"干净"）。
 */
async function workingTreeDirtyFor(relPath: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['diff', '--quiet', 'HEAD', '--', relPath], { cwd: ROOT })
    return false
  } catch (error) {
    const code = (error as { code?: number | string }).code
    if (code === 1) return true
    throw error
  }
}

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

async function build(): Promise<void> {
  // `shell: true`：Windows 上 npm 是 `npm.cmd`，直接 spawn 'npm' 会 ENOENT。
  // 必须**异步**：这一支在 worker 里真跑三进程构建，CI 实测 64s。同步版本（execFileSync）
  // 会把整个 worker 的事件循环冻住，birpc 对 `onTaskUpdate` 的应答窗口是
  // `DEFAULT_TIMEOUT = 6e4`（60 秒，Vitest 3.2 没有配置项能改），于是全套判据绿、
  // 覆盖率也过阈值，vitest 仍报 `[vitest-worker]: Timeout calling "onTaskUpdate"` 退 1
  // —— 2026-10-16 master @ 6d21710 与 bd02655 两次 CI 红就是这个。
  // `maxBuffer` 放宽：build 会打一整张产物清单，默认 1 MB 有截断风险（截断只抛错，比冻住好，但没必要留）。
  // 不写 `stdio`：`execFile` 本身就是把 stdout/stderr 收进 buffer（受 `maxBuffer` 管），
  // 而 promisify 后的重载类型里不接受这个键（typecheck 当场拒）。
  await execFileAsync('npm run build', {
    cwd: ROOT,
    shell: true,
    timeout: 300_000,
    maxBuffer: 32 * 1024 * 1024,
  })
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
  beforeAll(async () => {
    rmSync(ASSETS, { recursive: true, force: true })
    // 这条断言钉的是"构建期间 worker 还活着"，也就是 CI 那个红的根因本身：
    // 同步调用时计时器一次都跳不了（事件循环被占死），异步时必然跳到。
    // 为什么不用"抬超时"来修：Vitest 3.2 根本没有那个配置键（我试过 `poolOptions.threads.rpcTimeout`，
    // dist 里 0 命中 ⇒ 静默忽略 ⇒ 假防线）。
    let ticks = 0
    const probe = setInterval(() => {
      ticks += 1
    }, 50)
    try {
      await build()
    } finally {
      clearInterval(probe)
    }
    expect(ticks, '构建期间事件循环一次都没跳 —— 又退回同步调用了，CI 会顶穿 60 秒的 RPC 窗口').toBeGreaterThan(0)
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

  it('反证 · 把 App.tsx 改回无条件 lazy import，产物里就会重新出现 admin', async (ctx) => {
    // 只量"现在没有"不够 —— 还得证明"是因为做了那个改动才没有"，否则判据钉不住任何东西。
    const original = readFileSync(APP_TSX, 'utf8')
    // 这一条脏不脏都要说话：闸门要是被人拿掉，下面那个变异的前提就没了
    expect(original, 'App.tsx 里 import.meta.env.DEV 那道闸门不见了 —— 反证的前提已经不存在').toMatch(
      /const AdminPage = import\.meta\.env\.DEV/,
    )

    /*
      这一支会把 App.tsx 真的改掉再还原（约 30 秒）。这个目录可能被另一路会话同时编辑：
      2026-10-17 09:19 全量跑的时候，对方 09:20:22 存了一次 App.tsx，正撞在"改掉还没还原"
      那段时间里 ⇒ `npm run build` 当场失败（那条红不是任何人的代码坏了）。
      更坏的一种可能是我的还原把对方没提交的改动盖回去 —— 那笔活没进 git，盖掉就没了。
      所以：**这个文件相对 HEAD 有未提交改动 ⇒ 认出来、标成 skipped 并说清原因**，
      不静默当过。CI 上工作树是干净的，这一支照跑。
    */
    if (await workingTreeDirtyFor(APP_TSX_REL)) {
      ctx.skip(
        'App.tsx 有未提交的改动（另一路会话正在改它），这一支会改那个文件再还原，' +
          '脏着跑可能盖掉别人没进 git 的活。CI 上照跑；本地要跑就先提交或还原该文件。',
      )
    }

    const mutated = original.replace(
      /const AdminPage = import\.meta\.env\.DEV[\s\S]*?\n\n/,
      "const AdminPage = lazy(() => import('./pages/admin/AdminPage'))\n\n",
    )
    expect(mutated, '变异没改到位 —— App.tsx 里那段代码的形状变了').not.toBe(original)

    try {
      writeFileSync(APP_TSX, mutated, 'utf8')
      await build()
      expect(
        chunkNames().some((f) => /admin/i.test(f)),
        '改回无条件 import 后产物里仍然没有 admin —— 判据没牙',
      ).toBe(true)
    } finally {
      // 还原并重建，判据文件自己不许把仓库留在改坏的状态
      writeFileSync(APP_TSX, original, 'utf8')
      expect(readFileSync(APP_TSX, 'utf8'), 'App.tsx 没还原干净').toBe(original)
      await build()
    }
  }, 620_000)
})