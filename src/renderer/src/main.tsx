import React from 'react'
import ReactDOM from 'react-dom/client'
// HashRouter: production loads via file:// (loadFile), BrowserRouter breaks refresh/deep links
import { HashRouter } from 'react-router-dom'
import App from './App'
// 字体本地打包（OFL-1.1，许可文本在 src/renderer/public/licenses/）——
// 桌面应用不能依赖 fonts.googleapis.com：离线打不开，且国内常被墙
import '@fontsource-variable/dm-sans'
import '@fontsource-variable/noto-sans-sc'
import '@fontsource-variable/jetbrains-mono'
import './styles/index.css'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
