/**
 * toastStore 测试 — 纯逻辑测试（不渲染组件）
 *
 * 覆盖：
 *   - addToast：默认值 / 自定义 type / 自定义 duration / 返回 id / 不可变性
 *   - removeToast：按 id 移除 / 移除不存在的 id
 *   - clearAll
 *   - 便捷函数 toast.success / error / loading 等
 *
 * 测试要点：
 *   - 用 useToastStore.getState() 防闭包（参考 zustand-patterns skill）
 *   - beforeEach 用 setState 重置 store，保证测试隔离
 *   - 验证不可变性（Zustand 5 要求 set 不 mutate 旧 state）
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useToastStore, toast } from '@/stores/toastStore'

describe('toastStore', () => {
  // 关键：每个测试前重置 store，避免跨测试污染
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  describe('addToast', () => {
    it('添加 toast → toasts 长度 +1', () => {
      const id = useToastStore.getState().addToast('操作成功')
      const { toasts } = useToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].message).toBe('操作成功')
      expect(toasts[0].id).toBe(id)
    })

    it('默认 type=info, duration=4000', () => {
      useToastStore.getState().addToast('test')
      const { toasts } = useToastStore.getState()
      expect(toasts[0].type).toBe('info')
      expect(toasts[0].duration).toBe(4000)
    })

    it('自定义 type 和 duration', () => {
      useToastStore.getState().addToast('出错', 'error', 6000)
      const { toasts } = useToastStore.getState()
      expect(toasts[0].type).toBe('error')
      expect(toasts[0].duration).toBe(6000)
    })

    it('返回唯一 id', () => {
      const id1 = useToastStore.getState().addToast('a')
      const id2 = useToastStore.getState().addToast('b')
      expect(id1).not.toBe(id2)
      // id 格式：toast-{timestamp}-{random}
      expect(id1).toMatch(/^toast-/)
      expect(id2).toMatch(/^toast-/)
    })

    it('不 mutate 旧 state（不可变性）', () => {
      useToastStore.getState().addToast('first')
      const original = useToastStore.getState().toasts
      useToastStore.getState().addToast('second')
      // 原数组引用不应被修改
      expect(original).toHaveLength(1)
      expect(useToastStore.getState().toasts).toHaveLength(2)
      expect(original[0].message).toBe('first')
    })
  })

  describe('removeToast', () => {
    it('按 id 移除', () => {
      const id1 = useToastStore.getState().addToast('a')
      const id2 = useToastStore.getState().addToast('b')
      useToastStore.getState().removeToast(id1)
      const { toasts } = useToastStore.getState()
      expect(toasts).toHaveLength(1)
      expect(toasts[0].id).toBe(id2)
    })

    it('移除不存在的 id → 无副作用', () => {
      useToastStore.getState().addToast('a')
      useToastStore.getState().removeToast('not-exist')
      expect(useToastStore.getState().toasts).toHaveLength(1)
    })
  })

  describe('clearAll', () => {
    it('清空所有 toast', () => {
      useToastStore.getState().addToast('a')
      useToastStore.getState().addToast('b')
      useToastStore.getState().addToast('c')
      useToastStore.getState().clearAll()
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })
  })

  describe('便捷函数 toast.*', () => {
    it('toast.success → type=success', () => {
      toast.success('done')
      expect(useToastStore.getState().toasts[0].type).toBe('success')
    })

    it('toast.error 默认 duration=6000', () => {
      toast.error('fail')
      expect(useToastStore.getState().toasts[0].type).toBe('error')
      expect(useToastStore.getState().toasts[0].duration).toBe(6000)
    })

    it('toast.error 自定义 duration', () => {
      toast.error('fail', 8000)
      expect(useToastStore.getState().toasts[0].duration).toBe(8000)
    })

    it('toast.warning → type=warning', () => {
      toast.warning('warn')
      expect(useToastStore.getState().toasts[0].type).toBe('warning')
    })

    it('toast.info → type=info', () => {
      toast.info('hello')
      expect(useToastStore.getState().toasts[0].type).toBe('info')
    })

    it('toast.loading → type=loading, duration=0', () => {
      toast.loading('加载中')
      const { toasts } = useToastStore.getState()
      expect(toasts[0].type).toBe('loading')
      expect(toasts[0].duration).toBe(0)
    })

    it('toast.remove(id) 等价于 useToastStore.getState().removeToast(id)', () => {
      const id = toast.info('to-remove')
      toast.remove(id)
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })

    it('toast.clear() 等价于 useToastStore.getState().clearAll()', () => {
      toast.success('a')
      toast.error('b')
      toast.clear()
      expect(useToastStore.getState().toasts).toHaveLength(0)
    })
  })
})
