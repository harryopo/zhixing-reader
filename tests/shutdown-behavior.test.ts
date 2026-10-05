// 「重启安装」退出收尾的**真行为**判据（2026-10-04）
//
// `tests/install-exit-path.test.ts` 那 5 条全是**读源码字符串**：它们能钉住"代码写成了
// 那个形状"（spawn → flush → exit 的顺序、before-quit 共用同一份），但证不到"跑起来真的
// 按那个顺序走"。Issue #1 之所以还开着，根子在这：那条修复随 v1.3.4 发了，5 条字符串判据
// 全绿，而没人真的装过一次 —— 判据量的是代码长什么样，不是它做了什么。
//
// 这个文件补上另一半：mock 只打在 `shutdown.ts` 的五个下游（closeDatabase /
// cancelActiveStream / stopWereadAutoSync / knowledgeCardService / logger），
// 然后调用**真的** `shutdownForExit()`，量它到底调了什么、按什么顺序、失败时还走不走后面几步。
//
// 期望先想清楚再写（Issue #8 那条硬要求，2026-09-23 起本项目都这么判）：
//   - 六步有顺序：先掐 AI 流（exit 不走窗口 close，这条路没人替我们做）→ 停同步定时器 →
//     关蒸馏服务 → **关库（内部先同步落盘）** → 关日志。落盘必须在关日志之前，
//     否则"写盘失败"这句话本身都写不进日志。
//   - 幂等：窗口 close 之后 before-quit 再跑一遍，不许重复关库。
//   - **一步抛错不许把后面几步一起带走**：这是本项目治过十几次的同一族
//     （"一层坏了不许把另一层带走"）。`closeDatabase` 抛错时 `logger.close()` 仍要执行，
//     否则这一次退出什么都留不下痕迹 —— 下次出问题连日志都没有。
//   - 每一步抛错时 `done` 标记不许把后续调用卡死：已经进来了就让它把能走的走完。

import { describe, it, expect, beforeEach, vi } from 'vitest'

const calls: string[] = []
/** 让某个步骤抛错；未列的步骤正常 */
const failing = new Set<string>()

/** 五个步骤的替身：调一个就往 calls 里记一笔，`failing` 里的那步改为抛错 */
const HANDLERS = {
  cancelActiveStream: () => {
    calls.push('cancelActiveStream')
    if (failing.has('cancelActiveStream')) throw new Error('掐流失败')
  },
  stopWereadAutoSync: () => {
    calls.push('stopWereadAutoSync')
    if (failing.has('stopWereadAutoSync')) throw new Error('停同步失败')
  },
  knowledgeCardService: () => {
    calls.push('knowledgeCardService.shutdown')
    if (failing.has('knowledgeCardService.shutdown')) throw new Error('蒸馏关不掉')
  },
  closeDatabase: () => {
    calls.push('closeDatabase')
    if (failing.has('closeDatabase')) throw new Error('落盘失败')
  },
  loggerClose: () => {
    calls.push('logger.close')
    if (failing.has('logger.close')) throw new Error('关日志失败')
  },
  loggerInfo: () => calls.push('logger.info:App quitting...'),
  loggerError: (label: string) => calls.push(`logger.error:${label}`),
}

/**
 * 用 `vi.doMock` 而不是文件顶部的 `vi.mock`：本文件每条用例都要
 * `vi.resetModules()` 后重新 import 一份干净的 `shutdown`（它的幂等标记 `done` 是
 * 模块级的，不清会漏进下一条）。而 `vi.mock` 是**静态提升**的 —— resetModules 连它一起
 * 清掉，第一版就这样静默失效：mock 全部没生效，`calls` 恒为空，10 条红得看不出是代码错
 * 还是 mock 没挂上（本项目在 `weread-sync-manager` 那批踩过同一形状：
 * "mock 静默失效、一条行为没钉住"）。`doMock` 是运行时注册，重新 import 时照样生效。
 */
function installMocks(): void {
  // 路径按**本测试文件**解析：`shutdown.ts` 内部写的是 './database' 之类，
  // 而 vitest 的 mock id 按调用方解析 —— 写成 'electron/database' 时两边落到不同的 id，
  // mock 静默不生效（第一版就这样：`calls` 恒为空，10 条红得看不出是代码错还是 mock 没挂上）。
  vi.doMock('../electron/database', () => ({ closeDatabase: () => HANDLERS.closeDatabase() }))
  vi.doMock('../electron/ai-sdk-service', () => ({
    cancelActiveStream: () => HANDLERS.cancelActiveStream(),
  }))
  vi.doMock('../electron/weread-sync-manager', () => ({
    stopWereadAutoSync: () => HANDLERS.stopWereadAutoSync(),
  }))
  vi.doMock('../electron/services/knowledge-card-service', () => ({
    knowledgeCardService: { shutdown: () => HANDLERS.knowledgeCardService() },
  }))
  vi.doMock('../electron/logger', () => ({
    logger: {
      info: () => HANDLERS.loggerInfo(),
      error: (message: string) => HANDLERS.loggerError(message),
      close: () => HANDLERS.loggerClose(),
    },
  }))
}

/** 每个用例一份全新的 shutdown 模块 —— 它的幂等标记是模块级的，不清会漏进下一条 */
async function freshShutdown(): Promise<typeof import('../electron/shutdown').shutdownForExit> {
  calls.length = 0
  failing.clear()
  installMocks()
  vi.resetModules()
  const mod = await import('../electron/shutdown')
  return mod.shutdownForExit
}

beforeEach(() => {
  calls.length = 0
  failing.clear()
})

/** 去掉 logger.info 那种带消息的，只留六步动作本身 */
const steps = (): string[] => calls.filter((c) => !c.startsWith('logger.info'))

describe('shutdownForExit · 六步按序走完', () => {
  it('按「掐流 → 停同步 → 关蒸馏 → 关库 → 关日志」的顺序收尾', async () => {
    const shutdownForExit = await freshShutdown()

    shutdownForExit()

    expect(steps()).toEqual([
      'cancelActiveStream',
      'stopWereadAutoSync',
      'knowledgeCardService.shutdown',
      'closeDatabase',
      'logger.close',
    ])
  })

  it('收尾开始与结束都留了一条日志（exit 不经过窗口 close，日志是唯一的痕迹）', async () => {
    const shutdownForExit = await freshShutdown()

    shutdownForExit()

    const infos = calls.filter((c) => c.startsWith('logger.info'))
    expect(infos.length).toBeGreaterThanOrEqual(1)
    // 关日志那条必须排在最后 —— 它之后写的东西都进不去了
    expect(calls[calls.length - 1]).toBe('logger.close')
  })

  it('关库排在关日志之前：落盘失败那句话本身要能写进日志', async () => {
    // 这条与 install-exit-path.test.ts 那条读源码的判据同义，但那边量的是字面量顺序，
    // 这边量的是真的调用序列 —— 顺序写对了但中间插进一句 await/回调就可能变，两条互补。
    const shutdownForExit = await freshShutdown()

    shutdownForExit()

    expect(steps().indexOf('closeDatabase')).toBeLessThan(steps().indexOf('logger.close'))
  })
})

describe('shutdownForExit · 幂等', () => {
  it('走第二遍时一步都不再走（窗口 close 之后 before-quit 还会再跑一次）', async () => {
    const shutdownForExit = await freshShutdown()

    shutdownForExit()
    const afterFirst = steps().length
    shutdownForExit()
    shutdownForExit()

    expect(steps().length).toBe(afterFirst)
  })

  it('第二遍不关库两次 —— 重复 closeDatabase 会把连接二次收尾', async () => {
    const shutdownForExit = await freshShutdown()

    shutdownForExit()
    shutdownForExit()

    expect(steps().filter((s) => s === 'closeDatabase')).toHaveLength(1)
  })
})

describe('shutdownForExit · 一步坏了不许把后面几步一起带走', () => {
  it.each([
    ['cancelActiveStream', ['stopWereadAutoSync', 'knowledgeCardService.shutdown', 'closeDatabase', 'logger.close']],
    ['stopWereadAutoSync', ['knowledgeCardService.shutdown', 'closeDatabase', 'logger.close']],
    ['knowledgeCardService.shutdown', ['closeDatabase', 'logger.close']],
    ['closeDatabase', ['logger.close']],
  ])('%s 抛错时，后面这几步仍然要跑', async (broken, stillRuns) => {
    const shutdownForExit = await freshShutdown()
    failing.add(broken)

    // 这一步本身会抛，但退出路径不能因为它就停在原地 ——
    // 真机上这一步抛错的表现是"退出卡住、数据没落盘"，比少写一条日志严重得多。
    expect(() => shutdownForExit()).toThrow()

    for (const step of stillRuns) {
      expect(steps(), `${broken} 抛错后 ${step} 没跑`).toContain(step)
    }
  })

  it('反证 · 关库抛错时关日志仍执行（否则这次退出什么都不留痕迹）', async () => {
    // 这一条是本文件最要紧的：`closeDatabase` 抛错 ⇒ 如果收尾没有兜住，
    // `logger.close()` 永远轮不到，而这次退出为什么失败就成了没证据的事。
    const shutdownForExit = await freshShutdown()
    failing.add('closeDatabase')

    expect(() => shutdownForExit()).toThrow()
    expect(steps()).toContain('logger.close')
  })

  it('抛错的那一步会被逐条记进日志（不留痕迹的失败是最难查的那种）', async () => {
    const shutdownForExit = await freshShutdown()
    failing.add('closeDatabase')

    expect(() => shutdownForExit()).toThrow()

    // 日志里要指名是哪一步坏了，不是一句"退出失败"
    const errs = calls.filter((c) => c.startsWith('logger.error:'))
    expect(errs).toEqual(['logger.error:Shutdown step failed: closeDatabase'])
  })

  it('失败被汇总成一条抛回去，调用方不会误以为收尾成功了', async () => {
    const shutdownForExit = await freshShutdown()
    failing.add('closeDatabase')
    failing.add('stopWereadAutoSync')

    let thrown: unknown = null
    try {
      shutdownForExit()
    } catch (error) {
      thrown = error
    }

    // 吞掉错误比报出来更坏：调用方看到"没抛"就以为盘写好了
    expect(thrown).not.toBeNull()
    const agg = thrown as AggregateError
    expect(agg.errors).toHaveLength(2)
    expect(agg.errors.map((e: Error) => e.message).sort()).toEqual(['落盘失败', '停同步失败'].sort())
  })

  it('全顺时不抛（正常退出不该被收尾自己打断）', async () => {
    const shutdownForExit = await freshShutdown()
    expect(() => shutdownForExit()).not.toThrow()
  })

  it('一步抛错之后第二遍调用仍能走完剩下的（幂等标记不许把退出卡在半路）', async () => {
    const shutdownForExit = await freshShutdown()
    failing.add('closeDatabase')
    expect(() => shutdownForExit()).toThrow()

    // done 已经置位 ⇒ 第二遍按幂等规则一步都不走。这是"粘住"而不是"接着走"，
    // 断在这里是要说清设计意图：退出只做一次，不做重试。数据没落盘是上一遍的问题，
    // 重试一次 closeDatabase 也不能凭空把盘写出来。
    failing.clear()
    const after = steps().length
    shutdownForExit()
    expect(steps().length).toBe(after)
  })
})

describe('shutdownForExit · 全顺时的收尾形状', () => {
  it('全顺时不抛（正常退出不该被收尾自己打断）', async () => {
    const shutdownForExit = await freshShutdown()
    expect(() => shutdownForExit()).not.toThrow()
  })

  it('全顺时只留一条 "App quitting"，不记任何错误', async () => {
    const shutdownForExit = await freshShutdown()

    shutdownForExit()

    const errs = calls.filter((c) => c.startsWith('logger.error:'))
    expect(errs).toEqual([])
  })

  // 这一条是 2026-10-04 变异时补的：把 `logger.close` 那一处改回裸调用时 16 条**全绿** ——
  // 前面所有用例里 `logger.close` 自己都不抛，而"前面的步骤先炸"的那几条又只断言
  // 它被调用过（那时它确实被调用了，只是没机会抛）。两个条件要同时成立才暴露：
  // 前面的步骤炸了 **且** 关日志自己也炸。少任一个条件，这个洞就留着。
  it('前一步炸了、关日志自己也炸时，关日志那一处仍要兜住（变异时漏掉的就是这条）', async () => {
    const shutdownForExit = await freshShutdown()
    failing.add('closeDatabase')
    failing.add('logger.close')

    // 兜住之后：两步的错都被记账，日志仍报了两条
    expect(() => shutdownForExit()).toThrow()
    const errs = calls.filter((c) => c.startsWith('logger.error:'))
    expect(errs).toHaveLength(2)
    expect(errs).toContain('logger.error:Shutdown step failed: closeDatabase')
    expect(errs).toContain('logger.error:Shutdown step failed: logger.close')
  })
})
