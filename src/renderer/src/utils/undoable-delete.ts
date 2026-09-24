import { toast } from '../stores/toastStore'
import type { UndoableDeleteKind } from '../../../shared/types'

/**
 * 删除类操作统一走这里：主进程先把被带走的行留一份现场，再物理删，
 * 提示上给一个「撤销」。
 *
 * 确认弹窗**不在这里**——每种数据要交代的代价不一样（删一条划线会带走它的复习进度，
 * 删一本书会带走全部划线/卡片/方法论），文案由调用方按自己量到的数字写。
 */
const KIND_LABEL: Record<UndoableDeleteKind, string> = {
  highlight: '划线',
  knowledge_card: '知识卡片',
  methodology: '方法论',
  vocabulary: '生词',
}

async function restoreDeletion(
  token: string,
  refresh: () => void | Promise<void>,
): Promise<void> {
  try {
    const result = await window.electronAPI.system.restoreDelete(token)
    if (!result.ok) {
      // 现场只在主进程内存里：应用重启过就没了，这里如实说，不假装恢复
      toast.error('撤销已失效：这次删除的现场已经不在了')
      return
    }
    await refresh()
    toast.success(`已恢复${KIND_LABEL[result.kind]}`)
  } catch (error) {
    toast.error(`恢复失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * @returns 真的删掉了才是 true（取消、那一行本来就不在、删除失败都是 false），
 *          调用方据此决定要不要收掉指向这条的选中态 / 抽屉。
 */
export async function deleteWithUndo(options: {
  kind: UndoableDeleteKind
  id: string
  /** 删除后与撤销后各刷一次：列表回到数据库的真实样子 */
  refresh: () => void | Promise<void>
}): Promise<boolean> {
  const { kind, id, refresh } = options
  const label = KIND_LABEL[kind]

  if (!window.electronAPI?.system?.archiveDelete) {
    toast.error('主进程未就绪，没有删除任何东西')
    return false
  }

  try {
    const archived = await window.electronAPI.system.archiveDelete(kind, id)
    if (!archived) {
      // 列表是旧的（别处已经删过）：什么都没删，所以也不给撤销按钮
      toast.info(`这条${label}已经不在了，列表已刷新`)
      await refresh()
      return false
    }
    await refresh()
    const cascade = archived.rowCount > 1 ? `（含 ${archived.rowCount - 1} 条它的复习记录）` : ''
    toast.successWithAction(`${label}已删除${cascade}`, {
      label: '撤销',
      onClick: () => {
        void restoreDeletion(archived.token, refresh)
      },
    })
    return true
  } catch (error) {
    toast.error(`删除失败：${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}
