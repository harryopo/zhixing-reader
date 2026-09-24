import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading'

/** 提示上的一个动作按钮（现在的用法就是「撤销」） */
export interface ToastAction {
  label: string
  onClick: () => void
}

interface Toast {
  id: string
  message: string
  type: ToastType
  duration: number
  action?: ToastAction
}

interface ToastState {
  toasts: Toast[]
  addToast: (
    message: string,
    type?: ToastType,
    duration?: number,
    action?: ToastAction,
  ) => string
  removeToast: (id: string) => void
  clearAll: () => void
}

/**
 * 带动作按钮的提示停留时间。比常规 4 秒长：读完一句话再伸手去点，
 * 4 秒会在手还没到之前先把按钮收走（撤销就是这么静悄悄地失效的）。
 */
const ACTION_TOAST_MS = 8000

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  addToast: (
    message: string,
    type: ToastType = 'info',
    duration: number = 4000,
    action?: ToastAction,
  ) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    set((state) => ({
      toasts: [...state.toasts, { id, message, type, duration, action }],
    }))
    return id
  },

  removeToast: (id: string) => {
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    }))
  },

  clearAll: () => set({ toasts: [] }),
}))

// 便捷函数
export const toast = {
  success: (message: string, duration?: number) =>
    useToastStore.getState().addToast(message, 'success', duration),
  error: (message: string, duration?: number) =>
    useToastStore.getState().addToast(message, 'error', duration || 6000),
  warning: (message: string, duration?: number) =>
    useToastStore.getState().addToast(message, 'warning', duration),
  info: (message: string, duration?: number) =>
    useToastStore.getState().addToast(message, 'info', duration),
  loading: (message: string) =>
    useToastStore.getState().addToast(message, 'loading', 0),
  /** 带一个动作按钮的成功提示（现在的用法就是删除后的「撤销」） */
  successWithAction: (message: string, action: ToastAction, duration?: number) =>
    useToastStore.getState().addToast(message, 'success', duration ?? ACTION_TOAST_MS, action),
  remove: (id: string) => useToastStore.getState().removeToast(id),
  clear: () => useToastStore.getState().clearAll(),
}
