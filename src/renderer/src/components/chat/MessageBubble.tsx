import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Source {
  bookId: string
  bookTitle: string
  chunkId: string
  relevanceScore: number
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  sources?: Source[]
  isStreaming?: boolean
}

export default function MessageBubble({ role, content, sources, isStreaming }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end animate-fade-in">
        <div className="max-w-[70%] bg-primary text-white rounded-2xl rounded-br-md px-4 py-3">
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{content}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-start animate-fade-in">
      <div className="max-w-[70%] bg-gray-100 text-gray-900 rounded-2xl rounded-bl-md px-4 py-3">
        <div className="prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-800 prose-code:bg-gray-200 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-gray-800 prose-pre:text-gray-100">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
        {isStreaming && (
          <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-1" />
        )}
        {sources && sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-gray-200 flex flex-wrap gap-1">
            {sources.map((source, index) => (
              <span
                key={index}
                className="inline-flex items-center px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full"
              >
                📖 {source.bookTitle}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
