/**
 * 设置页那一排导航：七份抄件收成一份（2026-10-18）
 *
 * 量具是 AST 扫模块级字面量，第一遍量出来 `data-utils.ts` 与各子页里的 `SETTINGS_NAV_ITEMS`
 * **同体跨文件**共 6 份。逐字段一对，三份已经分家了：
 *  - 标签：`AI配置`（2 页）vs `AI 配置`（5 页）—— 切一个分区，导航条上一个字变了；
 *  - 图标：账户 `user` vs `profile`；微信读书页把 AI 那格画成 `agent`、编排那格画成 `box`；
 *  - 锚点：About / Account / Appearance 三页**唯独自己那一格没有 `domId`**，
 *    而它们的 JSX 写的是 `data-dom-id={item.domId}` ⇒ 在那一页上 `settings-tab-<自己>` 这个属性根本不存在；
 *    微信读书页 7 格全没有（它改用模板）；`SettingsAgent` 里那句 `item.domId ?? \`settings-tab-${item.key}\``
 *    正是这个症状的本地止痛药。
 *
 * ⚠️ 第一版把横扫范围写成 `pages/settings/` 目录，于是**第七份抄件就这么漏过去了** ——
 * `pages/Settings.tsx`（设置总页的左侧栏与入口卡片）自己持有一份带 `desc` 的同款清单，
 * 图标与子页那一份分家在 `account`（`user` vs `profile`）与 `ai`（`agent` vs `settings`）两格上。
 * 现在改成**按内容认清单、扫整个渲染层**：一份数组字面量里出现两个以上 `'/settings/<键>'` 就算导航清单，
 * 变量叫什么、住在哪个目录都不管（注释里的同名文字与 `= settingsNav(...)` 委托写法不算）。
 *
 * 判据钉四件事：
 * ① 全渲染层不许出现第二份导航清单字面量（**收集器是纯函数**，反证喂内存内容，不在测试里改仓库文件）；
 * ② 那份清单自己的形状不变量（key 唯一、`path`/`domId` 由 key 派生、标签与说明不许空）；
 * ③ `settingsNav` 只点亮被点名的那一格；
 * ④ 总页与六个子页都问那一份要（图标由 `IconName` 在编译期管，这里不重复）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { NAV_ITEMS, settingsNav } from '../src/renderer/src/pages/settings/data-utils'

const ROOT = join(__dirname, '..')
const RENDERER_SRC = join('src', 'renderer', 'src')

type SourceFile = { path: string; src: string }

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    const rel = abs.slice(ROOT.length + 1).split('\\').join('/')
    if (entry.isDirectory()) walk(abs, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push({ path: rel, src: readFileSync(abs, 'utf8') })
    }
  }
  return out
}

/** 行注释与块注释里的文字不算代码里的定义（注释里写一遍旧写法是说明，不是抄件） */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 模块顶层数组字面量的体（从 `[` 配平到与之匹配的 `]`），逐个交回 */
function topLevelArrayBodies(src: string): string[] {
  const bodies: string[] = []
  const defAtLineStart = /(^|\n)(?:export\s+)?const\s+[A-Za-z_][\w]*\s*(?::[^=\n]+)?=\s*\[/g
  let m: RegExpExecArray | null
  while ((m = defAtLineStart.exec(src)) !== null) {
    const open = src.lastIndexOf('[', m.index + m[0].length)
    let depth = 0
    for (let i = open; i < src.length; i++) {
      if (src[i] === '[') depth++
      else if (src[i] === ']') {
        depth--
        if (depth === 0) {
          bodies.push(src.slice(open, i + 1))
          break
        }
      }
    }
  }
  return bodies
}

/** 一份导航清单 = 顶层数组字面量里出现两个以上 `'/settings/<键>'` 路径 */
const SETTINGS_PATH_IN_LITERAL = /['"`]\/settings\/[A-Za-z-]+['"`]/g

function findNavListDefinitions(files: SourceFile[]): string[] {
  return files
    .filter((f) =>
      topLevelArrayBodies(stripComments(f.src)).some(
        (body) => (body.match(SETTINGS_PATH_IN_LITERAL) || []).length >= 2,
      ),
    )
    .map((f) => f.path)
}

const CANONICAL = 'src/renderer/src/pages/settings/data-utils.ts'

/** 那份清单的形状问题清单（返回空数组 == 没问题） */
function navListGaps(
  list: { key: string; label: string; desc: string; path: string; domId: string }[],
): string[] {
  const gaps: string[] = []
  const keys = list.map((i) => i.key)
  if (new Set(keys).size !== keys.length) gaps.push('key 有重复')
  for (const item of list) {
    if (!item.label || !item.label.trim()) gaps.push(`${item.key}: 标签是空的`)
    if (!item.desc || !item.desc.trim()) gaps.push(`${item.key}: 说明是空的`)
    if (item.path !== `/settings/${item.key}`) gaps.push(`${item.key}: 路径 ${item.path} 与 key 不匹配`)
    if (item.domId !== `settings-tab-${item.key}`) gaps.push(`${item.key}: 锚点 ${item.domId} 与 key 不匹配`)
  }
  return gaps
}

describe('设置页导航只有一份', () => {
  const files = walk(join(ROOT, RENDERER_SRC))

  it('横扫看得见东西：整个渲染层真量到 100 个以上文件（否则下面那条是空话）', () => {
    expect(files.length, '一个文件都没量到 ⇒ 目录口径变了').toBeGreaterThanOrEqual(100)
  })

  it('全渲染层只许有 data-utils 那一处导航清单', () => {
    expect(
      findNavListDefinitions(files),
      '有人又抄了一份导航清单（七份抄件已经让标签、图标、锚点三样分家过）',
    ).toEqual([CANONICAL])
  })

  it('量具有牙 · 第七份抄件那种写法（总页带 desc 的那一份）必须被认出来', () => {
    // 这份反证喂的是 2026-10-18 真实存在过、被第一版横扫漏掉的那个形状：变量名同款、目录不同、还多带 desc
    const missedBefore: SourceFile = {
      path: 'src/renderer/src/pages/合成总页.tsx',
      src:
        'const NAV_ITEMS: NavItemDef[] = [\n' +
        "  { key: 'account', label: '账户', desc: 'x', icon: <Icon name=\"user\" size={18} />, path: '/settings/account' },\n" +
        "  { key: 'ai', label: 'AI 配置', desc: 'y', icon: <Icon name=\"agent\" size={18} />, path: '/settings/ai' },\n" +
        ']\n',
    }
    expect(findNavListDefinitions(files.concat([missedBefore])), '那种形状现在必须报出来').toEqual(
      findNavListDefinitions(files).concat([missedBefore.path]),
    )
  })

  it('反证与防误伤：单条路径、委托写法、注释里的同名文字都不算第二份定义', () => {
    const samples: SourceFile[] = [
      { path: 'x1.ts', src: "const LINKS = ['/settings/ai']\n" }, // 只有一条路径 ⇒ 不是清单
      { path: 'x2.ts', src: "const SETTINGS_NAV_ITEMS = settingsNav('ai')\n" }, // 委托写法
      { path: 'x3.ts', src: '// const NAV_ITEMS: Item[] = [ { path: \'/settings/a\' }, { path: \'/settings/b\' } ]\n' }, // 注释
      {
        path: 'x4.ts',
        src: "const SETTINGS_NAV_ITEMS: Item[] = [\n  { path: '/settings/a' },\n  { path: '/settings/b' },\n]\n",
      }, // 真抄件 ⇒ 必须报
    ]
    expect(findNavListDefinitions(samples)).toEqual(['x4.ts'])
  })

  it('形状检查能指出写歪的路径与空的说明', () => {
    expect(
      navListGaps([{ key: 'ai', label: 'AI 配置', desc: '', path: '/settings/weread', domId: 'settings-tab-ai' }]),
      '路径写歪与空说明都必须报',
    ).toEqual(['ai: 说明是空的', 'ai: 路径 /settings/weread 与 key 不匹配'])
  })

  it('总页与六个子页都改问那一份（不许留止痛药，也不许留本地类型）', () => {
    const pages = [
      'src/renderer/src/pages/Settings.tsx',
      'src/renderer/src/pages/settings/SettingsAI.tsx',
      'src/renderer/src/pages/settings/SettingsAbout.tsx',
      'src/renderer/src/pages/settings/SettingsAccount.tsx',
      'src/renderer/src/pages/settings/SettingsAgent.tsx',
      'src/renderer/src/pages/settings/SettingsAppearance.tsx',
      'src/renderer/src/pages/settings/SettingsWeRead.tsx',
    ]
    for (const rel of pages) {
      const file = files.find((f) => f.path === rel)
      expect(file, `找不到 ${rel}（改名了要同步这条判据）`).toBeTruthy()
      expect(
        file!.src,
        `${rel} 没走共享那份`,
      ).toMatch(/from '\.\/data-utils'|from '\.\/settings\/data-utils'/)
      expect(file!.src, `${rel} 里还留着 ?? settings-tab- 那种本地兜底`).not.toMatch(/\?\? `settings-tab-/)
      expect(file!.src, `${rel} 不该再自己拼锚点/路径模板`).not.toMatch(/`settings-tab-\$\{item\.key\}`/)
    }
    const total = files.find((f) => f.path === 'src/renderer/src/pages/Settings.tsx')!
    expect(total.src, '总页不该再自己声明那七个键的联合类型').not.toMatch(/type SettingsTab\s*=/)
  })
})

describe('那份清单与 settingsNav 的形状', () => {
  it('七个分区、键唯一、路径与锚点都由键派生、标签不许空', () => {
    expect(NAV_ITEMS.length).toBe(7)
    expect(navListGaps(NAV_ITEMS), JSON.stringify(navListGaps(NAV_ITEMS))).toEqual([])
  })

  it('每一格都带锚点 —— 缺的那几页正是"自己这一格找不到"的成因', () => {
    expect(NAV_ITEMS.map((i) => i.domId)).toEqual([
      'settings-tab-account',
      'settings-tab-ai',
      'settings-tab-agent',
      'settings-tab-weread',
      'settings-tab-data',
      'settings-tab-appearance',
      'settings-tab-about',
    ])
  })

  it('settingsNav 只点亮被点名的那一格，其余一律 false', () => {
    for (const key of ['account', 'ai', 'agent', 'weread', 'data', 'appearance', 'about'] as const) {
      const withActive = settingsNav(key)
      expect(withActive.filter((i) => i.active).map((i) => i.key), key).toEqual([key])
      expect(withActive.length).toBe(NAV_ITEMS.length)
    }
  })

  it('交出去的副本不许能被改坏那份真的（返回的是新对象）', () => {
    const copy = settingsNav('ai')
    copy[0].domId = '被改过'
    expect(NAV_ITEMS[0].domId, '浅拷贝没做好，页面改一处会污染所有页').toBe('settings-tab-account')
  })
})
