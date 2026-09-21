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

/**
 * 更新失败的原始信息 → 给用户看的一句话。
 *
 * 更新源在 GitHub Releases，国内网络下超时/重置是常态，直接把 net::ERR_* 抛给用户
 * 既看不懂也没法行动，所以网络类一律收成「稍后重试」，其余保留原文便于排查。
 */
export function describeUpdateError(raw?: string): string {
  const msg = (raw ?? '').trim()
  if (!msg) return '更新失败，请稍后重试'
  if (/ERR_(CONNECTION|INTERNET|SOCKS|NAME|ADDRESS|NETWORK|PROXY|TUNNEL|TIMED_OUT)|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ECONNABORTED|ENETUNREACH|ENOTFOUND|EAI_AGAIN|socket hang up|failed to fetch|timed?\s*out/i.test(msg)) {
    return '连不上更新服务器（GitHub），请检查网络后稍后重试'
  }
  if (/ERR_(SSL|CERT)|certificate/i.test(msg)) {
    return '更新服务器证书校验失败，请检查系统时间或代理设置'
  }
  if (/403|429|rate limit/i.test(msg)) {
    return 'GitHub 访问频率受限，请稍后再试'
  }
  if (/404|Cannot find latest|Can't parse/i.test(msg)) {
    return '更新服务器上没找到可用的安装包，请稍后再试'
  }
  return `更新失败：${msg}`
}
