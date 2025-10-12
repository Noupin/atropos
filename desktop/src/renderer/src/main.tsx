import './index.css'

import { StrictMode } from 'react'
import type { FC } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AccessProvider } from './state/access'

const RootApp: FC = () => (
  <BrowserRouter>
    <AccessProvider>
      <App />
    </AccessProvider>
  </BrowserRouter>
)

const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <RootApp />
    </StrictMode>
  )
}
