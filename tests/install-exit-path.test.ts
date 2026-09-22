// 「重启安装」退出路径守卫（2026-09-22）
//
// electron-updater 的 quitAndInstall 是先 spawn 安装进程、再把 app.quit() 排到下一个
// tick。quit 是异步的 —— 窗口拆除、close/before-quit 处理器都能让主进程再多活几百毫秒，
// 而 NSIS 安装进程一起来就用自己的 taskkill 循环按映像名找「知行读书.exe」
// （node_modules/app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh）。
// 两边抢同一段时间窗，主进程没及时消失 → 安装界面弹「知行读书 无法关闭」并卡在重试框上。
//
// 修法钉三条：安装包 spawn 之后由我们自己同步把数据落盘，然后立刻 app.exit(0)；
// 没有已下载的安装包时绝不退出（那时 electron-updater 只会报错，退出等于白关应用）；
// 落盘收尾与 before-quit 共用同一份实现，两条路不许各写一套。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const updaterSrc = readFileSync('electron/updater.ts', 'utf8')
const mainSrc = readFileSync('electron/main.ts', 'utf8')
const shutdownSrc = readFileSync('electron/shutdown.ts', 'utf8')

/** updater.ts 中导出的 quitAndInstall 函数体（到文件末尾） */
function installFn(): string {
  const start = updaterSrc.indexOf('export function quitAndInstall')
  expect(start).toBeGreaterThan(-1)
  return updaterSrc.slice(start)
}

describe('重启安装的退出路径', () => {
  it('顺序固定：先 spawn 安装包 → 再同步落盘 → 最后 exit', () => {
    const fn = installFn()
    const spawn = fn.indexOf('autoUpdater.quitAndInstall(')
    const flush = fn.indexOf('shutdownForExit()')
    const exit = fn.indexOf('app.exit(0)')
    expect(spawn).toBeGreaterThan(-1)
    expect(flush).toBeGreaterThan(-1)
    expect(exit).toBeGreaterThan(-1)
    expect(spawn).toBeLessThan(flush)
    expect(flush).toBeLessThan(exit)
  })

  it('不再把退出交给 app.quit()，也不再延后一个 tick', () => {
    const fn = installFn()
    expect(fn).not.toContain('app.quit()')
    expect(fn).not.toContain('setImmediate')
  })

  it('没有已下载的安装包时不得退出应用', () => {
    const fn = installFn()
    expect(fn).toMatch(/lastStatus[\s\S]{0,80}!== 'downloaded'/)
    // 守卫必须排在 spawn 之前，否则来不及拦
    expect(fn.indexOf('!== \'downloaded\'')).toBeLessThan(fn.indexOf('autoUpdater.quitAndInstall('))
  })

  it('收尾函数真的落盘，并且库关闭排在日志关闭之前', () => {
    const closeAt = shutdownSrc.indexOf('closeDatabase()')
    expect(closeAt).toBeGreaterThan(-1)
    expect(closeAt).toBeLessThan(shutdownSrc.indexOf('logger.close()'))
    // 中止进行中的 AI 流：exit 不走窗口 close，这条路没人替我们做
    expect(shutdownSrc).toContain('cancelActiveStream()')
    expect(shutdownSrc).toContain('stopWereadAutoSync()')
    expect(shutdownSrc).toContain('knowledgeCardService.shutdown()')
  })

  it('before-quit 与安装路径共用同一份收尾', () => {
    const at = mainSrc.indexOf("app.on('before-quit'")
    expect(at).toBeGreaterThan(-1)
    expect(mainSrc.slice(at, at + 300)).toContain('shutdownForExit()')
  })
})
