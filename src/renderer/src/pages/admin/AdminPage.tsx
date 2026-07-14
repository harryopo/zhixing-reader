import { useState, ReactElement, lazy, Suspense } from 'react'

const AdminDashboard = lazy(() => import('./AdminDashboard'))
const PromptCenter = lazy(() => import('./PromptCenter'))
const DatabaseBrowser = lazy(() => import('./DatabaseBrowser'))
const KnowledgeBase = lazy(() => import('./KnowledgeBase'))

type TabKey = 'dashboard' | 'prompts' | 'database' | 'knowledge'

const tabs: { key: TabKey; label: string; icon: ReactElement }[] = [
  {
    key: 'dashboard',
    label: '数据仪表盘',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
  },
  {
    key: 'prompts',
    label: '提示词中心',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
      </svg>
    ),
  },
  {
    key: 'database',
    label: '数据库',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
      </svg>
    ),
  },
  {
    key: 'knowledge',
    label: '知识库',
    icon: (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
  },
]

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard')

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="border-b border-gray-100 bg-white">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-800">智能体管理后台</h1>
            <span className="text-[11px] text-gray-400">数据 · 提示词 · 数据库</span>
          </div>
          <a
            href="#/"
            className="px-3 py-1.5 text-xs text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors font-medium"
          >
            返回应用
          </a>
        </div>
        <div className="max-w-6xl mx-auto px-5 flex gap-1 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-t-lg transition-all duration-150 border-b-2 whitespace-nowrap ${
                activeTab === tab.key
                  ? 'text-indigo-600 border-indigo-600'
                  : 'text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-5 py-5">
          <Suspense fallback={<div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-indigo-600"></div></div>}>
            {activeTab === 'dashboard' && <AdminDashboard />}
            {activeTab === 'prompts' && <PromptCenter />}
            {activeTab === 'database' && <DatabaseBrowser />}
            {activeTab === 'knowledge' && <KnowledgeBase />}
          </Suspense>
        </div>
      </div>
    </div>
  )
}
