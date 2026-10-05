import { lazy, Suspense, useEffect } from 'react'
import { Routes, Route, useNavigate } from 'react-router-dom'
import AppShell from './components/layout/AppShell'
import ToastContainer from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Bookshelf from './pages/Bookshelf'
import BookDetail from './pages/BookDetail'
import Notes from './pages/Notes'
import SearchResults from './pages/SearchResults'
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

// 开发期管理后台（无前端入口，开发时 URL 直达 /admin）
//
// **只在开发构建里存在** —— `import.meta.env.DEV` 是 Vite 的编译期常量，`npm run build`
// 时它恒为 `false`，Rollup 的死代码消除会把整个 true 分支连同那句 `import()` 一起丢掉，
// 于是 `pages/admin/` 那 1482 行与它引用的 echarts 不会进产物。改回无条件 lazy import 的话，
// /admin 路由又会回到安装版里 —— 那正是 Issue #2 要治的（无鉴权、任何人改一下 hash 就能进）。
const AdminPage = import.meta.env.DEV
  ? lazy(() => import('./pages/admin/AdminPage'))
  : // 构建产物里没有这一页；路由仍留着，直达时如实说"这页只存在于开发版"而不是白屏
    lazy(async () => ({ default: () => <AdminNotInBuild /> }))

function AdminNotInBuild() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-8 text-center">
      <h1 className="text-lg font-semibold">管理后台只存在于开发版</h1>
      <p className="text-sm text-muted-foreground">
        安装版不包含这一页，也就没有它的任何代码。想用就在仓库里 <code>npm run dev</code>。
      </p>
    </div>
  )
}

// 设置子页（懒加载）
const SettingsAccount = lazy(() => import('./pages/settings/SettingsAccount'))
const SettingsAI = lazy(() => import('./pages/settings/SettingsAI'))
const SettingsWeRead = lazy(() => import('./pages/settings/SettingsWeRead'))
const SettingsData = lazy(() => import('./pages/settings/SettingsData'))
const SettingsAgent = lazy(() => import('./pages/settings/SettingsAgent'))
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
              <Route path="/search" element={<SearchResults />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/token-usage" element={<TokenUsage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/methodologies" element={<Methodologies />} />
              <Route path="/knowledge-cards" element={<KnowledgeCards />} />
              <Route path="/review" element={<Review />} />
              <Route path="/daily-learning" element={<DailyLearning />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />

              {/* ===== 设置总页 + 子页（按设计稿 settings*.html） ===== */}
              <Route path="/settings" element={<Settings />} />
              <Route path="/settings/account" element={<SettingsAccount />} />
              <Route path="/settings/ai" element={<SettingsAI />} />
              <Route path="/settings/agent" element={<SettingsAgent />} />
              <Route path="/settings/weread" element={<SettingsWeRead />} />
              <Route path="/settings/data" element={<SettingsData />} />
              <Route path="/settings/appearance" element={<SettingsAppearance />} />
              <Route path="/settings/about" element={<SettingsAbout />} />

              {/* ===== 开发期管理后台（无前端入口，URL 直达） ===== */}
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AppShell>
    </>
  )
}

export default App
