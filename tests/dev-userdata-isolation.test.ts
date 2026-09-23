// 开发版数据目录隔离守卫（2026-09-21，2026-09-23 补时序面）
//
// 装机版与 `npm run dev` 曾因 app.getName() 同为 'zhixing-reader' 而共用
// %APPDATA%\zhixing-reader：sql.js 落盘是整文件写回，两边同时跑会互相覆盖数据；
// 更要命的是单实例锁也按 userData 上锁，后启动的实例会静默退出。
//
// 09-23 补的第二层：换目录这件事光「发生在申请锁之前」不够。logger 与
// settings-service 在**模块加载期**就绑定了 userData，而静态 import 全部早于
// main.ts 本体执行 —— 当时它们拿到的还是装机版目录，表现为开发版读不到自己
// 的密钥、日志写进装机版目录。所以路径切换被提成 electron/user-data.ts，
// 并且必须排在所有会读 userData 的本地 import 之前。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const main = readFileSync('electron/main.ts', 'utf8')
const userData = readFileSync('electron/user-data.ts', 'utf8')

describe('开发版 userData 与装机版隔离', () => {
  const setPathAt = userData.indexOf("app.setPath('userData'")

  it('开发环境必须把 userData 指到独立目录', () => {
    expect(setPathAt).toBeGreaterThan(-1)
    expect(userData.slice(setPathAt, setPathAt + 200)).toContain('zhixing-reader-dev')
  })

  it('换目录必须限非打包环境 —— 装机版路径一动，用户升级就看不到自己的数据', () => {
    expect(setPathAt).toBeGreaterThan(-1)
    const guard = userData.slice(Math.max(0, setPathAt - 260), setPathAt)
    expect(guard).toMatch(/(!app\.isPackaged|isDev)/)
  })

  it('必须在 requestSingleInstanceLock 之前：锁按 userData 上，顺序反了两边仍然互斥', () => {
    const importAt = main.indexOf("from './user-data'")
    expect(importAt).toBeGreaterThan(-1)
    expect(importAt).toBeLessThan(main.indexOf('app.requestSingleInstanceLock()'))
  })

  it('必须排在 logger 与 settings-service 之前 —— 它们在模块加载期就绑定了 userData', () => {
    const importAt = main.indexOf("from './user-data'")
    for (const consumer of ["from './logger'", "from './services/settings-service'"]) {
      expect(importAt).toBeLessThan(main.indexOf(consumer))
    }
  })

  // 上一条断言只在「消费者确实在加载期绑路径」时才有意义；哪天它们改成惰性求值，
  // 这条守卫就该跟着重新审视，而不是默默变成一个永远成立的排序检查。
  it('反证：logger 与 settings-service 确实在构造时读 userData（排序守卫不是空转）', () => {
    const logger = readFileSync('electron/logger.ts', 'utf8')
    const settings = readFileSync('electron/services/settings-service.ts', 'utf8')
    expect(logger).toMatch(/constructor\(\)[\s\S]{0,200}app\.getPath\('userData'\)/)
    expect(settings).toMatch(/constructor\(\)[\s\S]{0,200}app\.getPath\('userData'\)/)
    expect(logger).toMatch(/^export const logger = new Logger\(\)/m)
    expect(settings).toMatch(/^export const settingsService = SettingsService\.getInstance\(\)/m)
  })
})
