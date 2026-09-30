/**
 * 复制到剪贴板 —— 全应用只这一份。
 *
 * 原先档案页的「分享」自己写了一套（`navigator.clipboard` 加一个 textarea +
 * `execCommand` 的兜底），别处要用剪贴板就得再抄一遍：两处对"剪贴板不可用"
 * 的答法迟早不一样，一边报错一边静默成功。
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    return false
  }
  // 回退方案：临时 textarea + execCommand（WebView 里 clipboard 可能被权限拒）
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
