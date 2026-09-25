import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from '../stores/toastStore'
import type { ReviewSourceKind } from '../../../shared/review-sources'

/**
 * 「加入复习队列」的界面状态：一份入队名单 + 加入 / 移出的动作。
 *
 * 名单始终来自 `card.enrolledSources()`，不拿本地点击结果当事实 ——
 * 一个页面挂着几十张卡，本地猜测迟早会和队列里的实际情况分叉，
 * 表现为按钮显示"已加入"而队列里没有（或反过来）。
 */
export function useReviewEnrollment(kind: ReviewSourceKind) {
  const [ids, setIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const enrolled = useMemo(() => new Set(ids), [ids])

  const refresh = useCallback(async () => {
    if (!window.electronAPI?.card?.enrolledSources) return
    try {
      const result = await window.electronAPI.card.enrolledSources(kind)
      setIds(result.ids)
    } catch (error) {
      // 名单读不到时按钮状态是空的，这里如实说一句，不让界面装作"都没加入"
      toast.error(`读不到复习队列：${error instanceof Error ? error.message : String(error)}`)
    }
  }, [kind])

  useEffect(() => {
    void refresh()
  }, [refresh])

  /** 批量入队（一次点击 = 一条 IPC，不逐个请求） */
  const enrollMany = useCallback(
    async (targets: string[]) => {
      if (targets.length === 0) return false
      setLoading(true)
      try {
        const result = await window.electronAPI.card.enroll(kind, targets)
        await refresh()
        if (result.created === 0) {
          toast.info(`${String(targets.length)} 张都已在复习队列里`)
        } else {
          toast.success(
            `已加入复习队列 ${String(result.created)} 张` +
              (result.skipped > 0 ? `（${String(result.skipped)} 张已在）` : '') +
              ` · 今日可复习 ${String(result.actionable)} 张`,
          )
        }
        return true
      } catch (error) {
        toast.error(`加入失败：${error instanceof Error ? error.message : String(error)}`)
        return false
      } finally {
        setLoading(false)
      }
    },
    [kind, refresh],
  )

  const unenroll = useCallback(
    async (id: string) => {
      setLoading(true)
      try {
        await window.electronAPI.card.unenroll(kind, id)
        await refresh()
        toast.info('已移出复习队列（卡片本身留着）')
      } catch (error) {
        toast.error(`移出失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        setLoading(false)
      }
    },
    [kind, refresh],
  )

  return { isEnrolled: (id: string) => enrolled.has(id), enrolledCount: ids.length, enrollMany, unenroll, loading, refresh }
}
