// @vitest-environment happy-dom
// 恢复备份这条覆盖性路径的门禁（2026-09-25）
//
// 这条按钮做的事是"整批替换当前库"，所以真正要紧的不是恢复了多少行（那有
// `tests/backup-roundtrip.test.ts` 对账），而是三件事：
//  1) 没点确认就绝不能动手；
//  2) 报数要先看得见，页面才重载（一恢复就跳白屏等于什么也没说）；
//  3) 主进程报错时不许重载 —— 库里还是原样，页面不该跟着闪一下。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDataIo } from '../src/renderer/src/pages/settings/use-data-io'
import { toast } from '../src/renderer/src/stores/toastStore'
import type { BackupImportResult } from '../src/shared/backup'

function fakeFile(text: string): File {
  return { name: 'zhixing-backup.json', text: async () => text } as unknown as File
}

/** 抓住 `document.createElement('input')` 造出来的那个文件选择框 */
let createdInput: HTMLInputElement | null = null

beforeEach(() => {
  createdInput = null
  const real = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation(
    ((tag: string, options?: ElementCreationOptions) => {
      const el = real(tag, options)
      if (tag === 'input') createdInput = el as HTMLInputElement
      return el
    }) as typeof document.createElement,
  )
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const OK: BackupImportResult = {
  counts: { books: 3, highlights: 12, ai_generation_batches: 1 },
  legacy: false,
  version: '1.2',
}

function setup(opts: {
  importBackup: ReturnType<typeof vi.fn>
  confirm: boolean
}) {
  const reload = vi.fn()
  Object.defineProperty(window, 'location', {
    value: { reload, href: 'http://localhost/', assign: vi.fn(), replace: vi.fn() },
    configurable: true,
  })
  const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(opts.confirm)
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    system: { exportBackup: vi.fn(), importBackup: opts.importBackup },
    settings: { get: vi.fn(async () => ''), set: vi.fn(async () => undefined) },
    book: { getAll: vi.fn(async () => []) },
    highlight: { getAll: vi.fn(async () => []) },
    card: { getQueueStats: vi.fn(async () => null), getByBook: vi.fn(async () => []) },
    summary: { pending: vi.fn(async () => []) },
    admin: { getStats: vi.fn(async () => ({ stats: {} })) },
    onSyncBookshelf: vi.fn(() => () => {}),
    onUpdateStatus: vi.fn(() => () => {}),
    update: { getStatus: vi.fn(async () => ({ status: null })) },
  }
  return { reload, confirmSpy }
}

async function runImport(payloadText: string): Promise<void> {
  const { result } = renderHook(() => useDataIo())
  await act(async () => {
    result.current.handleImportData()
  })
  expect(createdInput, '没造出文件选择框').not.toBeNull()
  Object.defineProperty(createdInput, 'files', { value: [fakeFile(payloadText)] })
  await act(async () => {
    await createdInput?.onchange?.({} as Event)
  })
}

describe('恢复备份的确认门', () => {
  it('取消确认 ⇒ 一条数据都不动，页面也不重载', async () => {
    const importBackup = vi.fn()
    const { reload, confirmSpy } = setup({ importBackup, confirm: false })
    const success = vi.spyOn(toast, 'success')

    await runImport(JSON.stringify({ tables: {} }))

    expect(confirmSpy).toHaveBeenCalledTimes(1)
    expect(importBackup).not.toHaveBeenCalled()
    expect(success).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('确认 ⇒ 先报数（1.5 秒）再重载；报数里带上了恢复了多少', async () => {
    const importBackup = vi.fn(async () => OK)
    const { reload } = setup({ importBackup, confirm: true })
    const success = vi.spyOn(toast, 'success')

    await runImport(JSON.stringify({ app: 'zhixing-reader', version: '1.2', tables: {} }))

    expect(importBackup).toHaveBeenCalledTimes(1)
    expect(success).toHaveBeenCalledWith(expect.stringContaining('3 本书'))
    expect(success).toHaveBeenCalledWith(expect.stringContaining('1 条生成台账'))
    // 报数之后立刻重载就等于什么都没报
    expect(reload).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1500)
    })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('主进程报错 ⇒ 报错误而不重载（库里还是原样）', async () => {
    const importBackup = vi.fn(async () => {
      throw new Error('这个文件不是知行读书的备份')
    })
    const { reload } = setup({ importBackup, confirm: true })
    const error = vi.spyOn(toast, 'error')

    await runImport(JSON.stringify({ app: 'zhixing-reader', version: '1.2', tables: {} }))

    expect(error).toHaveBeenCalledWith(expect.stringContaining('不是知行读书的备份'))
    act(() => {
      vi.advanceTimersByTime(5000)
    })
    expect(reload).not.toHaveBeenCalled()
  })

  it('旧格式备份 ⇒ 除报数外再补一句"当年没带走的类别带不回"', async () => {
    const importBackup = vi.fn(async () => ({ ...OK, legacy: true }))
    setup({ importBackup, confirm: true })
    const warning = vi.spyOn(toast, 'warning')

    await runImport(JSON.stringify({ version: '1.1', books: [] }))

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('旧格式备份'))
  })
})
