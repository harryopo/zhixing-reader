import { describe, it, expect } from 'vitest'
import { describeUpdateError, updateNoticeFrom, type UpdateStatusLike } from '../src/shared/update-notice'

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

describe('更新失败提示的措辞', () => {
  it('Chromium 网络错误码翻成人话，不许把 net::ERR_* 直接丢给用户', () => {
    for (const raw of [
      'net::ERR_CONNECTION_RESET',
      'net::ERR_CONNECTION_TIMED_OUT At https://api.github.com/repos/harryopo/zhixing-reader/releases/latest',
      'net::ERR_INTERNET_DISCONNECTED',
      'Error: ECONNREFUSED',
      'socket hang up',
    ]) {
      const text = describeUpdateError(raw)
      expect(text).toBe('连不上更新服务器（GitHub），请检查网络后稍后重试')
      expect(text).not.toContain('net::')
      expect(text).not.toMatch(/E[A-Z]{4,}/)
    }
  })

  it('证书类错误单独说 —— 要用户改的是系统时间或代理，不是网络', () => {
    expect(describeUpdateError('net::ERR_CERT_AUTHORITY_INVALID')).toBe(
      '更新服务器证书校验失败，请检查系统时间或代理设置',
    )
  })

  it('GitHub 限流与「找不到安装包」各给一句', () => {
    expect(describeUpdateError('HTTP 403 Forbidden')).toBe('GitHub 访问频率受限，请稍后再试')
    expect(describeUpdateError('Cannot find latest.yml of download files')).toBe(
      '更新服务器上没找到可用的安装包，请稍后再试',
    )
  })

  it('认不出的错误保留原文 —— 宁可不美化也不能把线索抹掉', () => {
    expect(describeUpdateError('UPDATER_SPLASH_FAILED')).toBe('更新失败：UPDATER_SPLASH_FAILED')
  })

  it('空消息也有兜底，不显示「更新失败：undefined」', () => {
    expect(describeUpdateError('')).toBe('更新失败，请稍后重试')
    expect(describeUpdateError(undefined)).toBe('更新失败，请稍后重试')
  })
})
