import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ToastContainer from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Bookshelf from './pages/Bookshelf'
import BookDetail from './pages/BookDetail'
import Notes from './pages/Notes'
import Chat from './pages/Chat'
import Stats from './pages/Stats'
import TokenUsage from './pages/TokenUsage'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Methodologies from './pages/Methodologies'
import KnowledgeCards from './pages/KnowledgeCards'
import Review from './pages/Review'
import DailyLearning from './pages/DailyLearning'
import VocabularyPage from './pages/VocabularyPage'
import AgentOrchestration from './pages/AgentOrchestration'

// 管理后台（SettingsAI/SettingsData 跳转 /admin）
const AdminPage = lazy(() => import('./pages/admin/AdminPage'))

// 设置子页（懒加载）
const SettingsAccount = lazy(() => import('./pages/settings/SettingsAccount'))
const SettingsAI = lazy(() => import('./pages/settings/SettingsAI'))
const SettingsWeRead = lazy(() => import('./pages/settings/SettingsWeRead'))
const SettingsData = lazy(() => import('./pages/settings/SettingsData'))
const SettingsAppearance = lazy(() => import('./pages/settings/SettingsAppearance'))
const SettingsAbout = lazy(() => import('./pages/settings/SettingsAbout'))

function Loading() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--muted-foreground)',
        fontSize: '0.9rem',
      }}
    >
      加载中...
    </div>
  )
}

function App() {
  const navigate = useNavigate()

  // 主进程菜单「视图」快捷键导航（CmdOrCtrl+1/2/3）→ 对应路由
  useEffect(() => {
    const dispose = window.electronAPI?.onNavigate?.(path => {
      navigate(path)
    })
    return () => dispose?.()
  }, [navigate])

  return (
    <>
      <ToastContainer />
      <AppShell>
        <ErrorBoundary>
          <Suspense fallback={<Loading />}>
            <Routes>
              {/* ===== 主导航 ===== */}
              <Route path="/" element={<Home />} />
              <Route path="/bookshelf" element={<Bookshelf />} />
              <Route path="/bookshelf/:id" element={<BookDetail />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/token-usage" element={<TokenUsage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/methodologies" element={<Methodologies />} />
              <Route path="/knowledge-cards" element={<KnowledgeCards />} />
              <Route path="/review" element={<Review />} />
              <Route path="/daily-learning" element={<DailyLearning />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />

              {/* ===== 设置总页 + 6 子页（按设计稿 settings*.html） ===== */}
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/account" element={<SettingsAccount />} />
              <Route path="/settings/ai" element={<SettingsAI />} />
              <Route path="/settings/weread" element={<SettingsWeRead />} />
              <Route path="/settings/data" element={<SettingsData />} />
              <Route path="/settings/appearance" element={<SettingsAppearance />} />
              <Route path="/settings/about" element={<SettingsAbout />} />

              {/* ===== 智能体编排（设计稿 agent-orchestration.html） ===== */}
              <Route path="/agent-orchestration" element={<AgentOrchestration />} />

              {/* ===== 管理后台（SettingsAI 提示词中心 / SettingsData 向量索引清理跳转） ===== */}
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </>
  )
}

export default App
