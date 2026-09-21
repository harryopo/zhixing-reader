/**
 * 顶栏「有新版本」提示的唯一判定口径。
 *
 * 放 shared 是为了让这条判定能被单测打到：界面上出现的版本号必须来自主进程刚查到的
 * 真实 latest.yml，既不能写死，也不能是上一次查询留下的旧值（所以「收回」必须是 null，
 * 而不是保留上一个版本号）。
 */

export interface UpdateStatusLike {
  stage: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
}

export interface UpdateNotice {
  version: string
  /** true = 包已下到本地，重启就装上；false = 只是发现了新版本，还没下载 */
  readyToInstall: boolean
}

/**
 * 只有两种状态值得打扰用户：发现了新版本、或新版本已下载完等着重启装。
 * 其余一律返回 null，调用方直接把它写进 state。
 */
export function updateNoticeFrom(status: UpdateStatusLike | null | undefined): UpdateNotice | null {
  if (!status) return null
  if (status.stage !== 'available' && status.stage !== 'downloaded') return null
  const version = status.version?.trim()
  if (!version) return null
  return { version, readyToInstall: status.stage === 'downloaded' }
}
