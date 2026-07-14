import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ToastContainer from './components/Toast'
import ErrorBoundary from './components/ErrorBoundary'
import Home from './pages/Home'
import Bookshelf from './pages/Bookshelf'
import BookDetail from './pages/BookDetail'
import Notes from './pages/Notes'
import Review from './pages/Review'
import Chat from './pages/Chat'
import Stats from './pages/Stats'
import TokenUsage from './pages/TokenUsage'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import Methodologies from './pages/Methodologies'
import KnowledgeCards from './pages/KnowledgeCards'
import DailyLearning from './pages/DailyLearning'
import VocabularyPage from './pages/VocabularyPage'

const AdminPage = lazy(() => import('./pages/admin/AdminPage'))

function App() {
  return (
    <>
      <ToastContainer />
      <Layout>
        <ErrorBoundary>
          <Suspense fallback={<div className="flex items-center justify-center h-full text-gray-400">加载中...</div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/bookshelf" element={<Bookshelf />} />
              <Route path="/bookshelf/:id" element={<BookDetail />} />
              <Route path="/notes" element={<Notes />} />
              <Route path="/review" element={<Review />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/token-usage" element={<TokenUsage />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/methodologies" element={<Methodologies />} />
              <Route path="/knowledge-cards" element={<KnowledgeCards />} />
              <Route path="/daily-learning" element={<DailyLearning />} />
              <Route path="/vocabulary" element={<VocabularyPage />} />
              <Route path="/admin" element={<AdminPage />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </Layout>
    </>
  )
}

export default App
