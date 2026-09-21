import { describe, it, expect } from 'vitest'
import { updateNoticeFrom, type UpdateStatusLike } from '../src/shared/update-notice'

describe('顶栏升级提示的判定', () => {
  it('发现新版本才提示，并带上真实版本号与「还没下载」', () => {
    expect(updateNoticeFrom({ stage: 'available', version: 'v1.4.0' })).toEqual({
      version: 'v1.4.0',
      readyToInstall: false,
    })
  })

  it('已下载待重启也提示，但要说清是「重启就装上」', () => {
    expect(updateNoticeFrom({ stage: 'downloaded', version: 'v1.4.0' })).toEqual({
      version: 'v1.4.0',
      readyToInstall: true,
    })
  })

  it('检查中 / 下载中 / 已是最新 / 出错 一律不提示', () => {
    for (const stage of ['checking', 'downloading', 'not-available', 'error'] as const) {
      const status: UpdateStatusLike = { stage, version: 'v1.4.0' }
      expect(updateNoticeFrom(status)).toBeNull()
    }
  })

  it('没有版本号的 available 不许提示 —— 宁可不报也不显示空版本', () => {
    expect(updateNoticeFrom({ stage: 'available' })).toBeNull()
    expect(updateNoticeFrom({ stage: 'available', version: '   ' })).toBeNull()
  })

  it('状态为空（开发环境、或主进程还没查过）不提示', () => {
    expect(updateNoticeFrom(null)).toBeNull()
    expect(updateNoticeFrom(undefined)).toBeNull()
  })

  it('旧提示必须能被新状态收回：查到「已是最新」后返回 null', () => {
    // 顶栏把返回值直接写进 state，所以「收回」必须是 null 而不是保留旧版本号
    expect(updateNoticeFrom({ stage: 'not-available', version: 'v1.3.0' })).toBeNull()
  })
})
