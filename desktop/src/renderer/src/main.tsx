import './index.css'

import { StrictMode, useEffect, useRef } from 'react'
import type { FC } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AccessProvider } from './state/access'
import { UiStateProvider } from './state/uiState'

const RootApp: FC = () => {
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.defaultPrevented && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const target = event.target as HTMLElement | null
        if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
          return
        }
        event.preventDefault()
        searchRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <UiStateProvider>
        <AccessProvider>
          <App searchInputRef={searchRef} />
        </AccessProvider>
      </UiStateProvider>
    </BrowserRouter>
  )
}

const container = document.getElementById('root')

if (container) {
  createRoot(container).render(
    <StrictMode>
      <RootApp />
    </StrictMode>
  )
}
