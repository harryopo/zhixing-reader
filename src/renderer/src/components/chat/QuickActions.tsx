interface QuickActionsProps {
  onAction: (prompt: string) => void
  disabled: boolean
}

const actions = [
  { emoji: '📖', label: '全书问答', prompt: '请帮我总结这本书的核心观点和主要内容' },
  { emoji: '🧠', label: '费曼教学', prompt: '请用费曼学习法教我这本书中最核心的概念' },
  { emoji: '🔍', label: '深度提问', prompt: '请对我正在读的内容提出一些深度思考问题' },
  { emoji: '📋', label: '考考我', prompt: '请考考我对这本书内容的理解程度' },
]

export default function QuickActions({ onAction, disabled }: QuickActionsProps) {
  return (
    <div className="flex gap-2 flex-wrap">
      {actions.map(action => (
        <button
          key={action.label}
          onClick={() => onAction(action.prompt)}
          disabled={disabled}
          className="px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-full hover:bg-gray-100 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200 text-xs font-medium flex items-center gap-1"
        >
          <span>{action.emoji}</span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )
}
