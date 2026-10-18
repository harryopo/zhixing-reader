/**
 * 设置页那一排导航：六份抄件收成一份（2026-10-18）
 *
 * 量具是 AST 扫模块级字面量，量出来 `data-utils.ts` 与各子页里的 `SETTINGS_NAV_ITEMS`
 * **同体跨文件**共 6 份。逐字段一对，三份已经分家了：
 *  - 标签：`AI配置`（2 页）vs `AI 配置`（5 页）—— 切一个分区，导航条上一个字变了；
 *  - 图标：账户 `user` vs `profile`；微信读书页把 AI 那格画成 `agent`、编排那格画成 `box`；
 *  - 锚点：About / Account / Appearance 三页**唯独自己那一格没有 `domId`**，
 *    而它们的 JSX 写的是 `data-dom-id={item.domId}` ⇒ 在那一页上 `settings-tab-<自己>` 这个属性根本不存在；
 *    微信读书页 7 格全没有（它改用模板）；`SettingsAgent` 里那句 `item.domId ?? \`settings-tab-${item.key}\``
 *    正是这个症状的本地止痛药。
 *
 * 现在导航只有一份，各页只声明"我是哪一格"。判据钉三件事：
 * ① 全树不许再出现第二份数组字面量形式的导航清单（**收集器是纯函数**，反证喂内存内容，不在测试里改仓库文件）；
 * ② 那份清单自己的形状不变量（key 唯一、`path`/`domId` 由 key 派生、标签不许空）；
 * ③ `settingsNav` 只点亮被点名的那一格。图标名由 `IconName` 在编译期管，不在这里重复。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { NAV_ITEMS, settingsNav } from '../src/renderer/src/pages/settings/data-utils'

const ROOT = join(__dirname, '..')
const SETTINGS_DIR = join('src', 'renderer', 'src', 'pages', 'settings')

type SourceFile = { path: string; src: string }

/** 数组字面量形式的导航清单定义（委托写法 `= settingsNav(...)` 不算） */
const NAV_LIST_DEF = /^\s*(?:export )?const (?:SETTINGS_)?NAV_ITEMS\s*:\s*[\w<>[\]]+\s*=\s*\[/m

function findNavListDefinitions(files: SourceFile[]): string[] {
  return files.filter((f) => NAV_LIST_DEF.test(f.src)).map((f) => f.path)
}

function settingsSources(): SourceFile[] {
  const dir = join(ROOT, SETTINGS_DIR)
  return readdirSync(dir)
    .filter((n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n))
    .map((n) => ({ path: join(SETTINGS_DIR, n).split('\\').join('/'), src: readFileSync(join(dir, n), 'utf8') }))
}

/** 那份清单的形状问题清单（返回空数组 == 没问题） */
function navListGaps(list: { key: string; label: string; path: string; domId: string }[]): string[] {
  const gaps: string[] = []
  const keys = list.map((i) => i.key)
  if (new Set(keys).size !== keys.length) gaps.push('key 有重复')
  for (const item of list) {
    if (!item.label || !item.label.trim()) gaps.push(`${item.key}: 标签是空的`)
    if (item.path !== `/settings/${item.key}`) gaps.push(`${item.key}: 路径 ${item.path} 与 key 不匹配`)
    if (item.domId !== `settings-tab-${item.key}`) gaps.push(`${item.key}: 锚点 ${item.domId} 与 key 不匹配`)
  }
  return gaps
}

describe('设置页导航只有一份', () => {
  const files = settingsSources()

  it('横扫看得见东西：settings 目录真量到 6 个以上文件（否则下面那条是空话）', () => {
    expect(files.length, '一个文件都没量到 ⇒ 目录口径变了').toBeGreaterThanOrEqual(6)
  })

  it('数组字面量形式的导航清单，全目录只许有 data-utils 那一处', () => {
    expect(
      findNavListDefinitions(files).map((p) => p.split('/').pop()),
      '有人又抄了一份导航清单（各抄一份已经让标签、图标、锚点三样分家过）',
    ).toEqual(['data-utils.ts'])
  })

  it('六个子页都改问那一份（不许留第五份止痛药）', () => {
    const pages = ['SettingsAI.tsx', 'SettingsAbout.tsx', 'SettingsAccount.tsx', 'SettingsAgent.tsx', 'SettingsAppearance.tsx', 'SettingsWeRead.tsx']
    for (const name of pages) {
      const file = files.find((f) => f.path.endsWith(name))
      expect(file, `找不到 ${name}（改名了要同步这条判据）`).toBeTruthy()
      expect(
        file!.src,
        `${name} 没走共享那份`,
      ).toMatch(/from '\.\/data-utils'|\{ NAV_ITEMS \}/)
      expect(file!.src, `${name} 里还留着 ?? settings-tab- 那种本地兜底`).not.toMatch(/\?\? `settings-tab-/)
    }
  })

  it('量具有牙 · 又抄一份、或锚点/路径写歪，横扫与形状检查都得报', () => {
    const copied: SourceFile[] = files.concat([
      { path: 'src/renderer/src/pages/settings/合成页.tsx', src: "const SETTINGS_NAV_ITEMS: Item[] = [\n  { key: 'ai' },\n]\n" },
    ])
    expect(findNavListDefinitions(copied).length, '副本没被量出来 ⇒ 这条横扫是瞎的').toBe(
      findNavListDefinitions(files).length + 1,
    )
    // 委托写法与注释里的同名文字都不算第二份定义
    const delegated: SourceFile[] = [
      { path: 'a.ts', src: "const SETTINGS_NAV_ITEMS = settingsNav('ai')\n" },
      { path: 'b.ts', src: '// const SETTINGS_NAV_ITEMS: Item[] = [ 旧写法\n' },
    ]
    expect(findNavListDefinitions(delegated), '委托写法或注释被误当成定义').toEqual([])
    expect(
      navListGaps([{ key: 'ai', label: 'AI 配置', path: '/settings/weread', domId: 'settings-tab-ai' }]),
      '路径写歪必须报',
    ).toEqual(['ai: 路径 /settings/weread 与 key 不匹配'])
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
