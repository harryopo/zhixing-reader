// 开发版数据目录隔离守卫（2026-09-21）
//
// 装机版与 `npm run dev` 曾因 app.getName() 同为 'zhixing-reader' 而共用
// %APPDATA%\zhixing-reader：sql.js 落盘是整文件写回，两边同时跑会互相覆盖数据；
// 更要命的是单实例锁也按 userData 上锁，后启动的实例会静默退出。
// 这里钉住「只给开发环境换目录，且必须在申请单实例锁之前换」。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'

const src = readFileSync('electron/main.ts', 'utf8')

describe('开发版 userData 与装机版隔离', () => {
  const setPathAt = src.indexOf("app.setPath('userData'")

  it('开发环境必须把 userData 指到独立目录', () => {
    expect(setPathAt).toBeGreaterThan(-1)
    expect(src.slice(setPathAt, setPathAt + 200)).toContain('zhixing-reader-dev')
  })

  it('换目录必须限非打包环境 —— 装机版路径一动，用户升级就看不到自己的数据', () => {
    expect(setPathAt).toBeGreaterThan(-1)
    const guard = src.slice(Math.max(0, setPathAt - 200), setPathAt)
    expect(guard).toMatch(/(!app\.isPackaged|isDev)/)
  })

  it('必须在 requestSingleInstanceLock 之前换：锁按 userData 上，顺序反了两边仍然互斥', () => {
    expect(setPathAt).toBeGreaterThan(-1)
    expect(setPathAt).toBeLessThan(src.indexOf('app.requestSingleInstanceLock()'))
  })
})
