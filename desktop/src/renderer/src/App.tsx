import { useCallback, useEffect, useState } from 'react'
import type { FC, RefObject } from 'react'
import { Route, Routes } from 'react-router-dom'
import Search from './components/Search'
import ClipPage from './pages/Clip'
import Home from './pages/Home'
import type { SearchBridge } from './types'

type AppProps = {
  searchInputRef: RefObject<HTMLInputElement | null>
}

const App: FC<AppProps> = ({ searchInputRef }) => {
  const [searchBridge, setSearchBridge] = useState<SearchBridge | null>(null)
  const [searchValue, setSearchValue] = useState('')
  const [isDark, setIsDark] = useState(() => {
    if (typeof document === 'undefined') {
      return true
    }
    return document.documentElement.classList.contains('dark')
  })

  useEffect(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    if (!root.classList.contains('dark')) {
      root.classList.add('dark')
    }
    setIsDark(root.classList.contains('dark'))
    document.title = 'Atropos'
  }, [])

  const registerSearch = useCallback((bridge: SearchBridge | null) => {
    setSearchBridge(bridge)
    setSearchValue(bridge?.getQuery() ?? '')
  }, [])

  const handleSearchChange = useCallback(
    (value: string) => {
      setSearchValue(value)
      searchBridge?.onQueryChange(value)
    },
    [searchBridge]
  )

  const toggleTheme = useCallback(() => {
    if (typeof document === 'undefined') {
      return
    }
    const root = document.documentElement
    if (root.classList.contains('dark')) {
      root.classList.remove('dark')
      setIsDark(false)
    } else {
      root.classList.add('dark')
      setIsDark(true)
    }
  }, [])

  return (
    <div className="flex min-h-full flex-col bg-[var(--bg)] text-[var(--fg)]">
      <header className="border-b border-white/10 bg-[color:color-mix(in_srgb,var(--card)_40%,transparent)]">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Atropos</h1>
            <button
              type="button"
              onClick={toggleTheme}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-sm font-medium text-[var(--fg)] transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              aria-label="Toggle theme"
            >
              {isDark ? 'Switch to light' : 'Switch to dark'}
            </button>
          </div>
          <Search
            ref={searchInputRef}
            value={searchValue}
            onChange={handleSearchChange}
            disabled={!searchBridge}
          />
        </div>
      </header>
      <main className="flex flex-1 justify-center bg-[var(--bg)] text-[var(--fg)]">
        <Routes>
          <Route path="/" element={<Home registerSearch={registerSearch} />} />
          <Route path="/clip/:id" element={<ClipPage registerSearch={registerSearch} />} />
          <Route path="*" element={<Home registerSearch={registerSearch} />} />
        </Routes>
      </main>
    </div>
  )
}

export default App
