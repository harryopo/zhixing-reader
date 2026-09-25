// 每条通道都得有人注册（2026-09-25，本批误删 handler 之后加的守卫）
//
// 起因是自己造的：批量删死通道时，`IPC_CHANNELS.VOCABULARY.CREATE` 按子串匹配把
// `...CREATE_FROM_LOOKUP` 的 handler 一起删了 —— 通道还在、preload 还在暴露、
// 四个页面还在调，只有主进程没人注册。typecheck 与既有用例**一条都抓不到**
// （它们不看运行时），只有真点一次「加入生词本」才会炸。
//
// 所以把三件事钉住：
//  1) 声明在 `ipc-channels.ts` 里的每条通道，要么被 handle 注册、要么是主进程往渲染层推的事件；
//  2) preload 里 `invoke(...)` 的每条通道都必须有 handle（这条正是上面那个 bug 的捕网）；
//  3) 判据本身要用假输入验过会响，不能是空转。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' || name === 'dist' ? [] : tsFiles(p)
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : []
  })
}

const CHANNEL_SRC = readFileSync(join(ROOT, 'src/shared/ipc-channels.ts'), 'utf8')

/** 声明表：`GROUP` 下的 `KEY: 'literal'` */
export function declaredChannels(src: string): Array<{ constPath: string; literal: string }> {
  const out: Array<{ constPath: string; literal: string }> = []
  let group = ''
  for (const line of src.split('\n')) {
    const g = /^ {2}([A-Z_]+): \{/.exec(line)
    if (g) {
      group = g[1]
      continue
    }
    if (/^ {2}\}/.test(line)) {
      group = ''
      continue
    }
    const k = /^ {4}([A-Z_]+): ['"]([\w]+:[\w]+)['"]/.exec(line)
    if (k && group) out.push({ constPath: `${group}.${k[1]}`, literal: k[2] })
  }
  return out
}

/** 从一批源码里收集常量的三种用法：注册、推送、被界面调用 */
export function collectRoles(mainSrc: string, preloadSrc: string) {
  const handled = new Set<string>()
  const pushed = new Set<string>()
  const invoked = new Set<string>()
  const listened = new Set<string>()

  for (const m of mainSrc.matchAll(/handle\(\s*IPC_CHANNELS\.([A-Z_]+\.[A-Z_0-9]+)/g)) handled.add(m[1])
  // 推送允许跨行：`send(` 与常量之间可以夹参数与换行
  for (const m of mainSrc.matchAll(/\.send\((?:(?!;)[\s\S])*?IPC_CHANNELS\.([A-Z_]+\.[A-Z_0-9]+)/g)) {
    pushed.add(m[1])
  }
  // preload 里 invoke 才算"界面主动要数据"，`.on(` 是订阅主进程推的事件
  for (const m of preloadSrc.matchAll(/invoke(?:<[^>]*>)?\(\s*IPC_CHANNELS\.([A-Z_]+\.[A-Z_0-9]+)/g)) {
    invoked.add(m[1])
  }
  for (const m of preloadSrc.matchAll(/\.on\(\s*IPC_CHANNELS\.([A-Z_]+\.[A-Z_0-9]+)/g)) listened.add(m[1])
  return { handled, pushed, invoked, listened }
}

const mainSources = [...tsFiles(join(ROOT, 'electron'))]
  .filter((f) => !f.includes('preload.ts'))
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n')
const preloadSource = readFileSync(join(ROOT, 'electron', 'preload.ts'), 'utf8')

const declared = declaredChannels(CHANNEL_SRC)
const { handled, pushed, invoked, listened } = collectRoles(mainSources, preloadSource)

describe('IPC 通道接线', () => {
  it('声明表不是空的（否则下面所有断言都在空转）', () => {
    expect(declared.length).toBeGreaterThan(100)
  })

  it('preload 里 invoke 的每条通道，主进程都有 handle', () => {
    const orphan = [...invoked].filter((c) => !handled.has(c))
    expect(orphan, `这些通道暴露给界面却没人注册：${orphan.join(', ')}`).toEqual([])
  })

  it('每条声明的通道要么被注册、要么在主进程里被用到（推送或订阅）', () => {
    const untracked = declared
      .filter(
        (d) => !handled.has(d.constPath) && !pushed.has(d.constPath) && !listened.has(d.constPath),
      )
      .map((d) => d.literal)
    expect(untracked, `这些通道没人注册、也没人推：${untracked.join(', ')}`).toEqual([])
  })

  it('注册了的通道都在声明表里（不许再出现硬编码通道名）', () => {
    const declaredPaths = new Set(declared.map((d) => d.constPath))
    const strays = [...handled, ...pushed].filter((c) => !declaredPaths.has(c))
    expect(strays, `注册/推送用了声明表之外的常量：${strays.join(', ')}`).toEqual([])
  })

  it('反证：删掉一条 handler 的注册，判据必须抓到（这正是本批误删的形状）', () => {
    const fakeMain = 'handle(IPC_CHANNELS.VOCABULARY.GET_ALL, () => [])\n'
    const fakePreload = 'getAll: () => invoke(IPC_CHANNELS.VOCABULARY.GET_ALL),'
    const ok = collectRoles(fakeMain, fakePreload)
    expect([...ok.invoked].filter((c) => !ok.handled.has(c))).toEqual([])

    // 同一段里 CREATE 注册了、CREATE_FROM_LOOKUP 只被 preload 调用而没注册 ⇒ 必须报出来
    const brokenMain = fakeMain + 'handle(IPC_CHANNELS.VOCABULARY.CREATE, () => [])\n'
    const brokenPreload =
      fakePreload + '\ncreate: () => invoke(IPC_CHANNELS.VOCABULARY.CREATE),\ncreateFromLookup: () => invoke(IPC_CHANNELS.VOCABULARY.CREATE_FROM_LOOKUP),'
    const bad = collectRoles(brokenMain, brokenPreload)
    expect([...bad.invoked].filter((c) => !bad.handled.has(c))).toEqual(['VOCABULARY.CREATE_FROM_LOOKUP'])

    // 子串匹配会误伤：CREATE 是 CREATE_FROM_LOOKUP 的前缀，判据是按整段常量名比的
    expect(bad.handled.has('VOCABULARY.CREATE_FROM_LOOKUP')).toBe(false)
  })
})
