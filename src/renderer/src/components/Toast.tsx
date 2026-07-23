import { useEffect, useState } from 'react'
import { useToastStore, type ToastType } from '../stores/toastStore'

const typeConfig: Record<ToastType, { icon: string; bgColor: string; borderColor: string; textColor: string; iconColor: string }> = {
  success: {
    icon: 'M5 13l4 4L19 7',
    bgColor: 'bg-white',
    borderColor: 'border-green-200',
    textColor: 'text-gray-800',
    iconColor: 'text-green-500',
  },
  error: {
    icon: 'M6 18L18 6M6 6l12 12',
    bgColor: 'bg-white',
    borderColor: 'border-red-200',
    textColor: 'text-gray-800',
    iconColor: 'text-red-500',
  },
  warning: {
    icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
    bgColor: 'bg-white',
    borderColor: 'border-amber-200',
    textColor: 'text-gray-800',
    iconColor: 'text-amber-500',
  },
  info: {
    icon: 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    bgColor: 'bg-white',
    borderColor: 'border-emerald-200',
    textColor: 'text-gray-800',
    iconColor: 'text-emerald-500',
  },
  loading: {
    icon: '',
    bgColor: 'bg-white',
    borderColor: 'border-gray-200',
    textColor: 'text-gray-800',
    iconColor: 'text-primary',
  },
}

function ToastItem({ id, message, type, duration }: { id: string; message: string; type: ToastType; duration: number }) {
  const [visible, setVisible] = useState(false)
  const [progress, setProgress] = useState(100)
  const removeToast = useToastStore((state) => state.removeToast)
  const config = typeConfig[type]

  useEffect(() => {
    // 触发动画
    requestAnimationFrame(() => setVisible(true))

    if (type === 'loading' || duration === 0) return

    const startTime = Date.now()
    const timer = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)

      if (elapsed >= duration) {
        clearInterval(timer)
        setVisible(false)
        setTimeout(() => removeToast(id), 300) // 等待动画结束
      }
    }, 16)

    return () => clearInterval(timer)
  }, [id, duration, type, removeToast])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => removeToast(id), 300)
  }

  return (
    <div
      className={`transform transition-all duration-300 ease-out ${
        visible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
      }`}
    >
      <div
        className={`relative flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg border ${config.bgColor} ${config.borderColor} min-w-[320px] max-w-[480px]`}
      >
        {/* 图标 */}
        <div className="flex-shrink-0 mt-0.5">
          {type === 'loading' ? (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary" />
          ) : (
            <svg
              className={`w-5 h-5 ${config.iconColor}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={config.icon} />
            </svg>
          )}
        </div>

        {/* 内容 */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-medium ${config.textColor}`}>{message}</p>
        </div>

        {/* 关闭按钮 */}
        {type !== 'loading' && (
          <button
            onClick={handleClose}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}

        {/* 进度条 */}
        {type !== 'loading' && duration > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-100 rounded-b-xl overflow-hidden">
            <div
              className={`h-full transition-all duration-100 ease-linear ${
                type === 'success'
                  ? 'bg-green-400'
                  : type === 'error'
                  ? 'bg-red-400'
                  : type === 'warning'
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

export default function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none">
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto">
          <ToastItem
            id={toast.id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
          />
        </div>
      ))}
    </div>
  )
}
