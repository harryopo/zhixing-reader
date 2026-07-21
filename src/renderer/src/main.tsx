import React from 'react'
import ReactDOM from 'react-dom/client'
// HashRouter: production loads via file:// (loadFile), BrowserRouter breaks refresh/deep links
import { HashRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import './styles/globals.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
)
